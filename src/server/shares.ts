import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import type { Crumb, FileDetails, Listing, Share, ShareInfo } from "@/lib/nodes";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { sendShareCode, sendShareInvitation } from "./mail";
import { children, content, details, find, pathTo, tree } from "./nodes";

/*
 * A share gives one outside person read access to a folder or file. The link alone is not enough:
 * the visitor asks for a code, the app mails it to the address the share was made for, and only
 * the code unlocks the link in that browser. A forwarded link is useless without that mailbox.
 */

type Row = {
  id: string;
  token: string;
  node_id: string;
  email: string;
  expires_on: string | null;
  expired: boolean;
  created_at: Date;
  created_by: string | null;
  code_hash: string | null;
  code_sent_at: Date | null;
  code_attempts: number;
};

const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
/** How long a confirmed browser keeps access before it needs a new code. */
const SESSION_HOURS = 24;

/** Every query reads the date as text, because pg turns a date column into a Date at local midnight. */
function shares() {
  return db()
    .selectFrom("share")
    .leftJoin("user", "user.id", "share.created_by")
    .select([
      "share.id",
      "share.token",
      "share.node_id",
      "share.email",
      "share.created_at",
      "share.code_hash",
      "share.code_sent_at",
      "share.code_attempts",
      "user.email as created_by",
      sql<string | null>`to_char(share.expires_on, 'YYYY-MM-DD')`.as("expires_on"),
      sql<boolean>`coalesce(share.expires_on < current_date, false)`.as("expired"),
    ]);
}

function toShare(row: Row): Share {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    expiresOn: row.expires_on,
    expired: row.expired,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  };
}

/** Keyed with the app secret, so a leaked database does not reveal codes or let anyone forge cookies. */
function mac(purpose: string, ...parts: string[]) {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update([purpose, ...parts].join("\n")).digest("base64url");
}

function same(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* Inside the app */

export async function sharesOf(nodeId: string): Promise<Share[]> {
  await find(nodeId);
  const rows = await shares().where("share.node_id", "=", nodeId).orderBy("share.created_at").execute();
  return rows.map(toShare);
}

export async function createShare(nodeId: string, options: { email: string; expiresOn?: string | null }, user: { id: string; name: string; email: string }): Promise<Share> {
  const node = await find(nodeId);
  if (options.expiresOn) {
    // Same clock as the expiry check in shares(), so a link is never born expired.
    const { rows } = await sql<{ past: boolean }>`select ${options.expiresOn}::date < current_date as past`.execute(db());
    if (rows[0].past) throw new HttpError(400, "Das Ablaufdatum liegt in der Vergangenheit");
  }
  const { id, token } = await db()
    .insertInto("share")
    // 144 random bits: nobody guesses a link.
    .values({ token: randomBytes(18).toString("base64url"), node_id: nodeId, email: options.email, expires_on: options.expiresOn ?? null, created_by: user.id })
    .returning(["id", "token"])
    .executeTakeFirstOrThrow();
  const inviter = user.name && user.name !== user.email.split("@")[0] ? user.name : user.email;
  await sendShareInvitation(options.email, { inviter, name: node.name, url: `${env().APP_URL}/s/${token}`, expiresOn: options.expiresOn ?? null }).catch(async (error) => {
    console.error("Sending the share invitation failed", error);
    // A link nobody was told about is clutter; the person sharing can try again.
    await db().deleteFrom("share").where("id", "=", id).execute();
    throw new HttpError(502, "Die E-Mail konnte nicht gesendet werden");
  });
  return toShare((await shares().where("share.id", "=", id).executeTakeFirstOrThrow()) as Row);
}

export async function deleteShare(id: string) {
  const { numDeletedRows } = await db().deleteFrom("share").where("id", "=", id).executeTakeFirst();
  if (!numDeletedRows) throw new HttpError(404, "Nicht gefunden");
}

/* Visitors */

async function lookup(token: string): Promise<Row> {
  const row = await shares().where("share.token", "=", token).executeTakeFirst();
  // Unknown and expired links look the same, so nobody learns which tokens once existed.
  if (!row || row.expired) throw new HttpError(404, "Diesen Link gibt es nicht oder er ist abgelaufen");
  return row as Row;
}

function cookieName(share: Row) {
  return `zugferd_share_${share.id}`;
}

/** "max.mustermann@firma.de" becomes "m•••@firma.de". */
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** The cookie says: this browser confirmed a code for this share and this address, until the time in it. */
function sessionCookie(share: Row, until: number) {
  return `${until}.${mac("share-session", share.id, share.email, String(until))}`;
}

function isUnlocked(share: Row, request: Request) {
  const name = cookieName(share);
  const cookies = request.headers.get("cookie") ?? "";
  const sent = cookies.split(/;\s*/).find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!sent) return false;
  const until = Number(sent.split(".")[0]);
  return Number.isSafeInteger(until) && until > Date.now() && same(sent, sessionCookie(share, until));
}

