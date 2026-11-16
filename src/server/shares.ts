import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "kysely";
import type { Crumb, FileDetails, Listing, Share, ShareInfo } from "@/lib/nodes";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { children, content, details, find, pathTo, tree } from "./nodes";

const hash = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

type Row = { id: string; token: string; node_id: string; password_hash: string | null; expires_on: string | null; expired: boolean; created_at: Date; created_by: string | null };

/** Every query reads the date as text, because pg turns a date column into a Date at local midnight. */
function shares() {
  return db()
    .selectFrom("share")
    .leftJoin("user", "user.id", "share.created_by")
    .select([
      "share.id",
      "share.token",
      "share.node_id",
      "share.password_hash",
      "share.created_at",
      "user.email as created_by",
      sql<string | null>`to_char(share.expires_on, 'YYYY-MM-DD')`.as("expires_on"),
      sql<boolean>`coalesce(share.expires_on < current_date, false)`.as("expired"),
    ]);
}

function toShare(row: Row): Share {
  return {
    id: row.id,
    token: row.token,
    hasPassword: row.password_hash !== null,
    expiresOn: row.expires_on,
    expired: row.expired,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await hash(password, salt, 32)).toString("hex")}`;
}

async function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  const actual = await hash(password, Buffer.from(salt, "hex"), 32);
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

export async function sharesOf(nodeId: string): Promise<Share[]> {
  await find(nodeId);
  const rows = await shares().where("share.node_id", "=", nodeId).orderBy("share.created_at").execute();
  return rows.map(toShare);
}

export async function createShare(nodeId: string, options: { password?: string; expiresOn?: string | null }, userId: string): Promise<Share> {
  await find(nodeId);
  if (options.expiresOn) {
    // Same clock as the expiry check in shares(), so a link is never born expired.
    const { rows } = await sql<{ past: boolean }>`select ${options.expiresOn}::date < current_date as past`.execute(db());
    if (rows[0].past) throw new HttpError(400, "Das Ablaufdatum liegt in der Vergangenheit");
  }
  const password = options.password?.trim() ? options.password : null;
  const { id } = await db()
    .insertInto("share")
    .values({
      // 144 random bits: nobody guesses a link.
      token: randomBytes(18).toString("base64url"),
      node_id: nodeId,
      password_hash: password ? await hashPassword(password) : null,
      expires_on: options.expiresOn ?? null,
      created_by: userId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return toShare((await shares().where("share.id", "=", id).executeTakeFirstOrThrow()) as Row);
}

export async function deleteShare(id: string) {
  const { numDeletedRows } = await db().deleteFrom("share").where("id", "=", id).executeTakeFirst();
  if (!numDeletedRows) throw new HttpError(404, "Nicht gefunden");
}

/* Visitors */

const COOKIE_DAYS = 7;

async function lookup(token: string): Promise<Row> {
  const row = await shares().where("share.token", "=", token).executeTakeFirst();
  // Unknown and expired links look the same, so nobody learns which tokens once existed.
  if (!row || row.expired) throw new HttpError(404, "Diesen Link gibt es nicht oder er ist abgelaufen");
  return row as Row;
}

/** The cookie proves the visitor typed the current password. A new or removed password makes old cookies useless. */
function cookieName(share: Row) {
  return `zugferd_share_${share.id}`;
}

function cookieValue(share: Row) {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`share:${share.id}:${share.password_hash}`).digest("base64url");
}

function isUnlocked(share: Row, request: Request) {
  if (!share.password_hash) return true;
  const cookies = request.headers.get("cookie") ?? "";
  const sent = cookies.split(/;\s*/).find((pair) => pair.startsWith(`${cookieName(share)}=`))?.slice(cookieName(share).length + 1);
  if (!sent) return false;
  const expected = Buffer.from(cookieValue(share));
  const actual = Buffer.from(sent);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The share behind a token, if the visitor may see it. */
export async function access(token: string, request: Request): Promise<Row> {
  const share = await lookup(token);
  if (!isUnlocked(share, request)) throw new HttpError(403, "Passwort nötig");
  return share;
}

export async function info(token: string, request: Request): Promise<ShareInfo> {
  const share = await lookup(token);
  if (!isUnlocked(share, request)) return { locked: true };
  const node = await find(share.node_id);
  return { locked: false, kind: node.kind, name: node.name, rootId: node.id, expiresOn: share.expires_on };
}

/** Failed password attempts per link, so a weak password cannot be tried out quickly. Per process, which is enough for one container. */
const attempts = new Map<string, { count: number; since: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

/** Checks the password and returns the Set-Cookie header that unlocks the link. */
export async function unlock(token: string, password: string): Promise<string> {
  const share = await lookup(token);
  if (share.password_hash) {
    const now = Date.now();
    const record = attempts.get(share.id);
    const current = record && now - record.since < WINDOW_MS ? record : { count: 0, since: now };
    if (current.count >= MAX_ATTEMPTS) throw new HttpError(429, "Zu viele Versuche. Bitte in 15 Minuten noch einmal.");
    if (!(await passwordMatches(password, share.password_hash))) {
      attempts.set(share.id, { ...current, count: current.count + 1 });
      throw new HttpError(403, "Falsches Passwort");
    }
    attempts.delete(share.id);
  }
  const secure = env().APP_URL.startsWith("https:") ? "; Secure" : "";
  return `${cookieName(share)}=${cookieValue(share)}; Path=/api/s/${token}; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * The path of a node below the shared one, without the shared node itself. Throws for anything
 * outside the share, so a visitor cannot reach other folders by guessing ids.
 */
async function relativePath(share: Row, id: string): Promise<Crumb[]> {
  const path = await pathTo(id);
  const start = path.findIndex((crumb) => crumb.id === share.node_id);
  if (start < 0) throw new HttpError(404, "Nicht gefunden");
  return path.slice(start + 1);
}

/** The shared node is the visitor's root, so it appears as null, like the root in the app. */
function relativeParent(share: Row, parentId: string | null) {
  return parentId === share.node_id ? null : parentId;
}

export async function sharedList(share: Row, parentId: string | null): Promise<Listing> {
  const folderId = parentId ?? share.node_id;
  const path = await relativePath(share, folderId);
  if ((await find(folderId)).kind !== "folder") throw new HttpError(400, "Kein Ordner");
  const items = await children(folderId);
  // Whether something inside is shared again is the owner's business.
  return { path, items: items.map((node) => ({ ...node, parentId: relativeParent(share, node.parentId), shared: false })) };
}

export async function sharedDetails(share: Row, id: string): Promise<FileDetails> {
  const path = await relativePath(share, id);
  const file = await details(id);
  return { ...file, path: path.slice(0, -1), node: { ...file.node, parentId: relativeParent(share, file.node.parentId), shared: false } };
}

export async function sharedContent(share: Row, id: string) {
  await relativePath(share, id);
  return content(id);
}

export async function sharedTree(share: Row, ids: string[]) {
  for (const id of ids) await relativePath(share, id);
  return tree(ids);
}
