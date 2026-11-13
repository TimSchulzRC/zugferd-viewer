import { z } from "zod";

export const findingSchema = z.object({
  severity: z.enum(["error", "warning", "notice"]),
  part: z.enum(["pdf", "xml", "file"]),
  rule: z.string().nullable(),
  message: z.string(),
  location: z.string().nullable(),
  terms: z.array(z.string()),
});

export const reportSchema = z.object({
  valid: z.boolean(),
  pdf: z.enum(["valid", "invalid"]).nullable(),
  xml: z.enum(["valid", "invalid"]).nullable(),
  profile: z.string().nullable(),
  validator: z.string(),
  findings: z.array(findingSchema),
});

export type Finding = z.infer<typeof findingSchema>;
export type Report = z.infer<typeof reportSchema>;

export type Profile = {
  name: string;
  /** Whether the profile carries a full EN 16931 invoice, which is what § 14 UStG asks of an e-invoice. */
  en16931: boolean;
};

export function describeProfile(id: string | null): Profile | null {
  if (!id) return null;
  const xrechnung = id.match(/xrechnung_(\d+(?:\.\d+)*)/i);
  if (xrechnung) return { name: `XRechnung ${xrechnung[1]}`, en16931: true };
  if (/xrechnung/i.test(id)) return { name: "XRechnung", en16931: true };
  if (/:minimum$/i.test(id)) return { name: "MINIMUM", en16931: false };
  if (/:basicwl$/i.test(id)) return { name: "BASIC WL", en16931: false };
  if (id.startsWith("urn:ferd:CrossIndustryDocument")) return { name: `ZUGFeRD 1 ${id.split(":").pop()?.toUpperCase()}`, en16931: false };
  if (id.startsWith("urn:zugferd.de:2p0")) return { name: `ZUGFeRD 2.0 ${id.split(":").pop()?.toUpperCase()}`, en16931: false };
  if (/#compliant#urn:(factur-x\.eu|zugferd\.de):\w+:basic$/i.test(id)) return { name: "BASIC", en16931: true };
  if (/#conformant#urn:(factur-x\.eu|zugferd\.de):\w+:extended$/i.test(id)) return { name: "EXTENDED", en16931: true };
  if (id === "urn:cen.eu:en16931:2017") return { name: "EN 16931", en16931: true };
  if (id.startsWith("urn:cen.eu:en16931:2017")) return { name: id.split("#").pop() ?? id, en16931: true };
  return { name: id, en16931: false };
}

export const RULESETS = ["zugferd", "xrechnung"] as const;
export type Ruleset = (typeof RULESETS)[number];

/** Rule ids of the XRechnung schematron: the German CIUS plus the Peppol rules it adopted. */
const XRECHNUNG_RULE = /^(BR-DEX?|BR-TMP|PEPPOL-EN16931)-/;

function isXRechnungNotice(finding: Finding) {
  return finding.severity === "notice" && !!finding.rule && XRECHNUNG_RULE.test(finding.rule);
}

/**
 * Mustang also runs the XRechnung rules over BASIC and EN 16931 files and reports what fails as a notice.
 * Only for those profiles can the same report answer "would this pass as an XRechnung?".
 */
export function offersXRechnung(report: Report | null) {
  const name = describeProfile(report?.profile ?? null)?.name;
  return name === "BASIC" || name === "EN 16931";
}

/** The report as it reads for one ruleset: ZUGFeRD drops the XRechnung notices, XRechnung counts them as errors. */
export function reportFor(report: Report, ruleset: Ruleset): Report {
  if (!report.findings.some(isXRechnungNotice)) return report;
  if (ruleset === "zugferd") return { ...report, findings: report.findings.filter((f) => !isXRechnungNotice(f)) };
  return {
    ...report,
    valid: false,
    xml: "invalid",
    findings: report.findings.map((f) => (isXRechnungNotice(f) ? { ...f, severity: "error" } : f)),
  };
}