/** The share behind a token, if this browser has confirmed a code for it. */
export async function access(token: string, request: Request): Promise<Row> {
  const share = await lookup(token);
  if (!isUnlocked(share, request)) throw new HttpError(403, "Bitte zuerst den Code aus der E-Mail eingeben");
  return share;
}

export async function info(token: string, request: Request): Promise<ShareInfo> {
  const share = await lookup(token);
  if (!isUnlocked(share, request)) return { locked: true, email: maskEmail(share.email) };
  const node = await find(share.node_id);
  return { locked: false, kind: node.kind, name: node.name, rootId: node.id, expiresOn: share.expires_on };
}

/** Mails a fresh code to the share's address. The visitor never names the address, so the code cannot go anywhere else. */
export async function requestCode(token: string) {
  const share = await lookup(token);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // A new code replaces the old one and resets the attempts. The time check sits in the update,
  // so parallel requests cannot each send a code.
  const { numUpdatedRows } = await db()
    .updateTable("share")
    .set({ code_hash: mac("share-code", share.id, code), code_sent_at: new Date(), code_attempts: 0 })
    .where("id", "=", share.id)
    .where((eb) => eb.or([eb("code_sent_at", "is", null), eb("code_sent_at", "<", sql<Date>`now() - make_interval(secs => ${RESEND_SECONDS})`)]))
    .executeTakeFirst();
  if (!numUpdatedRows) throw new HttpError(429, "Ein Code ist gerade unterwegs. Einen neuen gibt es nach einer Minute.");
  await sendShareCode(share.email, code).catch((error) => {
    console.error("Sending the share code failed", error);
    throw new HttpError(502, "Die E-Mail konnte nicht gesendet werden");
  });
}

/** Checks the code and returns the Set-Cookie header that unlocks the link in this browser. */
export async function unlock(token: string, code: string): Promise<string> {
  const share = await lookup(token);
  const fresh = share.code_hash && share.code_sent_at && Date.now() - share.code_sent_at.getTime() < CODE_MINUTES * 60 * 1000;
  if (!fresh || share.code_attempts >= CODE_ATTEMPTS) throw new HttpError(403, "Der Code ist abgelaufen. Bitte einen neuen anfordern.");

  // Counted before comparing, in one statement, so parallel guesses cannot slip past the limit.
  const counted = await db()
    .updateTable("share")
    .set((eb) => ({ code_attempts: eb("code_attempts", "+", 1) }))
    .where("id", "=", share.id)
    .where("code_hash", "=", share.code_hash)
    .where("code_attempts", "<", CODE_ATTEMPTS)
    .executeTakeFirst();
  if (!counted.numUpdatedRows) throw new HttpError(403, "Der Code ist abgelaufen. Bitte einen neuen anfordern.");
  if (!same(mac("share-code", share.id, code.trim()), share.code_hash!)) throw new HttpError(403, "Der Code stimmt nicht");

  // A code works once: of two parallel requests with the right code, only the one that clears it gets in.
  const used = await db().updateTable("share").set({ code_hash: null }).where("id", "=", share.id).where("code_hash", "=", share.code_hash).executeTakeFirst();
  if (!used.numUpdatedRows) throw new HttpError(403, "Der Code ist abgelaufen. Bitte einen neuen anfordern.");
  const until = Date.now() + SESSION_HOURS * 3600 * 1000;
  const secure = env().APP_URL.startsWith("https:") ? "; Secure" : "";
  return `${cookieName(share)}=${sessionCookie(share, until)}; Path=/api/s/${token}; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`;
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

/** The shared node is the visitor's root: it and its direct children show no parent, like the root in the app. */
function relativeParent(share: Row, node: { id: string; parentId: string | null }) {
  return node.id === share.node_id || node.parentId === share.node_id ? null : node.parentId;
}

export async function sharedList(share: Row, parentId: string | null): Promise<Listing> {
  const folderId = parentId ?? share.node_id;
  const path = await relativePath(share, folderId);
  if ((await find(folderId)).kind !== "folder") throw new HttpError(400, "Kein Ordner");
  const items = await children(folderId);
  // Whether something inside is shared again is the owner's business.
  return { path, items: items.map((node) => ({ ...node, parentId: relativeParent(share, node), shared: false })) };
}

export async function sharedDetails(share: Row, id: string): Promise<FileDetails> {
  const path = await relativePath(share, id);
  const file = await details(id);
  return { ...file, path: path.slice(0, -1), node: { ...file.node, parentId: relativeParent(share, file.node), shared: false } };
}

export async function sharedContent(share: Row, id: string) {
  await relativePath(share, id);
  return content(id);
}

export async function sharedTree(share: Row, ids: string[]) {
  for (const id of ids) await relativePath(share, id);
  return tree(ids);
}
