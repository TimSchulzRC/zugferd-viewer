import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { ACCEPTED, MAX_FILE_BYTES, type Access, type Crumb, type FileDetails, type Folder, type Listing, type Node } from "@/lib/nodes";
import { db } from "./db";
import { HttpError } from "./http";
import { deleteObjects, getObject, putObject } from "./storage";
import { statusOf, validate } from "./validate";

/*
 * Every node belongs to one user, the owner of its top folder. Nobody else sees it unless the owner
 * shares it (table permission) with everyone or with chosen people, to view or to edit. A share on a
 * folder covers everything inside. Admins have no extra access to files.
 *
 * Calls for signed-in users take the user's id first and check access themselves. Calls without it
 * (children, details, content, pathTo, tree) are for public links, which check access in shares.ts.
 */

const COLUMNS = ["node.id", "node.parent_id", "node.kind", "node.name", "node.size", "node.status", "node.updated_at", "node.owner_id"] as const;
type Row = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  size: number | string | null;
  status: Node["status"];
  updated_at: Date;
  owner_id: string;
  owner_email?: string | null;
  shared?: boolean;
  /** The strongest permission the user holds on this very node: true edit, false view, null none. */
  own_edit?: boolean | null;
};

const RANK: Record<Access, number> = { view: 1, edit: 2, owner: 3 };
const NOT_FOUND = "Nicht gefunden";

function stronger(a: Access | null, b: Access | null): Access | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

function grantOf(edit: boolean | null | undefined): Access | null {
  return edit === true ? "edit" : edit === false ? "view" : null;
}

/** A node as a public link visitor sees it: no owner, no sharing state. */
export function toNode(row: Row): Node {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    name: row.name,
    size: row.size === null ? null : Number(row.size),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    shared: false,
    access: "view",
    ownerId: "",
    owner: null,
  };
}

/** A node as a signed-in user sees it. inherited is their access to the folder it lies in. */
function toUserNode(row: Row, userId: string, inherited: Access | null): Node {
  const mine = row.owner_id === userId;
  return {
    ...toNode(row),
    shared: mine && (row.shared ?? false),
    access: mine ? "owner" : (stronger(inherited, grantOf(row.own_edit)) ?? "view"),
    ownerId: row.owner_id,
    owner: mine ? null : (row.owner_email ?? null),
  };
}

export async function find(id: string) {
  const row = await db().selectFrom("node").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, NOT_FOUND);
  return row;
}

/** The permission filter for one user: shared with them by name or with everyone. */
const forUser = (userId: string) => sql<boolean>`(permission.user_id = ${userId} or permission.user_id is null)`;

/** What the user may do with this node: owner, else the strongest share on it or any folder above it. */
export async function accessTo(userId: string, id: string) {
  const row = await find(id);
  if (row.owner_id === userId) return { row, access: "owner" as Access };
  const { rows } = await sql<{ can_edit: boolean | null }>`
    with recursive up as (
      select id, parent_id from node where id = ${id}
      union all
      select n.id, n.parent_id from node n join up on n.id = up.parent_id
    )
    select bool_or(permission.can_edit) as can_edit from up join permission on permission.node_id = up.id and ${forUser(userId)}
  `.execute(db());
  return { row, access: grantOf(rows[0]?.can_edit) };
}

const DENIED: Record<Access, string> = {
  view: NOT_FOUND,
  edit: "Hier darfst du nur ansehen",
  owner: "Das darf nur, wem der Ordner gehört",
};

/**
 * Throws unless the user has at least the given access. Without any access the node does not exist
 * for them (404), so ids of other people's files reveal nothing.
 */
export async function requireAccess(userId: string, id: string, need: Access) {
  const result = await accessTo(userId, id);
  if (!result.access) throw new HttpError(404, NOT_FOUND);
  if (RANK[result.access] < RANK[need]) throw new HttpError(403, DENIED[need]);
  return { row: result.row, access: result.access };
}

/**
 * Renaming, moving and deleting change the folder a node lies in, so they need edit rights on that
 * folder. Someone a folder is shared with can work inside it but cannot rename or remove the folder itself.
 */
async function requireChange(userId: string, id: string) {
  const { row, access } = await requireAccess(userId, id, "view");
  if (access === "owner") return row;
  const parent = row.parent_id ? await accessTo(userId, row.parent_id) : null;
  if (!parent?.access || RANK[parent.access] < RANK.edit) throw new HttpError(403, row.parent_id ? DENIED.edit : DENIED.owner);
  return row;
}

