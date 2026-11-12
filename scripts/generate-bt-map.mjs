// Builds src/lib/bt-map.json from the KoSIT XRechnung visualization (Apache-2.0):
//   https://github.com/itplr-kosit/xrechnung-visualization/releases
// Usage: node scripts/generate-bt-map.mjs <path to the unzipped release>
//
// cii-xr.xsl maps every CII element to its EN 16931 business term (BT) or group (BG),
// l10n/de.xml holds the German names. We read both instead of typing 200 terms by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("pass the path to the unzipped xrechnung-visualization release");
const xsl = readFileSync(join(dir, "xsl/cii-xr.xsl"), "utf8");
const l10n = readFileSync(join(dir, "xsl/l10n/de.xml"), "utf8");

const labels = {};
const labelsByKey = {};
for (const m of l10n.matchAll(/<entry key="([^"]+)"(?: id="([^"]+)")?>([^<]*)<\/entry>/g)) {
  const [, key, id, text] = m;
  labelsByKey[key] = text.trim();
  if (id && key.startsWith("xr:") && !key.includes("@")) labels[id] ??= text.trim();
}

/** Splits "/a/b[x/y]/c" at slashes outside of predicates. */
function splitSteps(path) {
  const steps = [];
  let depth = 0;
  let current = "";
  for (const ch of path) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "/" && depth === 0) {
      if (current) steps.push(current);
      current = "";
    } else current += ch;
  }
  if (current) steps.push(current);
  return steps;
}

/** Turns the XPath predicates KoSIT uses into conditions the app can check on a DOM element. */
function parsePredicate(pred, stepsUp) {
  const p = pred.replace(/\s+/g, " ").trim();
  let m;
  if (/^@format ?= ?'102'$/.test(p)) return [];
  if (/^exists\(@schemeID\)$/.test(p)) return [{ up: stepsUp, attr: "schemeID", exists: true }];
  if (/^empty\(following-sibling::ram:GlobalID\/@schemeID\)$/.test(p)) return [];
  if ((m = p.match(/^@(\w+) ?= ?\(?((?:'[^']*',? ?)+)\)?$/)))
    return [{ up: stepsUp, attr: m[1], in: [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]) }];
  if ((m = p.match(/^following-sibling::([\w:]+) ?= ?'([^']*)'$/)))
    return [{ up: stepsUp + 1, child: m[1], in: [m[2]] }];
  if ((m = p.match(/^([\w:/]+) ?= ?'([^']*)'$/))) return [{ up: stepsUp, child: m[1], in: [m[2]] }];
  if ((m = p.match(/^@currencyID = parent::[\w:]+\/preceding-sibling::(ram:\w+)$/)))
    return [{ up: stepsUp, attr: "currencyID", equalsHeader: m[1] }];
  return null;
}

const terms = {};
const unparsed = [];
const templates = [...xsl.matchAll(/<xsl:template\s+mode="(B[TG]-[\w-]+)"\s+match="([^"]+)"\s*>([\s\S]*?)<\/xsl:template>/g)];
for (const [, id, rawMatch, body] of templates) {
  const steps = splitSteps(rawMatch.replace(/\s+/g, " ").trim());
  const when = [];
  const names = steps.map((step, i) => {
    const name = step.replace(/\[.*$/s, "").trim();
    for (const pm of step.matchAll(/\[((?:[^\[\]]|\[[^\]]*\])*)\]/g)) {
      const conds = parsePredicate(pm[1], steps.length - 1 - i);
      if (conds) when.push(...conds);
      else unparsed.push(`${id}: ${pm[1].replace(/\s+/g, " ").slice(0, 160)}`);
    }
    return name;
  });
  const xr = body.match(/<xr:(\w+)/)?.[1];
  const children = [...new Set([...body.matchAll(/mode="(B[TG]-[\w-]+)"/g)].map((m) => m[1]))];
  (terms[id] ??= { id, label: labels[id] ?? labelsByKey[`xr:${xr}`] ?? xr?.replaceAll("_", " ") ?? id, paths: [], children });
  terms[id].paths.push({ path: "/" + names.join("/"), ...(when.length ? { when } : {}) });
}

// Terms KoSIT builds inline (no template of their own). The xr:src attribute names their CII path.
for (const m of xsl.matchAll(/<xr:(\w+)>?\s*<xsl:attribute name="xr:id" select="'(BT-\d+)'"\/>\s*<xsl:attribute name="xr:src" select="'([^']+)'"\/>/g)) {
  const [, xr, id, path] = m;
  terms[id] ??= { id, label: labels[id] ?? xr.replaceAll("_", " "), paths: [{ path }], children: [] };
}

const root = xsl.match(/<xsl:template match="\/rsm:CrossIndustryInvoice">([\s\S]*?)<\/xsl:template>/)[1];
const topLevel = [...new Set([...root.matchAll(/mode="(B[TG]-[\w-]+)"|select="'(BT-\d+)'"/g)].map((m) => m[1] ?? m[2]))];
for (const term of Object.values(terms)) for (const child of term.children) if (terms[child]) terms[child].parent ??= term.id;

writeFileSync(
  new URL("../src/lib/bt-map.json", import.meta.url),
  JSON.stringify({ source: "xrechnung-visualization (KoSIT), cii-xr.xsl + l10n/de.xml", topLevel, terms }, null, 1) + "\n",
);
console.log(`${Object.keys(terms).length} terms written`);
if (unparsed.length) console.log("Predicates not understood (review by hand):\n" + unparsed.join("\n"));
