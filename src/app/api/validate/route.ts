import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { type Finding, type Report } from "@/lib/report";
import { prefixFor, termsForFinding } from "@/lib/terms";

const VALIDATOR_URL = process.env.VALIDATOR_URL ?? "http://localhost:8080";
const SEVERITIES = ["error", "warning", "notice"] as const;

const status = z.object({ "@status": z.enum(["valid", "invalid"]) });
const mustangReport = z.object({
  validation: z.looseObject({
    pdf: z.looseObject({ summary: status }).optional(),
    xml: z
      .looseObject({
        summary: status.optional(),
        info: z.looseObject({ profile: z.string().optional(), validator: z.looseObject({ "@version": z.string() }).optional() }).optional(),
      })
      .optional(),
    summary: status,
  }),
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => (SEVERITIES as readonly string[]).includes(name),
  processEntities: { enabled: true, maxTotalExpansions: Infinity, maxExpandedLength: Infinity },
});

/** Mustang appends the rule id and its stylesheet to each message: "… [ID BR-02] from /xslt/….xslt)". */
function splitMessage(raw: string) {
  let message = raw.replace(/\s+/g, " ").trim();
  let rule: string | null = null;
  // XSD errors arrive as a raw Java exception with fully qualified element names.
  const schema = message.match(/^schema validation fails:\s*[\w.]+;(?: lineNumber: \d+;)?(?: columnNumber: \d+;)?\s*(?:cvc-[\w.-]+:\s*)?/);
  if (schema) {
    rule = "XML-Schema";
    message = message.slice(schema[0].length).replace(/\{?"([^"]+)":(\w+)\}?/g, (_, ns, local) => `${prefixFor(ns) || ns}:${local}`);
  }
  const suffix = message.match(/\s*\[ID ([^\]]+)\]\s*from \S+\)?$/);
  if (suffix) {
    rule = suffix[1].trim();
    message = message.slice(0, suffix.index).trim();
  }
  const prefix = message.match(/^\[([A-Z][\w-]*)\]\s*-?\s*/);
  if (prefix) {
    rule ??= prefix[1];
    message = message.slice(prefix[0].length);
  }
  return { message, rule };
}

function collect(node: unknown, part: Finding["part"], out: Finding[]) {
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const severity = SEVERITIES.find((s) => s === key);
    if (severity && Array.isArray(value)) {
      for (const item of value) {
        const text = typeof item === "string" ? item : String(item?.["#text"] ?? "");
        const location = typeof item === "object" ? (item["@location"] ?? null) : null;
        const criterion = typeof item === "object" ? (item["@criterion"] ?? null) : null;
        const { message, rule } = splitMessage(text);
        if (!message) continue;
        out.push({ severity, part, rule, message, location: location || null, terms: termsForFinding(message, location, criterion) });
      }
    } else if (Array.isArray(value)) value.forEach((v) => collect(v, part, out));
    else collect(value, part, out);
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Keine Datei" }, { status: 400 });

  let xml: string;
  try {
    const response = await fetch(`${VALIDATOR_URL}/validate`, {
      method: "POST",
      body: await file.arrayBuffer(),
      headers: { "X-Filename": encodeURIComponent(file.name) },
    });
    if (!response.ok) throw new Error(await response.text());
    xml = await response.text();
  } catch (error) {
    console.error("Validator request failed", error);
    return Response.json({ error: "Validator nicht erreichbar" }, { status: 502 });
  }

  const parsed = mustangReport.safeParse(parser.parse(xml));
  if (!parsed.success) {
    console.error("Unexpected validator report", parsed.error, xml.slice(0, 2000));
    return Response.json({ error: "Unerwartete Antwort des Validators" }, { status: 502 });
  }

  const { validation } = parsed.data;
  const findings: Finding[] = [];
  collect(validation.pdf, "pdf", findings);
  collect(validation.xml, "xml", findings);
  collect(validation.messages, "file", findings);

  const report: Report = {
    valid: validation.summary["@status"] === "valid",
    pdf: validation.pdf?.summary["@status"] ?? null,
    xml: validation.xml?.summary?.["@status"] ?? null,
    profile: validation.xml?.info?.profile?.trim() || null,
    validator: `Mustang ${validation.xml?.info?.validator?.["@version"] ?? ""}`.trim(),
    findings,
  };
  return Response.json(report);
}