/** The folder new things go into, and who will own them. null is the user's own top level. */
async function target(userId: string, parentId: string | null) {
  if (parentId === null) return { ownerId: userId };
  const { row } = await requireAccess(userId, parentId, "edit");
  if (row.kind !== "folder") throw new HttpError(400, "Ziel ist kein Ordner");
  return { ownerId: row.owner_id };
}

/** The folders from the root down to the given node, the node itself last. */
export async function pathTo(id: string | null): Promise<Crumb[]> {
  if (id === null) return [];
  const { rows } = await sql<Crumb & { depth: number }>`
    with recursive up as (
      select id, parent_id, name, 0 as depth from node where id = ${id}
      union all
      select n.id, n.parent_id, n.name, up.depth + 1 from node n join up on n.id = up.parent_id
    )
    select id, name, depth from up order by depth desc
  `.execute(db());
  return rows.map(({ id, name }) => ({ id, name }));
}

/** The path as the user sees it: someone else's folders start at the top-most folder shared with them. */
async function visiblePath(userId: string, id: string | null, ownerId: string): Promise<Crumb[]> {
  const path = await pathTo(id);
  if (ownerId === userId || !path.length) return path;
  const granted = await db()
    .selectFrom("permission")
    .select("node_id")
    .where("node_id", "in", path.map((crumb) => crumb.id))
    .where(forUser(userId))
    .execute();
  const ids = new Set(granted.map((row) => row.node_id));
  const start = path.findIndex((crumb) => ids.has(crumb.id));
  return start < 0 ? [] : path.slice(start);
}

/** Nodes with everything a listing shows: owner address, sharing state and the user's own permission. */
function rows(userId: string) {
  return db()
    .selectFrom("node")
    .innerJoin("user as owner", "owner.id", "node.owner_id")
    .select(COLUMNS)
    .select("owner.email as owner_email")
    .select(
      sql<boolean>`exists (select 1 from share where share.node_id = node.id and (share.expires_on is null or share.expires_on >= current_date))
        or exists (select 1 from permission where permission.node_id = node.id)`.as("shared"),
    )
    .select(sql<boolean | null>`(select bool_or(permission.can_edit) from permission where permission.node_id = node.id and ${forUser(userId)})`.as("own_edit"));
}

/** The children of a folder, for public links. */
export async function children(parentId: string): Promise<Node[]> {
  const found = await db().selectFrom("node").select(COLUMNS).where("parent_id", "=", parentId).execute();
  return found.map(toNode);
}

/**
 * The user's top level: their own top folders and files, plus what others shared with them. A shared
 * node appears only once, at the highest point shared with the user.
 */
async function top(userId: string): Promise<Node[]> {
  const own = await rows(userId).where("node.parent_id", "is", null).where("node.owner_id", "=", userId).execute();
  const { rows: entryIds } = await sql<{ id: string }>`
    select distinct n.id from node n
    join permission on permission.node_id = n.id and ${forUser(userId)}
    where n.owner_id <> ${userId}
      and not exists (
        with recursive up as (
          select parent_id as id from node where id = n.id
          union all
          select m.parent_id from node m join up on m.id = up.id
        )
        select 1 from up join permission q on q.node_id = up.id and (q.user_id = ${userId} or q.user_id is null)
      )
  `.execute(db());
  const shared = entryIds.length ? await rows(userId).where("node.id", "in", entryIds.map((row) => row.id)).execute() : [];
  // Their parent is out of the user's sight, so in this view these sit at the top.
  return [...own.map((row) => toUserNode(row, userId, null)), ...shared.map((row) => ({ ...toUserNode(row, userId, null), parentId: null }))];
}

export async function list(userId: string, parentId: string | null): Promise<Listing> {
  if (parentId === null) return { path: [], access: "owner", items: await top(userId) };
  const { row, access } = await requireAccess(userId, parentId, "view");
  if (row.kind !== "folder") throw new HttpError(400, "Ziel ist kein Ordner");
  const found = await rows(userId).where("node.parent_id", "=", parentId).execute();
  return { path: await visiblePath(userId, parentId, row.owner_id), access, items: found.map((child) => toUserNode(child, userId, access)) };
}

/**
 * The folders the user can move things into: their own, and those inside folders shared with them
 * for editing. A shared folder whose parent they cannot see shows at the top.
 */
