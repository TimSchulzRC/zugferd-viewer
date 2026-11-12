import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { ACCEPTED, MAX_FILE_BYTES, type Crumb, type FileDetails, type Folder, type Listing, type Node } from "@/lib/nodes";
import { db } from "./db";
import { HttpError } from "./http";
import { deleteObjects, getObject, putObject } from "./storage";
import { statusOf, validate } from "./validate";

const COLUMNS = ["id", "parent_id", "kind", "name", "size", "status", "updated_at"] as const;
type Row = { id: string; parent_id: string | null; kind: "folder" | "file"; name: string; size: number | string | null; status: Node["status"]; updated_at: Date };

function toNode(row: Row): Node {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: row.kind,
    name: row.name,
    size: row.size === null ? null : Number(row.size),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function find(id: string) {
  const row = await db().selectFrom("node").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, "Nicht gefunden");
  return row;
}

async function requireFolder(id: string | null) {
  if (id === null) return;
  if ((await find(id)).kind !== "folder") throw new HttpError(400, "Ziel ist kein Ordner");
}

/** The folders from the root down to the given node, the node itself last. */
async function pathTo(id: string | null): Promise<Crumb[]> {
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

export async function list(parentId: string | null): Promise<Listing> {
  await requireFolder(parentId);
  const query = db().selectFrom("node").select(COLUMNS);
  const rows = await (parentId === null ? query.where("parent_id", "is", null) : query.where("parent_id", "=", parentId)).execute();
  return { path: await pathTo(parentId), items: rows.map(toNode) };
}

export async function folders(): Promise<Folder[]> {
  const rows = await db().selectFrom("node").select(["id", "parent_id", "name"]).where("kind", "=", "folder").orderBy("name").execute();
  return rows.map((row) => ({ id: row.id, parentId: row.parent_id, name: row.name }));
}

export async function details(id: string): Promise<FileDetails> {
  const row = await find(id);
  if (row.kind !== "file") throw new HttpError(400, "Kein Dokument");
  return { node: toNode(row), path: await pathTo(row.parent_id), report: row.report };
}

/** "Rechnung.pdf" becomes "Rechnung (2).pdf" if the folder already has one. */
async function freeName(parentId: string | null, wanted: string): Promise<string> {
  const query = db().selectFrom("node").select("name");
  const siblings = await (parentId === null ? query.where("parent_id", "is", null) : query.where("parent_id", "=", parentId)).execute();
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  const dot = wanted.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export async function createFolder(parentId: string | null, name: string, userId: string): Promise<Node> {
  await requireFolder(parentId);
  const row = await db()
    .insertInto("node")
    .values({ parent_id: parentId, kind: "folder", name: await freeName(parentId, name), created_by: userId })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  return toNode(row);
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

export async function upload(parentId: string | null, file: File, userId: string): Promise<Node> {
  if (!ACCEPTED.test(file.name)) throw new HttpError(415, "Nur PDF- und XML-Dateien");
  if (file.size > MAX_FILE_BYTES) throw new HttpError(413, "Datei ist größer als 50 MB");
  await requireFolder(parentId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `files/${randomUUID()}`;
  const [checked] = await Promise.all([check(bytes, file.name), putObject(key, bytes, file.type || "application/octet-stream")]);
  const row = await db()
    .insertInto("node")
    .values({
      parent_id: parentId,
      kind: "file",
      name: await freeName(parentId, file.name),
      size: bytes.byteLength,
      storage_key: key,
      status: checked.status,
      report: checked.report ? (JSON.stringify(checked.report) as never) : null,
      created_by: userId,
    })
    .returning(COLUMNS)
    .executeTakeFirstOrThrow();
  return toNode(row);
}

export async function revalidate(id: string): Promise<FileDetails> {
  const row = await find(id);
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
  return details(id);
}

export async function rename(id: string, name: string): Promise<Node> {
  const current = await find(id);
  if (current.kind === "file" && !ACCEPTED.test(name)) throw new HttpError(400, "Die Endung muss .pdf oder .xml bleiben");
  const row = await db().updateTable("node").set({ name, updated_at: new Date() }).where("id", "=", id).returning(COLUMNS).executeTakeFirstOrThrow();
  return toNode(row);
}

export async function move(ids: string[], parentId: string | null) {
  await requireFolder(parentId);
  // A folder cannot go into itself or one of its own subfolders.
  const ancestors = new Set((await pathTo(parentId)).map((crumb) => crumb.id));
  if (ids.some((id) => ancestors.has(id))) throw new HttpError(400, "Ein Ordner kann nicht in sich selbst verschoben werden");
  await db().updateTable("node").set({ parent_id: parentId }).where("id", "in", ids).execute();
}

/** Every file below the given nodes with its path relative to them, plus the folders (so empty ones survive a zip). */
export async function tree(ids: string[]) {
  const { rows } = await sql<{ kind: "folder" | "file"; path: string; storage_key: string | null; updated_at: Date }>`
    with recursive down as (
      select id, kind, name::text as path, storage_key, updated_at from node where id = any(${ids}::uuid[])
      union all
      select n.id, n.kind, down.path || '/' || n.name, n.storage_key, n.updated_at from node n join down on n.parent_id = down.id
    )
    select kind, path, storage_key, updated_at from down order by path
  `.execute(db());
  return rows;
}

export async function remove(ids: string[]) {
  const keys = (await tree(ids)).flatMap((entry) => (entry.storage_key ? [entry.storage_key] : []));
  await db().deleteFrom("node").where("id", "in", ids).execute();
  // Rows first: a failed S3 call leaves orphaned objects, never a listed file without content.
  await deleteObjects(keys);
}

export async function content(id: string) {
  const row = await find(id);
  if (row.kind !== "file" || !row.storage_key) throw new HttpError(400, "Kein Dokument");
  return { name: row.name, size: Number(row.size), object: await getObject(row.storage_key) };
}
