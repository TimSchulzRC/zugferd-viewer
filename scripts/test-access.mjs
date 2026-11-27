#!/usr/bin/env node
/*
 * Checks who sees what, against a running dev server (`pnpm dev`, no LETTERMINT_TOKEN, so every
 * login code is 000000). It signs in as demo users through the real API, builds a small scenario,
 * prints one line per check and leaves the scenario in place, so you can click through it.
 *
 *   pnpm test:access                     # URL from .env.local (PUBLIC_URL, else APP_URL)
 *   pnpm test:access http://host:3001    # or name it
 *
 * Demo users: anna@demo.test, ben@demo.test, carla@demo.test. dora@demo.test is created and
 * removed again in every run. Each run first deletes what the demo users own, then starts fresh.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const BASE = (process.argv[2] ?? process.env.PUBLIC_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ADMIN = process.env.ADMIN_EMAIL?.toLowerCase();
if (!ADMIN) throw new Error("ADMIN_EMAIL fehlt (in .env.local oder als Umgebungsvariable)");

const ANNA = "anna@demo.test";
const BEN = "ben@demo.test";
const CARLA = "carla@demo.test";
const DORA = "dora@demo.test";

const results = [];
let section = "";

function check(label, ok, detail = "") {
  results.push({ section, label, ok });
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label}${ok || !detail ? "" : `  \x1b[2m(${detail})\x1b[0m`}`);
}

function heading(text) {
  section = text;
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

/** A signed-in browser: keeps its cookies and sends the Origin header the app expects. */
class Session {
  constructor(email) {
    this.email = email;
    this.cookies = new Map();
  }

  async fetch(path, { method = "GET", json, form, body: raw, headers: extra = {} } = {}) {
    const headers = { origin: BASE, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...extra };
    let body = raw;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(json);
    } else if (form) body = form;
    const response = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair.indexOf("=");
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: response.status, data, text };
  }

  async signIn() {
    const sent = await this.fetch("/api/auth/email-otp/send-verification-otp", { method: "POST", json: { email: this.email, type: "sign-in" } });
    if (sent.status !== 200) throw new Error(`Code für ${this.email} nicht angefordert: ${sent.status} ${JSON.stringify(sent.data)}`);
    const signed = await this.fetch("/api/auth/sign-in/email-otp", { method: "POST", json: { email: this.email, otp: "000000" } });
    if (signed.status !== 200) {
      throw new Error(
        `Anmeldung als ${this.email} mit Code 000000 fehlgeschlagen (${signed.status}). Läuft der Server mit \`pnpm dev\` und ohne LETTERMINT_TOKEN?`,
      );
    }
    return this;
  }

  root() {
    return this.fetch("/api/nodes");
  }
  list(id) {
    return this.fetch(`/api/nodes?parent=${id}`);
  }
  folder(parentId, name) {
    return this.fetch("/api/nodes", { method: "POST", json: { parentId, name } });
  }
  upload(parentId, name) {
    const form = new FormData();
    form.set("file", new File([invoice(name)], name, { type: "application/xml" }));
    if (parentId) form.set("parentId", parentId);
    return this.fetch("/api/nodes/upload", { method: "POST", form });
  }
  file(id) {
    return this.fetch(`/api/nodes/${id}`);
  }
  content(id) {
    return this.fetch(`/api/nodes/${id}/content`);
  }
  download(ids) {
    return this.fetch(`/api/download?ids=${ids.join(",")}`);
  }
  rename(id, name) {
    return this.fetch(`/api/nodes/${id}`, { method: "PATCH", json: { name } });
  }
  move(ids, parentId) {
    return this.fetch("/api/nodes/bulk", { method: "POST", json: { action: "move", ids, parentId } });
  }
  remove(ids) {
    return this.fetch("/api/nodes/bulk", { method: "POST", json: { action: "delete", ids } });
  }
  revalidate(id) {
    return this.fetch(`/api/nodes/${id}/validate`, { method: "POST" });
  }
  grant(id, userId, canEdit) {
    return this.fetch(`/api/nodes/${id}/permissions`, { method: "POST", json: { userId, canEdit } });
  }
  permissions(id) {
    return this.fetch(`/api/nodes/${id}/permissions`);
  }
  revoke(permissionId) {
    return this.fetch(`/api/permissions/${permissionId}`, { method: "DELETE" });
  }
  linkShares(id) {
    return this.fetch(`/api/nodes/${id}/shares`);
  }
  createLink(id, email, expiresOn = null) {
    return this.fetch(`/api/nodes/${id}/shares`, { method: "POST", json: { email, expiresOn } });
  }
  allowUpload(shareId, canUpload) {
    return this.fetch(`/api/shares/${shareId}`, { method: "PATCH", json: { canUpload } });
  }
  deleteLink(shareId) {
    return this.fetch(`/api/shares/${shareId}`, { method: "DELETE" });
  }
  folders() {
    return this.fetch("/api/folders");
  }
  colleagues() {
    return this.fetch("/api/users");
  }
}