export async function folders(userId: string): Promise<Folder[]> {
  const { rows: found } = await sql<{ id: string; parent_id: string | null; name: string; owner_id: string; owner_email: string }>`
    with recursive editable as (
      select n.id from node n
      join permission on permission.node_id = n.id and permission.can_edit and ${forUser(userId)}
      where n.kind = 'folder' and n.owner_id <> ${userId}
      union
      select n.id from node n join editable on n.parent_id = editable.id where n.kind = 'folder'
    )
    select n.id, n.parent_id, n.name, n.owner_id, owner.email as owner_email
    from node n join "user" owner on owner.id = n.owner_id
    where n.kind = 'folder' and (n.owner_id = ${userId} or n.id in (select id from editable))
    order by n.name
  `.execute(db());
  const ids = new Set(found.map((row) => row.id));
  return found.map((row) => ({
    id: row.id,
    parentId: row.parent_id && ids.has(row.parent_id) ? row.parent_id : null,
    name: row.name,
    ownerId: row.owner_id,
    owner: row.owner_id === userId ? null : row.owner_email,
  }));
}

/** A file and its report, for public links. */
export async function details(id: string): Promise<FileDetails> {
  const row = await find(id);
  if (row.kind !== "file") throw new HttpError(400, "Kein Dokument");
  return { node: toNode(row), path: await pathTo(row.parent_id), report: row.report };
}

export async function fileFor(userId: string, id: string): Promise<FileDetails> {
  const { row, access } = await requireAccess(userId, id, "view");
  if (row.kind !== "file") throw new HttpError(400, "Kein Dokument");
  const listed = await rows(userId).where("node.id", "=", id).executeTakeFirstOrThrow();
  const path = await visiblePath(userId, row.parent_id, row.owner_id);
  // The viewer's back button goes to the parent, which must be a folder the user can see.
  const node = { ...toUserNode(listed, userId, access), parentId: path.at(-1)?.id ?? null };
  return { node, path, report: row.report };
}

