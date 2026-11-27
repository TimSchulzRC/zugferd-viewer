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
  /** The Peppol BIS Billing rules, which Slovakia requires. Only UBL files have them, and only reports from after their introduction. */
  peppol: z.object({ valid: z.boolean(), rules: z.string(), findings: z.array(findingSchema) }).nullish(),
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
  if (/#compliant#urn:fdc:peppol\.eu:2017:poacc:billing:3\.0$/.test(id)) return { name: "Peppol BIS Billing 3.0", en16931: true };
  if (/#compliant#urn:fdc:peppol\.eu:2017:poacc:selfbilling:3\.0$/.test(id)) return { name: "Peppol BIS Self-Billing 3.0", en16931: true };
  if (id === "urn:cen.eu:en16931:2017") return { name: "EN 16931", en16931: true };
  if (id.startsWith("urn:cen.eu:en16931:2017")) return { name: id.split("#").pop() ?? id, en16931: true };
  return { name: id, en16931: false };
}

export type Format = "ZUGFeRD" | "XRechnung" | "Peppol";

/**
 * Which standard a file follows, read from its profile. The XRechnung guideline id wins, also in a PDF
 * that carries it. Peppol BIS Billing is what Slovakia requires. Other profiles and files without one return null.
 */
export function formatOf(profile: string | null): Format | null {
  if (!profile) return null;
  if (/:kosit:(standard:)?xrechnung_\d/i.test(profile)) return "XRechnung";
  if (/#compliant#urn:fdc:peppol\.eu:2017:poacc:(self)?billing:3\.0$/.test(profile)) return "Peppol";
  if (/urn:(factur-x\.eu|zugferd\.de):\w+:\w+$|^urn:ferd:CrossIndustryDocument:/i.test(profile) || profile === "urn:cen.eu:en16931:2017") return "ZUGFeRD";
  return null;
}

export const RULESETS = ["zugferd", "xrechnung", "slowakei"] as const;
export type Ruleset = (typeof RULESETS)[number];

export const RULESET_LABELS: Record<Ruleset, string> = { zugferd: "ZUGFeRD", xrechnung: "XRechnung", slowakei: "Slowakei" };

/** Rule ids of the XRechnung schematron: the German CIUS plus the Peppol rules it adopted. */
const XRECHNUNG_RULE = /^(BR-DEX?|BR-TMP|PEPPOL-EN16931)-/;

function isXRechnungNotice(finding: Finding) {
  return finding.severity === "notice" && !!finding.rule && XRECHNUNG_RULE.test(finding.rule);
}

/**
 * The rulesets the report can be read for. Mustang also runs the XRechnung rules over BASIC and EN 16931 files
 * and reports what fails as a notice, so only for those profiles can the same report answer "would this pass
 * as an XRechnung?". The Slovak reading needs the Peppol rules, which the validator runs on UBL files.
 */
export function rulesetsFor(report: Report | null): Ruleset[] {
  const name = describeProfile(report?.profile ?? null)?.name;
  const rulesets: Ruleset[] = ["zugferd"];
  if (name === "BASIC" || name === "EN 16931") rulesets.push("xrechnung");
  if (report?.peppol) rulesets.push("slowakei");
  return rulesets;
}

/**
 * The ruleset to read a report with: the wanted one if the report offers it. Without a wish, a file that
 * declares Peppol BIS reads as Slovak, everything else as ZUGFeRD.
 */
export function rulesetFor(report: Report | null, wanted?: Ruleset | null): Ruleset {
  const choice = wanted ?? (formatOf(report?.profile ?? null) === "Peppol" ? "slowakei" : "zugferd");
  return rulesetsFor(report).includes(choice) ? choice : "zugferd";
}

/**
 * The report as it reads for one ruleset. ZUGFeRD drops the XRechnung notices, XRechnung counts them as errors.
 * Slovakia drops them too and adds the Peppol findings: there an invoice must pass both.
 */
export function reportFor(report: Report, ruleset: Ruleset): Report {
  const base = report.findings.filter((f) => !isXRechnungNotice(f));
  if (ruleset === "slowakei" && report.peppol) {
    const { peppol } = report;
    return {
      ...report,
      valid: report.valid && peppol.valid,
      xml: peppol.valid ? report.xml : "invalid",
      validator: `${report.validator} und ${peppol.rules}`,
      findings: [...base, ...peppol.findings],
    };
  }
  if (base.length === report.findings.length) return report;
  if (ruleset !== "xrechnung") return { ...report, findings: base };
  return {
    ...report,
    valid: false,
    xml: "invalid",
    findings: report.findings.map((f) => (isXRechnungNotice(f) ? { ...f, severity: "error" } : f)),
  };
}
