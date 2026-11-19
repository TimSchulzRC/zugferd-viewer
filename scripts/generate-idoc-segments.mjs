// Builds src/lib/idoc-segments.json from a SEEBURGER BIC message description of an SAP IDoc
// (msg_<IDOCTYPE>_….xml, as the IDoc parser import of the Mapping Designer writes it).
// Usage: node scripts/generate-idoc-segments.mjs <msg_INVOIC02….xml> [more descriptions]
//
// A flat-file IDoc has no separators: every field sits at a fixed offset of its segment. The
// description lists each segment's fields with their lengths, which is all the app needs to cut a
// line into fields. Customer segments (Z…) stay out, they differ per system.
import { readFileSync, writeFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const files = process.argv.slice(2);
if (!files.length) throw new Error("pass the path to a BIC message description of an IDoc");

// Every data record starts with these; idoc.ts cuts them off itself.
const ADMIN = new Set(["SEGNAM", "MANDT", "DOCNUM", "SEGNUM", "PSGNUM", "HLEVEL"]);
const parser = new XMLParser({ isArray: (name) => name === "record" || name === "field", parseTagValue: false });

const segments = {};
function visit(records) {
  for (const record of records ?? []) {
    const name = String(record.name);
    const control = name === "EDI_DC40";
    if (!name.startsWith("Z")) {
      const fields = (record.field ?? [])
        .filter((field) => field.name !== "CRLF" && (control || !ADMIN.has(field.name)))
        .map((field) => [String(field.name), Number(field.maxLength)]);
      // Later releases only append fields, so the longest list also reads older files.
      if (!segments[name] || segments[name].length < fields.length) segments[name] = fields;
    }
    visit(record.record);
  }
}
for (const file of files) visit(parser.parse(readFileSync(file, "utf8")).message.record);

const lines = Object.entries(segments).map(([name, fields]) => `  ${JSON.stringify(name)}: ${JSON.stringify(fields)}`);
writeFileSync(new URL("../src/lib/idoc-segments.json", import.meta.url), `{\n${lines.join(",\n")}\n}\n`);
console.log(`${Object.keys(segments).length} segments, ${Object.values(segments).flat().length} fields`);