/** "Rechnung.pdf" becomes "Rechnung (2).pdf" if the folder already has one. Top levels are per owner. */
async function freeName(parentId: string | null, ownerId: string, wanted: string, executor: ReturnType<typeof db> = db()): Promise<string> {
  const query = executor.selectFrom("node").select("name");
  const siblings = await (parentId === null ? query.where("parent_id", "is", null).where("owner_id", "=", ownerId) : query.where("parent_id", "=", parentId)).execute();
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  const dot = wanted.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

async function listed(userId: string, id: string): Promise<Node> {
  const row = await rows(userId).where("node.id", "=", id).executeTakeFirstOrThrow();
  return toUserNode(row, userId, (await accessTo(userId, id)).access);
}

export async function createFolder(userId: string, parentId: string | null, name: string): Promise<Node> {
  const { ownerId } = await target(userId, parentId);
  const { id } = await db()
    .insertInto("node")
    .values({ parent_id: parentId, kind: "folder", name: await freeName(parentId, ownerId, name), created_by: userId, owner_id: ownerId })
    .returning("id")
    .executeTakeFirstOrThrow();
  return listed(userId, id);
}

/** Validation failing (service down) must not lose the upload, so the file is stored without a status. */
async function check(bytes: Uint8Array, name: string) {
  try {
    const report = await validate(bytes, name);
    return { report, status: statusOf(report) };
  } catch (error) {
    console.error(`Validating ${name} failed`, error);
    return { report: null, status: null };
  }
}

export async function upload(userId: string, parentId: string | null, file: File): Promise<Node> {
  if (!ACCEPTED.test(file.name)) throw new HttpError(415, "Nur PDF- und XML-Dateien");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "Datei ist größer als 50 MB");
  const { ownerId } = await target(userId, parentId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `files/${randomUUID()}`;
  const [checked] = await Promise.all([check(bytes, file.name), putObject(key, bytes, file.type || "application/octet-stream")]);
  const { id } = await db()
    .insertInto("node")
    .values({
      parent_id: parentId,
      kind: "file",
      name: await freeName(parentId, ownerId, file.name),
      size: bytes.byteLength,
      storage_key: key,
      status: checked.status,
      report: checked.report ? (JSON.stringify(checked.report) as never) : null,
      created_by: userId,
      owner_id: ownerId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return listed(userId, id);
}

/** Re-running the validator stores a new result, so it needs edit rights. */
export async function revalidate(userId: string, id: string): Promise<FileDetails> {
  const { row } = await requireAccess(userId, id, "edit");
  if (row.kind !== "file" || !row.storage_key) throw new HttpError(400, "Kein Dokument");
  const bytes = await (await getObject(row.storage_key)).bytes();
  const report = await validate(bytes, row.name).catch((error) => {
    console.error(`Validating ${row.name} failed`, error);
    throw new HttpError(502, "Validator nicht erreichbar");
  });
  await db()
    .updateTable("node")
    .set({ report: JSON.stringify(report) as never, status: statusOf(report) })
    .where("id", "=", id)
    .execute();
  return fileFor(userId, id);
}

export async function rename(userId: string, id: string, name: string): Promise<Node> {
  const current = await requireChange(userId, id);
  if (current.kind === "file" && !ACCEPTED.test(name)) throw new HttpError(400, "Die Endung muss .pdf oder .xml bleiben");
  await db().updateTable("node").set({ name, updated_at: new Date() }).where("id", "=", id).execute();
  return listed(userId, id);
}

/**
 * Moves stay within one owner's files. Moving something into another person's folder would hand
 * it over, and moving it out of a shared folder would take it away from the owner.
 */
export async function move(userId: string, ids: string[], parentId: string | null) {
  const moved = await Promise.all(ids.map((id) => requireChange(userId, id)));
  const { ownerId } = await target(userId, parentId);
  if (moved.some((row) => row.owner_id !== ownerId)) throw new HttpError(400, "Verschieben geht nur innerhalb derselben Ablage");
  // A folder cannot go into itself or one of its own subfolders.
  const ancestors = new Set((await pathTo(parentId)).map((crumb) => crumb.id));
  if (ids.some((id) => ancestors.has(id))) throw new HttpError(400, "Ein Ordner kann nicht in sich selbst verschoben werden");
  await db().updateTable("node").set({ parent_id: parentId }).where("id", "in", ids).execute();
}

/** Every file below the given nodes with its path relative to them, plus the folders (so empty ones survive a zip). */
export async function tree(ids: string[]) {
  const { rows: found } = await sql<{ kind: "folder" | "file"; path: string; storage_key: string | null; updated_at: Date }>`
    with recursive down as (
      select id, kind, name::text as path, storage_key, updated_at from node where id = any(${ids}::uuid[])
      union all
      select n.id, n.kind, down.path || '/' || n.name, n.storage_key, n.updated_at from node n join down on n.parent_id = down.id
    )
    select kind, path, storage_key, updated_at from down order by path
  `.execute(db());
  return found;
}

/** What a download contains. Access to a folder covers everything inside it. */
export async function treeFor(userId: string, ids: string[]) {
  for (const id of ids) await requireAccess(userId, id, "view");
  return tree(ids);
}

export async function remove(userId: string, ids: string[]) {
  for (const id of ids) await requireChange(userId, id);
  const keys = (await tree(ids)).flatMap((entry) => (entry.storage_key ? [entry.storage_key] : []));
  await db().deleteFrom("node").where("id", "in", ids).execute();
  // Rows first: a failed S3 call leaves orphaned objects, never a listed file without content.
  await deleteObjects(keys);
}

/** The file itself, for public links. */
export async function content(id: string) {
  const row = await find(id);
  if (row.kind !== "file" || !row.storage_key) throw new HttpError(400, "Kein Dokument");
  return { name: row.name, size: Number(row.size), object: await getObject(row.storage_key) };
}

export async function contentFor(userId: string, id: string) {
  await requireAccess(userId, id, "view");
  return content(id);
}

/**
 * Before a user is deleted, an admin takes over their files: everything moves into one folder
 * "Von <address>" at the admin's top level. Shares with colleagues and links stay as they were.
 */
export async function handOver(from: { id: string; email: string }, toUserId: string) {
  await db()
    .transaction()
    .execute(async (trx) => {
      const tops = await trx.selectFrom("node").select("id").where("owner_id", "=", from.id).where("parent_id", "is", null).execute();
      if (tops.length) {
        const name = await freeName(null, toUserId, `Von ${from.email}`, trx);
        const folder = await trx
          .insertInto("node")
          .values({ parent_id: null, kind: "folder", name, created_by: toUserId, owner_id: toUserId })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx.updateTable("node").set({ parent_id: folder.id }).where("id", "in", tops.map((row) => row.id)).execute();
      }
      const owned = await trx.updateTable("node").set({ owner_id: toUserId }).where("owner_id", "=", from.id).returning("id").execute();
      // A share with the new owner on their own files means nothing.
      if (owned.length) await trx.deleteFrom("permission").where("user_id", "=", toUserId).where("node_id", "in", owned.map((row) => row.id)).execute();
    });
}