/** Someone outside with a link: confirms the mailed code (000000 in dev) and keeps the cookie. */
class Visitor extends Session {
  constructor(token) {
    super("visitor");
    this.base = `/api/s/${token}`;
  }
  async unlock() {
    await must(await this.fetch(`${this.base}/code`, { method: "POST" }), "Code anfordern");
    await must(await this.fetch(`${this.base}/unlock`, { method: "POST", json: { code: "000000" } }), "Code eingeben");
    return this;
  }
  info() {
    return this.fetch(this.base);
  }
  list(parentId) {
    return this.fetch(`${this.base}/nodes${parentId ? `?parent=${parentId}` : ""}`);
  }
  upload(parentId, name, content = invoice(name), headers = {}) {
    return this.fetch(`${this.base}/upload${parentId ? `?parent=${encodeURIComponent(parentId)}` : ""}`, {
      method: "POST",
      body: content,
      headers: { "x-file-name": encodeURIComponent(name), ...headers },
    });
  }
  /**
   * A request the browser would never send: chunked without a length, or a length far too big. It
   * stays open until the server answers or release() is called, so it can also hold an upload slot.
   */
  raw(headers, body) {
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let request;
    const status = new Promise((resolve) => {
      request = httpRequest(BASE + `${this.base}/upload`, { method: "POST", headers: { origin: BASE, cookie, "x-file-name": "offen.txt", ...headers } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", () => resolve("abgebrochen"));
      request.setTimeout(10_000, () => request.destroy());
      request.write(body);
      if (headers["transfer-encoding"]) request.end();
    });
    return Object.assign(status, { release: () => request.destroy() });
  }
}

/** A tiny CII invoice. The validator will find faults in it; that does not matter here. */
function invoice(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument><ram:ID>${name}</ram:ID><ram:TypeCode>380</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">20261117</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
</rsm:CrossIndustryInvoice>`;
}

const names = (listing) => (listing.data?.items ?? []).map((item) => item.name);
const byName = (listing, name) => listing.data?.items?.find((item) => item.name === name);
const statusIs = (response, expected) => [response.status === expected, `HTTP ${response.status}, erwartet ${expected}`];

async function must(response, what) {
  if (response.status !== 200) throw new Error(`${what}: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}

console.log(`Server: ${BASE}`);
const admin = await new Session(ADMIN).signIn();

// Demo users exist after the first run; inviting them again only resends the (logged) invitation.
for (const email of [ANNA, BEN, CARLA, DORA]) {
  const invited = await admin.fetch("/api/users/invite", { method: "POST", json: { email } });
  if (invited.status !== 200 && invited.status !== 409) throw new Error(`Einladung an ${email}: HTTP ${invited.status} ${JSON.stringify(invited.data)}`);
}
const anna = await new Session(ANNA).signIn();
const ben = await new Session(BEN).signIn();
const carla = await new Session(CARLA).signIn();
const dora = await new Session(DORA).signIn();

// Start from scratch: each demo user deletes what they own at their top level.
for (const session of [anna, ben, carla, dora]) {
  const own = ((await session.root()).data?.items ?? []).filter((item) => item.access === "owner");
  if (own.length) await must(await session.remove(own.map((item) => item.id)), `Aufräumen bei ${session.email}`);
}
const adminLeftovers = ((await admin.root()).data?.items ?? []).filter((item) => item.access === "owner" && item.name.startsWith(`Von ${DORA}`));
if (adminLeftovers.length) await must(await admin.remove(adminLeftovers.map((item) => item.id)), "Aufräumen beim Admin");

const people = Object.fromEntries(((await admin.colleagues()).data ?? []).map((user) => [user.email, user.id]));
const BEN_ID = people[BEN];
const CARLA_ID = people[CARLA];

heading("Aufbau");
const privat = await must(await anna.folder(null, "Anna privat"), "Ordner anlegen");
await must(await anna.upload(privat.id, "rechnung-privat.xml"), "Hochladen");
const alle = await must(await anna.folder(null, "Anna für alle (ansehen)"), "Ordner anlegen");
const alleFile = await must(await anna.upload(alle.id, "rechnung-alle.xml"), "Hochladen");
const unter = await must(await anna.folder(alle.id, "Unterordner"), "Ordner anlegen");
const unterFile = await must(await anna.upload(unter.id, "rechnung-unterordner.xml"), "Hochladen");
const fuerBen = await must(await anna.folder(null, "Anna für Ben (bearbeiten)"), "Ordner anlegen");
const fuerBenFile = await must(await anna.upload(fuerBen.id, "rechnung-fuer-ben.xml"), "Hochladen");
const benPrivat = await must(await ben.folder(null, "Ben privat"), "Ordner anlegen");
const benFile = await must(await ben.upload(benPrivat.id, "rechnung-ben.xml"), "Hochladen");
await must(await anna.grant(alle.id, null, false), "Für alle teilen");
await must(await anna.grant(fuerBen.id, BEN_ID, true), "Für Ben teilen");
console.log("  Anna: »Anna privat«, »Anna für alle (ansehen)« (alle, ansehen), »Anna für Ben (bearbeiten)« (Ben, bearbeiten)");
console.log("  Ben:  »Ben privat«");

heading("1. Jeder sieht oben nur Eigenes und was mit ihm geteilt ist");
{
  const a = names(await anna.root());
  check("Anna sieht ihre drei Ordner", ["Anna privat", "Anna für alle (ansehen)", "Anna für Ben (bearbeiten)"].every((n) => a.includes(n)), a.join(", "));
  check("Anna sieht »Ben privat« nicht", !a.includes("Ben privat"));
  const b = names(await ben.root());
  check("Ben sieht »Ben privat«, »Anna für alle« und »Anna für Ben«", ["Ben privat", "Anna für alle (ansehen)", "Anna für Ben (bearbeiten)"].every((n) => b.includes(n)), b.join(", "));
  check("Ben sieht »Anna privat« nicht", !b.includes("Anna privat"));
  // Only the demo folders count: older data in a dev database stays shared with everyone after the update.
  const c = names(await carla.root());
  check("Carla sieht »Anna für alle«", c.includes("Anna für alle (ansehen)"), c.join(", ") || "nichts");
  check("Carla sieht weder »Anna privat« noch »Anna für Ben« noch »Ben privat«", !["Anna privat", "Anna für Ben (bearbeiten)", "Ben privat"].some((n) => c.includes(n)), c.join(", "));
  const d = names(await admin.root());
  check("Der Admin sieht »Anna privat« und »Ben privat« nicht", !d.includes("Anna privat") && !d.includes("Ben privat"), d.join(", "));
  const shared = byName(await ben.root(), "Anna für alle (ansehen)");
  check("Geteiltes zeigt die Besitzerin an", shared?.owner === ANNA, `owner = ${shared?.owner}`);
  check("Anna sieht ihre geteilten Ordner als geteilt markiert", byName(await anna.root(), "Anna für alle (ansehen)")?.shared === true && byName(await anna.root(), "Anna privat")?.shared === false);
}

heading("2. Fremde IDs helfen nicht weiter (Ben gegen »Anna privat«)");
{
  const privatFile = (await anna.list(privat.id)).data.items[0];
  check("Ordner öffnen → 404", ...statusIs(await ben.list(privat.id), 404));
  check("Datei öffnen → 404", ...statusIs(await ben.file(privatFile.id), 404));
  check("Dateiinhalt laden → 404", ...statusIs(await ben.content(privatFile.id), 404));
  check("Herunterladen → 404", ...statusIs(await ben.download([privat.id]), 404));
  check("Umbenennen → 404", ...statusIs(await ben.rename(privat.id, "gehackt"), 404));
  check("Löschen → 404", ...statusIs(await ben.remove([privatFile.id]), 404));
  check("Hineinladen → 404", ...statusIs(await ben.upload(privat.id, "fremd.xml"), 404));
  check("Sich selbst freigeben → 404", ...statusIs(await ben.grant(privat.id, BEN_ID, true), 404));
  check("Externe Links ansehen → 404", ...statusIs(await ben.linkShares(privat.id), 404));
  check("Eigene Datei dorthin verschieben → 404", ...statusIs(await ben.move([benFile.id], privat.id), 404));
  check("Der Admin kommt auch nicht hinein → 404", ...statusIs(await admin.list(privat.id), 404));
}

heading("3. Für alle geteilt, nur ansehen (Carla in »Anna für alle«)");
{
  const listing = await carla.list(alle.id);
  check("Ordner öffnen", listing.status === 200 && names(listing).includes("Unterordner"), `HTTP ${listing.status}`);
  check("Rechte im Ordner: ansehen", listing.data?.access === "view", `access = ${listing.data?.access}`);
  check("Pfad beginnt beim geteilten Ordner", JSON.stringify(listing.data?.path?.map((c) => c.name)) === JSON.stringify(["Anna für alle (ansehen)"]));
  check("Unterordner ist mit freigegeben", names(await carla.list(unter.id)).includes("rechnung-unterordner.xml"));
  check("Datei mit Prüfergebnis öffnen", (await carla.file(unterFile.id)).status === 200);
  check("Dateiinhalt laden", (await carla.content(alleFile.id)).status === 200);
  check("Ordner als Zip herunterladen", (await carla.download([alle.id])).status === 200);
  check("Hochladen → 403", ...statusIs(await carla.upload(alle.id, "carla.xml"), 403));
  check("Ordner anlegen → 403", ...statusIs(await carla.folder(alle.id, "Carlas Ordner"), 403));
  check("Datei umbenennen → 403", ...statusIs(await carla.rename(alleFile.id, "umbenannt.xml"), 403));
  check("Datei löschen → 403", ...statusIs(await carla.remove([alleFile.id]), 403));
  check("Erneut prüfen → 403", ...statusIs(await carla.revalidate(alleFile.id), 403));
  check("Weiter teilen → 403", ...statusIs(await carla.grant(alle.id, BEN_ID, true), 403));
  check("Den geteilten Ordner selbst löschen → 403", ...statusIs(await carla.remove([alle.id]), 403));
}

heading("4. Für eine Person geteilt, bearbeiten (Ben in »Anna für Ben«)");
let benUpload;
{
  check("Carla sieht den Ordner nicht → 404", ...statusIs(await carla.list(fuerBen.id), 404));
  const listing = await ben.list(fuerBen.id);
  check("Rechte im Ordner: bearbeiten", listing.data?.access === "edit", `access = ${listing.data?.access}`);
  const uploaded = await ben.upload(fuerBen.id, "von-ben.xml");
  benUpload = uploaded.data;
  check("Hochladen", uploaded.status === 200, `HTTP ${uploaded.status}`);
  check("Hochgeladenes gehört Anna (der Ordner ist ihrer)", uploaded.data?.ownerId === people[ANNA] || uploaded.data?.owner === ANNA, `owner = ${uploaded.data?.owner}`);
  const sub = await ben.folder(fuerBen.id, "Von Ben angelegt");
  check("Unterordner anlegen", sub.status === 200, `HTTP ${sub.status}`);
  check("Datei umbenennen", (await ben.rename(fuerBenFile.id, "rechnung-fuer-ben-umbenannt.xml")).status === 200);
  const annaSees = names(await anna.list(fuerBen.id));
  check("Anna sieht Bens Datei und Ordner", ["von-ben.xml", "Von Ben angelegt"].every((n) => annaSees.includes(n)), annaSees.join(", "));
  check("Ben sieht: von ihm hochgeladen", uploaded.data?.uploadedByYou === true && uploaded.data?.uploadedBy === BEN, JSON.stringify(uploaded.data));
  const fromBen = byName(await anna.list(fuerBen.id), "von-ben.xml");
  check("Anna sieht: von Ben hochgeladen", fromBen?.uploadedBy === BEN && fromBen?.uploadedByYou === false, JSON.stringify(fromBen));
  check("Den geteilten Ordner selbst umbenennen → 403", ...statusIs(await ben.rename(fuerBen.id, "Meins"), 403));
  check("Den geteilten Ordner selbst löschen → 403", ...statusIs(await ben.remove([fuerBen.id]), 403));
  check("Weiter teilen → 403", ...statusIs(await ben.grant(fuerBen.id, CARLA_ID, false), 403));
  check("Annas Datei in den eigenen Ordner ziehen → 400", ...statusIs(await ben.move([fuerBenFile.id], benPrivat.id), 400));
  check("Eigene Datei in Annas Ordner ziehen → 400", ...statusIs(await ben.move([benFile.id], fuerBen.id), 400));
  check("Innerhalb von Annas Ordner verschieben", (await ben.move([benUpload.id], sub.data.id)).status === 200);
  const folderNames = ((await ben.folders()).data ?? []).map((f) => f.name);
  check("Verschieben-Dialog: eigene und bearbeitbare Ordner", folderNames.includes("Ben privat") && folderNames.includes("Anna für Ben (bearbeiten)"), folderNames.join(", "));
  check("Verschieben-Dialog: keine fremden oder nur lesbaren Ordner", !folderNames.includes("Anna privat") && !folderNames.includes("Anna für alle (ansehen)"));
}

heading("5. Freigaben ändern und beenden");
{
  const granted = await anna.grant(privat.id, CARLA_ID, false);
  check("Anna gibt »Anna privat« nur für Carla frei", granted.status === 200);
  check("Carla sieht es jetzt", names(await carla.root()).includes("Anna privat"));
  check("Ben weiterhin nicht", !names(await ben.root()).includes("Anna privat"));
  await anna.revoke(granted.data.id);
  check("Nach dem Entfernen: Carla → 404", ...statusIs(await carla.list(privat.id), 404));

  const benPermission = (await anna.permissions(fuerBen.id)).data.find((p) => p.userId === BEN_ID);
  await anna.grant(fuerBen.id, BEN_ID, false);
  check("Anna stuft Ben auf »ansehen« herunter: Hochladen → 403", ...statusIs(await ben.upload(fuerBen.id, "zu-spaet.xml"), 403));
  await anna.revoke(benPermission.id);
  check("Anna beendet Bens Freigabe: Ben → 404", ...statusIs(await ben.list(fuerBen.id), 404));
  await must(await anna.grant(fuerBen.id, BEN_ID, true), "Wieder für Ben teilen");
  check("Wieder freigegeben: Ben sieht den Ordner", names(await ben.root()).includes("Anna für Ben (bearbeiten)"));
}

heading("6. Gleiche Namen bei verschiedenen Personen");
{
  // Both stay in place: a server restart after this run must still start (the old global name index).
  const annas = await must(await anna.folder(null, "Jahresordner 2025"), "Ordner anlegen");
  await must(await anna.upload(annas.id, "rechnung-anna-2025.xml"), "Hochladen");
  await must(await anna.grant(annas.id, null, false), "Für alle teilen");
  const bens = await ben.folder(null, "Jahresordner 2025");
  check("Ben darf oben auch einen »Jahresordner 2025« haben", bens.status === 200 && bens.data?.name === "Jahresordner 2025", `${bens.status} ${bens.data?.name}`);
  await ben.upload(bens.data.id, "rechnung-ben-2025.xml");
  check("Ben sieht beide nebeneinander", names(await ben.root()).filter((n) => n === "Jahresordner 2025").length === 2);
  const zip = await ben.download([bens.data.id, annas.id]);
  check(
    "Beide zusammen herunterladen: im Zip heißt der zweite »Jahresordner 2025 (2)«",
    zip.status === 200 && zip.text.includes("Jahresordner 2025/rechnung-ben-2025.xml") && zip.text.includes("Jahresordner 2025 (2)/rechnung-anna-2025.xml"),
    `HTTP ${zip.status}`,
  );
}

heading("7. Admins sehen keine fremden Dateien, auch nicht über Umwege");
{
  check("Als Anna anmelden (Impersonation) → abgelehnt", (await admin.fetch("/api/auth/admin/impersonate-user", { method: "POST", json: { userId: people[ANNA] } })).status === 403);
  check("Annas Adresse ändern → abgelehnt", (await admin.fetch("/api/auth/admin/update-user", { method: "POST", json: { userId: people[ANNA], data: { email: "admin-postfach@demo.test" } } })).status === 403);
  check("Nutzerliste laden geht weiterhin", (await admin.fetch("/api/auth/admin/list-users?limit=5")).status === 200);
}

heading("8. Angriffe auf Pfade und Ordnerbaum");
{
  check("Datei »../../boese.xml« in Annas Ordner laden → abgelehnt", (await ben.upload(fuerBen.id, "../../boese.xml")).status === 400);
  check("Datei »a\\b.xml« → abgelehnt", (await ben.upload(fuerBen.id, "a\\b.xml")).status === 400);
  // Two moves at once must not leave A inside B inside A: that would hang every query that walks the tree.
  const a = await must(await ben.folder(null, "Kreis A"), "Ordner anlegen");
  const b = await must(await ben.folder(null, "Kreis B"), "Ordner anlegen");
  const [ab, ba] = await Promise.all([ben.move([a.id], b.id), ben.move([b.id], a.id)]);
  check("A in B und B in A gleichzeitig: nur eins klappt", [ab.status, ba.status].sort().join() === "200,400", `${ab.status}, ${ba.status}`);
  const top = await ben.root();
  check("Danach lädt die Ablage normal", top.status === 200 && names(top).filter((n) => n.startsWith("Kreis")).length === 1, names(top).join(", "));
  await ben.remove(((await ben.root()).data.items ?? []).filter((n) => n.name.startsWith("Kreis")).map((n) => n.id));
  check(
    "Admin liest Annas Sitzungen (Tokens, IPs) → abgelehnt",
    (await admin.fetch("/api/auth/admin/list-user-sessions", { method: "POST", json: { userId: people[ANNA] } })).status === 403,
  );
}

heading("9. Personen außerhalb laden über einen Link hoch");
{
  // Another link, with an end date and uploads allowed, must not lend its rights to the one tested here.
  const andererLink = await must(await anna.createLink(fuerBen.id, "andere@demo.test", "2099-12-31"), "Anderen Link anlegen");
  await must(await anna.allowUpload(andererLink.id, true), "Hochladen beim anderen Link erlauben");
  const ziel = await must(await anna.folder(null, "Anna Eingang (Link mit Hochladen)"), "Ordner anlegen");
  const vorhanden = await must(await anna.upload(ziel.id, "vorhanden.xml"), "Hochladen");
  const drin = await must(await anna.folder(ziel.id, "Unterordner im Eingang"), "Ordner anlegen");
  const raus = await must(await anna.folder(ziel.id, "Wird verschoben"), "Ordner anlegen");
  const link = await must(await anna.createLink(ziel.id, "lieferant@demo.test"), "Link anlegen");
  const fileLink = await must(await anna.createLink(alleFile.id, "lieferant@demo.test"), "Link auf Datei anlegen");
  const visitor = await new Visitor(link.token).unlock();
  const stranger = new Visitor(link.token);

  check("Neuer Link: Hochladen aus", link.canUpload === false && (await visitor.info()).data?.canUpload === false);
  check("Hochladen ohne Erlaubnis → 403", ...statusIs(await visitor.upload(null, "zu-frueh.xml"), 403));
  check("Die Erlaubnis eines anderen Links gilt nicht → 403", ...statusIs(await visitor.upload(fuerBen.id, "fremder-link.xml"), 403));
  await must(await anna.deleteLink(andererLink.id), "Anderen Link löschen");
  check("Ben kann Annas Link nicht freischalten → 404", ...statusIs(await ben.allowUpload(link.id, true), 404));
  const enabled = await anna.allowUpload(link.id, true);
  check("Anna erlaubt das Hochladen nachträglich", enabled.status === 200 && enabled.data?.canUpload === true, `HTTP ${enabled.status}`);
  check("Die Seite des Links bietet jetzt Hochladen an", (await visitor.info()).data?.canUpload === true);
  check("Link auf eine einzelne Datei: Hochladen erlauben → 400", ...statusIs(await anna.allowUpload(fileLink.id, true), 400));

  const up = await visitor.upload(null, "vom-lieferanten.xml");
  check("Hochladen in den geteilten Ordner", up.status === 200 && up.data?.parentId === null, `HTTP ${up.status} ${JSON.stringify(up.data)}`);
  const annaSees = await anna.list(ziel.id);
  check("Anna sieht die Datei, sie gehört ihr", byName(annaSees, "vom-lieferanten.xml")?.access === "owner", names(annaSees).join(", "));
  check("Anna sieht, wer über den Link hochgeladen hat", byName(annaSees, "vom-lieferanten.xml")?.uploadedBy === "lieferant@demo.test", JSON.stringify(byName(annaSees, "vom-lieferanten.xml")));
  check("Die Person außerhalb sieht keine Adressen", up.data?.uploadedBy === null && byName(await visitor.list(null), "vom-lieferanten.xml")?.uploadedBy === null);
  check("Die Person sieht ihre Datei im Link", names(await visitor.list(null)).includes("vom-lieferanten.xml"));
  check("Hochladen in einen Unterordner des Links", (await visitor.upload(drin.id, "im-unterordner.xml")).status === 200);
  const again = await visitor.upload(null, "vorhanden.xml", "ersetzt?");
  check("Gleicher Name ersetzt nichts, die neue heißt »vorhanden (2).xml«", again.data?.name === "vorhanden (2).xml", `${again.status} ${again.data?.name}`);
  check("Die vorhandene Datei ist unverändert", (await anna.content(vorhanden.id)).text.includes("<rsm:CrossIndustryInvoice"));
  check("Text- und IDoc-Dateien gehen auch", (await visitor.upload(null, "notiz.txt", "Hallo")).status === 200);

  check("In einen fremden Ordner (Anna privat) → 404", ...statusIs(await visitor.upload(privat.id, "fremd.xml"), 404));
  check("In Bens Ordner → 404", ...statusIs(await visitor.upload(benPrivat.id, "fremd.xml"), 404));
  check("Eine Datei als Ziel → 400", ...statusIs(await visitor.upload(vorhanden.id, "fremd.xml"), 400));
  check("Ziel ist keine ID → 400", ...statusIs(await visitor.upload("../../x", "fremd.xml"), 400));
  check("Name »../../boese.xml« → 400", ...statusIs(await visitor.upload(null, "../../boese.xml"), 400));
  check("Binärdatei → 415", ...statusIs(await visitor.upload(null, "programm.exe", new Uint8Array([0x4d, 0x5a, 0, 0, 1, 2, 0, 0])), 415));
  check("Ohne eingegebenen Code → 403", ...statusIs(await stranger.upload(null, "ohne-code.xml"), 403));
  check("Ohne Dateinamen → 400", ...statusIs(await visitor.fetch(`${visitor.base}/upload`, { method: "POST", body: "x" }), 400));
  check("Kaputt kodierter Dateiname → 400", ...statusIs(await visitor.upload(null, "x", "x", { "x-file-name": "%E0%A4%A" }), 400));
  const csrf = await fetch(BASE + `${visitor.base}/upload`, {
    method: "POST",
    headers: { origin: "https://boese.example", "x-file-name": "csrf.xml", cookie: [...visitor.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
    body: invoice("csrf"),
  });
  check("Von einer fremden Seite abgeschickt → 403", ...statusIs({ status: csrf.status }, 403));
  check("Ohne Längenangabe (chunked) → 411", ...statusIs({ status: await visitor.raw({ "transfer-encoding": "chunked" }, "abc") }, 411));
  check("Längenangabe über 50 MB → 413, bevor gelesen wird", ...statusIs({ status: await visitor.raw({ "content-length": String(200 * 1024 * 1024) }, "abc") }, 413));
  check("Löschen über die App-API → 401", ...statusIs(await visitor.remove([vorhanden.id]), 401));

  await must(await anna.move([raus.id], privat.id), "Ordner aus dem Link verschieben");
  check("Ordner aus dem Link verschoben: dorthin → 404", ...statusIs(await visitor.upload(raus.id, "zu-spaet.xml"), 404));
  await must(await anna.allowUpload(link.id, false), "Hochladen beenden");
  check("Anna nimmt die Erlaubnis zurück: Hochladen → 403", ...statusIs(await visitor.upload(null, "zu-spaet.xml"), 403));
  check("Ohne Erlaubnis und 40 MB angekündigt → 403, bevor gelesen wird", ...statusIs({ status: await visitor.raw({ "content-length": String(40 * 1024 * 1024) }, "abc") }, 403));
  check("Ansehen geht weiterhin", (await visitor.list(null)).status === 200);
  await must(await anna.deleteLink(link.id), "Link löschen");
  check("Link gelöscht: Hochladen → 404", ...statusIs(await visitor.upload(null, "zu-spaet.xml"), 404));
  const left = names(await anna.list(ziel.id));
  check("Was hochgeladen war, bleibt bei Anna", ["vom-lieferanten.xml", "vorhanden (2).xml", "notiz.txt"].every((n) => left.includes(n)), left.join(", "));
  check("Link gelöscht: die Adresse dessen, der hochgeladen hat, bleibt", byName(await anna.list(ziel.id), "vom-lieferanten.xml")?.uploadedBy === "lieferant@demo.test");

  // 200 Dateien am Tag pro Link, auch wenn viele gleichzeitig ankommen.
  const flut = await must(await anna.folder(null, "Anna Tageslimit"), "Ordner anlegen");
  const flutLink = await must(await anna.createLink(flut.id, "flut@demo.test"), "Link anlegen");
  await must(await anna.allowUpload(flutLink.id, true), "Hochladen erlauben");
  const flooder = await new Visitor(flutLink.token).unlock();
  // Three uploads that announce 1 kB and send 3 bytes hold their slots until released. Probes repeat
  // for up to 5 s, because the server takes the slots and frees them a moment after the client acts.
  let landed = 0;
  const probe = async (until) => {
    for (let i = 0; i < 50; i++) {
      const { status } = await flooder.upload(null, `probe-${i}.txt`, "x");
      if (status === 200) landed++;
      if (status === until) return status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return "Zeit abgelaufen";
  };
  const held = Array.from({ length: 3 }, () => flooder.raw({ "content-length": "1024" }, "abc"));
  check("3 Uploads laufen: der vierte → 429", ...statusIs({ status: await probe(429) }, 429));
  for (const request of held) request.release();
  await Promise.all(held);
  check("Abgebrochene Uploads geben ihren Platz frei", ...statusIs({ status: await probe(200) }, 200));
  const statuses = [];
  for (let batch = 0; batch < 80; batch++) {
    const results = await Promise.all(Array.from({ length: 3 }, (_, i) => flooder.upload(null, `flut-${batch}-${i}.txt`, "x")));
    statuses.push(...results.map((r) => r.status));
  }
  const accepted = landed + statuses.filter((status) => status === 200).length;
  check("240 weitere Dateien, je 3 gleichzeitig: insgesamt genau 200 kommen an, der Rest → 429", accepted === 200 && statuses.every((s) => s === 200 || s === 429), `${accepted} angekommen`);
  await anna.remove([flut.id]);
}

heading("10. Nutzer entfernen: der Admin übernimmt die Dateien");
{
  const doraFolder = await must(await dora.folder(null, "Dora Projekt"), "Ordner anlegen");
  await must(await dora.upload(doraFolder.id, "rechnung-dora.xml"), "Hochladen");
  await must(await dora.grant(doraFolder.id, CARLA_ID, false), "Für Carla teilen");
  const removed = await admin.fetch("/api/auth/admin/remove-user", { method: "POST", json: { userId: people[DORA] } });
  check("Admin entfernt dora@demo.test", removed.status === 200, `HTTP ${removed.status} ${JSON.stringify(removed.data)}`);
  const handed = byName(await admin.root(), `Von ${DORA}`);
  check(`Admin hat den Ordner »Von ${DORA}«`, !!handed);
  check("Darin liegt »Dora Projekt«", !!handed && names(await admin.list(handed.id)).includes("Dora Projekt"));
  check("Doras Freigabe für Carla bleibt bestehen", names(await carla.root()).includes("Dora Projekt"));
  check("Doras Sitzung ist ungültig", (await dora.root()).status === 401);
}

heading("11. MCP-Server: Claude sieht genau, was die Person sieht, und ändert nichts");
{
  const MCP = `${BASE}/api/mcp`;
  const REDIRECT = "http://127.0.0.1:33418/callback";
  const base64url = (bytes) => Buffer.from(bytes).toString("base64url");
  // A browser gets a redirect. Node's fetch always says sec-fetch-mode: cors, so Better Auth answers it like its client: { redirect, url }.
  const location = (response) => response.headers?.location ?? response.data?.url ?? "";

  /** One MCP call, as Claude Code sends it. */
  async function mcp(token, method, params = {}) {
    const response = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: response.status, data, headers: Object.fromEntries(response.headers) };
  }
  async function callTool(token, name, args = {}) {
    const { data } = await mcp(token, "tools/call", { name, arguments: args });
    const result = data?.result;
    const text = result?.content?.[0]?.text ?? "";
    let value = null;
    try {
      value = JSON.parse(text);
    } catch {}
    return { error: result?.isError ? text : null, value };
  }

  /** Session.fetch, but keeping the Location header of redirects. A browser's navigation sends no Origin. */
  async function raw(session, path, options = {}) {
    const headers = { ...(options.method && { origin: BASE }), cookie: [...session.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...options.headers };
    const response = await fetch(path.startsWith("http") ? path : BASE + path, { ...options, headers, redirect: "manual" });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      session.cookies.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: response.status, data, headers: Object.fromEntries(response.headers) };
  }

  /**
   * The whole flow Claude Code runs: discovery, registration, sign-in on /login with the mailed code,
   * consent on /zugriff, code for token. Returns the access token or throws with the step that failed.
   */
  async function connect(email, { resource = MCP } = {}) {
    const challenge = await mcp(null, "initialize");
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge.headers["www-authenticate"] ?? "")?.[1];
    if (challenge.status !== 401 || !metadataUrl) throw new Error(`MCP ohne Token: HTTP ${challenge.status}, kein resource_metadata`);
    const resourceMetadata = await (await fetch(metadataUrl)).json();
    const issuer = new URL(resourceMetadata.authorization_servers[0]);
    const server = await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`)).json();

    const registered = await fetch(server.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude Code (test)", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    });
    const client = await registered.json();
    if (!client.client_id) throw new Error(`Registrierung: HTTP ${registered.status} ${JSON.stringify(client)}`);

    const verifier = base64url(randomBytes(32));
    const authorize = new URL(server.authorization_endpoint);
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: REDIRECT,
      scope: "files:read offline_access",
      state: "s1",
      code_challenge: base64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      ...(resource && { resource }),
    }))
      authorize.searchParams.set(key, value);

    const browser = new Session(email);
    const toLogin = await raw(browser, authorize.toString());
    const login = new URL(location(toLogin), BASE);
    if (login.pathname !== "/login") throw new Error(`Authorize ohne Sitzung: HTTP ${toLogin.status} → ${location(toLogin)}`);
    const oauthQuery = login.search.slice(1);
    await must(await raw(browser, "/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, type: "sign-in" }) }), "Code anfordern");
    const signedIn = await raw(browser, "/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp: "000000", oauth_query: oauthQuery }) });
    const consentUrl = new URL(signedIn.data?.url ?? "", BASE);
    if (consentUrl.pathname !== "/zugriff") throw new Error(`Nach der Anmeldung: HTTP ${signedIn.status} ${JSON.stringify(signedIn.data)}`);
    const consented = await raw(browser, "/api/auth/oauth2/consent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }) });
    const back = new URL(consented.data?.url ?? "", BASE);
    const code = back.searchParams.get("code");
    if (!back.href.startsWith(REDIRECT) || !code) throw new Error(`Zustimmung: HTTP ${consented.status} ${JSON.stringify(consented.data)}`);

    const tokens = await (
      await fetch(server.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, ...(resource && { resource }) }),
      })
    ).json();
    if (!tokens.access_token) throw new Error(`Token: ${JSON.stringify(tokens)}`);
    const { aud } = JSON.parse(Buffer.from(tokens.access_token.split(".")[1] ?? "", "base64url").toString() || "{}");
    if (resource && JSON.stringify([aud].flat()) !== JSON.stringify([MCP])) throw new Error(`Token gilt nicht nur für den MCP-Server: aud ${JSON.stringify(aud)}`);
    return tokens.access_token;
  }

  /** Every file a person reaches by clicking through the app, as "folder path / name". */
  async function reachable(session) {
    const files = new Map();
    const walk = async (listing, prefix) => {
      for (const item of listing.data?.items ?? []) {
        if (item.kind === "file") files.set(item.id, `${prefix}${item.name}`);
        else await walk(await session.list(item.id), `${prefix}${item.name} / `);
      }
    };
    await walk(await session.root(), "");
    return files;
  }

  const tokens = {};
  for (const session of [anna, ben, carla]) {
    try {
      tokens[session.email] = await connect(session.email);
      check(`${session.email} verbindet sich wie Claude Code (Registrierung, Anmeldung mit Code, Zustimmung, Token)`, true);
    } catch (error) {
      check(`${session.email} verbindet sich wie Claude Code`, false, error.message);
    }
  }

  const tools = await mcp(tokens[ANNA], "tools/list");
  const toolNames = (tools.data?.result?.tools ?? []).map((tool) => tool.name).sort();
  check("Es gibt nur lesende Werkzeuge und das Prüfen ohne Speichern", toolNames.join(",") === "find_files,get_file,list_folder,read_file,validate_file", toolNames.join(", ") || JSON.stringify(tools.data));
  check("Alle als nur lesend markiert", (tools.data?.result?.tools ?? []).every((tool) => tool.annotations?.readOnlyHint === true));

  for (const session of [anna, ben, carla]) {
    const token = tokens[session.email];
    const top = await callTool(token, "list_folder");
    const app = names(await session.root()).sort();
    const viaMcp = (top.value?.items ?? []).map((item) => item.name).sort();
    check(`${session.email}: oberste Ebene im MCP = in der App`, JSON.stringify(viaMcp) === JSON.stringify(app), `MCP ${viaMcp.join(", ")} | App ${app.join(", ")}`);
    const expected = await reachable(session);
    const found = await callTool(token, "find_files", { limit: 100 });
    const foundIds = new Set((found.value ?? []).map((file) => file.id));
    const missing = [...expected].filter(([id]) => !foundIds.has(id)).map(([, path]) => path);
    const extra = (found.value ?? []).filter((file) => !expected.has(file.id)).map((file) => `${file.folder} / ${file.name}`);
    check(`${session.email}: find_files findet genau die ${expected.size} Dateien, die in der App erreichbar sind`, expected.size < 100 && !missing.length && !extra.length, `fehlt: ${missing.join(", ") || "-"} | zu viel: ${extra.join(", ") || "-"}`);
  }

  {
    const own = await callTool(tokens[ANNA], "get_file", { fileId: alleFile.id });
    check("Anna: get_file liefert den Prüfbericht", own.value?.file?.name === "rechnung-alle.xml" && Array.isArray(own.value?.validation?.findings), own.error ?? JSON.stringify(own.value).slice(0, 200));
    const content = await callTool(tokens[ANNA], "read_file", { fileId: alleFile.id });
    check("Anna: read_file liefert den Inhalt", content.value?.text?.includes("<ram:ID>rechnung-alle.xml</ram:ID>"), content.error ?? JSON.stringify(content.value).slice(0, 200));
    const part = await callTool(tokens[ANNA], "read_file", { fileId: alleFile.id, offset: 10, maxChars: 20 });
    check("read_file liest in Teilen weiter", part.value?.text?.length === 20 && part.value?.nextOffset === 30, JSON.stringify(part.value));
  }
  {
    // What Anna reaches before, to show validate_file adds nothing to her files.
    const before = JSON.stringify([...(await reachable(anna)).keys()].sort());
    const xml = invoice("mcp-pruefung.xml");
    const asText = await callTool(tokens[ANNA], "validate_file", { name: "mcp-pruefung.xml", content: xml });
    check(
      "validate_file prüft XML aus content und liefert den Bericht, ohne zu speichern",
      asText.value?.stored === false && typeof asText.value?.validation?.valid === "boolean" && asText.value.validation.findings.length > 0 && !!asText.value.status,
      asText.error ?? JSON.stringify(asText.value).slice(0, 200),
    );
    const asBase64 = await callTool(tokens[ANNA], "validate_file", { name: "mcp-pruefung.xml", contentBase64: Buffer.from(xml).toString("base64") });
    check("validate_file prüft dieselbe Datei als Base64 mit demselben Ergebnis", JSON.stringify(asBase64.value?.validation) === JSON.stringify(asText.value?.validation), asBase64.error ?? "anderer Bericht");
    const utf16 = await callTool(tokens[ANNA], "validate_file", { name: "mcp-pruefung.xml", content: xml.replace('encoding="UTF-8"', 'encoding="UTF-16"') });
    check("Text mit encoding=\"UTF-16\" in der Deklaration gibt denselben Bericht", JSON.stringify(utf16.value?.validation) === JSON.stringify(asText.value?.validation), utf16.error ?? utf16.value?.validation?.findings?.[0]?.message);
    const after = JSON.stringify([...(await reachable(anna)).keys()].sort());
    check("Danach hat Anna keine Datei mehr oder weniger, in keinem Ordner", before === after);
    const found = await callTool(tokens[ANNA], "find_files", { name: "mcp-pruefung" });
    check("find_files findet die geprüfte Datei nicht", Array.isArray(found.value) && found.value.length === 0, JSON.stringify(found.value));
    for (const [label, args, expected] of [
      ["ohne Inhalt", { name: "x.xml" }, "Entweder content oder contentBase64 angeben"],
      ["mit content und contentBase64", { content: xml, contentBase64: "PA==" }, "Entweder content oder contentBase64 angeben"],
      ["mit kaputtem Base64", { contentBase64: "kein base64!" }, "contentBase64 ist kein gültiges Base64"],
      ["mit einer CSV statt einer Rechnung", { name: "liste.csv", content: "a;b\n1;2\n" }, "Nur Rechnungen lassen sich prüfen"],
    ]) {
      const refused = await callTool(tokens[ANNA], "validate_file", args);
      check(`validate_file ${label} → ${expected}`, refused.error === expected, refused.error ?? JSON.stringify(refused.value).slice(0, 200));
    }
    const noToken = await mcp(null, "tools/call", { name: "validate_file", arguments: { content: xml } });
    check("validate_file ohne Token → 401", noToken.status === 401, `HTTP ${noToken.status}`);
  }
  for (const [label, token, fileId] of [
    ["Anna liest Bens private Datei nicht", tokens[ANNA], benFile.id],
    ["Carla liest »Anna für Ben« nicht", tokens[CARLA], fuerBenFile.id],
  ]) {
    const file = await callTool(token, "get_file", { fileId });
    const content = await callTool(token, "read_file", { fileId });
    check(`${label}: get_file und read_file → Nicht gefunden`, file.error === "Nicht gefunden" && content.error === "Nicht gefunden", `${file.error} / ${content.error}`);
  }
  {
    const listing = await callTool(tokens[CARLA], "list_folder", { folderId: fuerBen.id });
    const search = await callTool(tokens[CARLA], "find_files", { folderId: fuerBen.id });
    check("Carla listet und durchsucht »Anna für Ben« nicht", listing.error === "Nicht gefunden" && search.error === "Nicht gefunden", `${listing.error} / ${search.error}`);
    const below = await callTool(tokens[CARLA], "find_files", { folderId: alle.id });
    const belowNames = (below.value ?? []).map((file) => file.name).sort();
    check("Carla findet unter »Anna für alle« beide Dateien, auch im Unterordner", belowNames.join(",") === "rechnung-alle.xml,rechnung-unterordner.xml", belowNames.join(", "));
    const inSub = (below.value ?? []).find((file) => file.id === unterFile.id);
    check("Der Pfad beginnt bei dem, was mit Carla geteilt ist", inSub?.folder === "Anna für alle (ansehen) / Unterordner", inSub?.folder);
  }

  {
    const noToken = await mcp(null, "tools/list");
    check("Ohne Token → 401 mit Verweis auf die Anmeldung", noToken.status === 401 && /resource_metadata=/.test(noToken.headers["www-authenticate"] ?? ""), `HTTP ${noToken.status}`);
    const forged = await mcp(`${tokens[ANNA]?.slice(0, -4)}AAAA`, "tools/list");
    check("Verfälschtes Token → 401", forged.status === 401, `HTTP ${forged.status}`);
    const cookie = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", cookie: [...anna.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check("Die Sitzung der App allein reicht nicht → 401", cookie.status === 401, `HTTP ${cookie.status}`);
    let opaque = null;
    try {
      opaque = await connect(ANNA, { resource: null });
    } catch (error) {
      check("Token ohne resource holen", false, error.message);
    }
    if (opaque) check("Token, das nicht für den MCP-Server ausgestellt ist → 401", (await mcp(opaque, "tools/list")).status === 401);
    const banned = await admin.fetch("/api/auth/admin/ban-user", { method: "POST", json: { userId: CARLA_ID } });
    check("Admin sperrt Carla", banned.status === 200, `HTTP ${banned.status}`);
    check("Gesperrt: Carlas Token gilt nicht mehr → 401", (await mcp(tokens[CARLA], "tools/list")).status === 401);
    await must(await admin.fetch("/api/auth/admin/unban-user", { method: "POST", json: { userId: CARLA_ID } }), "Entsperren");
    check("Entsperrt: Carlas Token gilt wieder", (await mcp(tokens[CARLA], "tools/list")).status === 200);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n\x1b[1m${results.length - failed.length} von ${results.length} Prüfungen bestanden\x1b[0m`);
if (failed.length) {
  for (const f of failed) console.log(`  \x1b[31m✗\x1b[0m ${f.section}: ${f.label}`);
}

console.log(`
\x1b[1mSelbst durchklicken\x1b[0m (${BASE}, Anmeldecode jeweils 000000, am besten je Person ein privates Fenster):
  ${ANNA}   fünf Ordner, darunter »Anna Eingang«, in den eine Person außerhalb über einen Link hochgeladen hat. Rechtsklick auf »Anna für alle (ansehen)« → Teilen zeigt »Alle Nutzer: Ansehen«.
  ${BEN}    »Ben privat«, zweimal »Jahresordner 2025« (seiner, Annas) und Annas geteilte Ordner mit ihrer Adresse daneben. In »Anna für Ben« darf er
                  hochladen, in »Anna für alle« steht »Nur ansehen« und es gibt keinen Hochladen-Knopf.
  ${CARLA}  »Anna für alle (ansehen)«, Annas »Jahresordner 2025« und »Dora Projekt« (geteilt von der entfernten Dora, jetzt dem Admin).
  ${ADMIN}  Eigenes plus »Von ${DORA}«. Annas und Bens private Ordner sieht er nicht.
Was vor dem Update schon in der Datenbank lag, gehört dem, der es angelegt hat, und bleibt für alle zum
Bearbeiten freigegeben. Das sehen deshalb alle zusätzlich.
`);
process.exit(failed.length ? 1 : 0);
