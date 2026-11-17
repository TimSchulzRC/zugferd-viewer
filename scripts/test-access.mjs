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
import { existsSync } from "node:fs";

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

  async fetch(path, { method = "GET", json, form } = {}) {
    const headers = { origin: BASE, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    let body;
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
    return { status: response.status, data };
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
  folders() {
    return this.fetch("/api/folders");
  }
  colleagues() {
    return this.fetch("/api/users");
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
  const same = await ben.folder(null, "Anna privat");
  check("Ben darf oben auch einen Ordner »Anna privat« haben", same.status === 200 && same.data?.name === "Anna privat", `${same.status} ${same.data?.name}`);
  if (same.status === 200) await ben.remove([same.data.id]);
}

heading("7. Nutzer entfernen: der Admin übernimmt die Dateien");
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

const failed = results.filter((r) => !r.ok);
console.log(`\n\x1b[1m${results.length - failed.length} von ${results.length} Prüfungen bestanden\x1b[0m`);
if (failed.length) {
  for (const f of failed) console.log(`  \x1b[31m✗\x1b[0m ${f.section}: ${f.label}`);
}

console.log(`
\x1b[1mSelbst durchklicken\x1b[0m (${BASE}, Anmeldecode jeweils 000000, am besten je Person ein privates Fenster):
  ${ANNA}   drei Ordner. Rechtsklick auf »Anna für alle (ansehen)« → Teilen zeigt »Alle Nutzer: Ansehen«.
  ${BEN}    »Ben privat« und Annas zwei geteilte Ordner mit ihrer Adresse daneben. In »Anna für Ben« darf er
                  hochladen, in »Anna für alle« steht »Nur ansehen« und es gibt keinen Hochladen-Knopf.
  ${CARLA}  »Anna für alle (ansehen)« und »Dora Projekt« (geteilt von der entfernten Dora, jetzt dem Admin).
  ${ADMIN}  Eigenes plus »Von ${DORA}«. Annas und Bens private Ordner sieht er nicht.
Was vor dem Update schon in der Datenbank lag, gehört dem, der es angelegt hat, und bleibt für alle zum
Bearbeiten freigegeben. Das sehen deshalb alle zusätzlich.
`);
process.exit(failed.length ? 1 : 0);
