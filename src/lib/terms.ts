import data from "./bt-map.json";

/** A check on the DOM around an element, taken from the XPath predicates in the KoSIT mapping. */
export type Condition = {
  /** How many ancestors to climb from the matched element before checking. */
  up: number;
  attr?: string;
  child?: string;
  in?: string[];
  exists?: boolean;
  /** The attribute must equal this header element (used to tell BT-110 from BT-111). */
  equalsHeader?: string;
};

export type Term = {
  id: string;
  label: string;
  paths: { path: string; when?: Condition[] }[];
  children: string[];
  parent?: string;
};

// The KoSIT localisation only names the business terms. Group names follow the German EN 16931 wording.
const GROUP_LABELS: Record<string, string> = {
  "BG-1": "Bemerkung",
  "BG-2": "Prozesssteuerung",
  "BG-3": "Vorausgegangene Rechnung",
  "BG-4": "Verkäufer",
  "BG-5": "Anschrift des Verkäufers",
  "BG-6": "Kontakt des Verkäufers",
  "BG-7": "Käufer",
  "BG-8": "Anschrift des Käufers",
  "BG-9": "Kontakt des Käufers",
  "BG-10": "Zahlungsempfänger",
  "BG-11": "Steuervertreter des Verkäufers",
  "BG-12": "Anschrift des Steuervertreters",
  "BG-13": "Lieferung",
  "BG-14": "Rechnungszeitraum",
  "BG-15": "Lieferanschrift",
  "BG-16": "Zahlungsanweisungen",
  "BG-17": "Überweisung",
  "BG-18": "Zahlungskarte",
  "BG-19": "Lastschrift",
  "BG-20": "Nachlass",
  "BG-21": "Zuschlag",
  "BG-22": "Gesamtsummen",
  "BG-23": "Umsatzsteuer",
  "BG-24": "Rechnungsbegründende Unterlage",
  "BG-25": "Rechnungsposition",
  "BG-26": "Rechnungszeitraum der Position",
  "BG-27": "Nachlass der Position",
  "BG-28": "Zuschlag der Position",
  "BG-29": "Preisdetails",
  "BG-30": "Umsatzsteuer der Position",
  "BG-31": "Artikel",
  "BG-32": "Artikeleigenschaft",
};

export const terms = data.terms as Record<string, Term>;
for (const [id, label] of Object.entries(GROUP_LABELS)) if (terms[id]) terms[id].label = label;

const byPath = new Map<string, { term: Term; when?: Condition[] }[]>();
for (const term of Object.values(terms)) {
  for (const { path, when } of term.paths) {
    const list = byPath.get(path) ?? [];
    list.push({ term, when });
    byPath.set(path, list);
  }
}

export function candidatesForPath(path: string) {
  return byPath.get(path) ?? [];
}

export function isGroup(id: string) {
  return id.startsWith("BG-");
}

/** "Name" alone says little in a list of findings, so add the group: "Name (Käufer)". */
export function describeTerm(id: string): string | null {
  const term = terms[id];
  if (!term) return null;
  const group = term.parent ? terms[term.parent] : undefined;
  return group && group.label !== term.label ? `${term.label} (${group.label})` : term.label;
}

const NAMESPACE_PREFIX: Record<string, string> = {
  "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100": "rsm",
  "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100": "ram",
  "urn:un:unece:uncefact:data:standard:QualifiedDataType:100": "qdt",
  "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100": "udt",
};

export function prefixFor(namespace: string | null) {
  return (namespace && NAMESPACE_PREFIX[namespace]) || "";
}

export type Step = { name: string; local: string; index: number };

/**
 * Parses the element locations Mustang reports. They come in two spellings:
 *   /rsm:CrossIndustryInvoice/rsm:ExchangedDocument[1]
 *   /*:CrossIndustryInvoice[namespace-uri()='urn:…'][1]/…
 */
export function parseLocation(location: string): Step[] {
  const steps: Step[] = [];
  const pattern = /\/(\*|\w+):([\w.-]+)(?:\[namespace-uri\(\)='([^']*)'\])?(?:\[(\d+)\])?/g;
  for (const [, prefix, local, namespace, index] of location.matchAll(pattern)) {
    const resolved = prefix === "*" ? prefixFor(namespace ?? null) : prefix;
    steps.push({ name: resolved ? `${resolved}:${local}` : local, local, index: index ? Number(index) : 1 });
  }
  return steps;
}

const RELATIVE_PATH = /(?:rsm|ram|udt|qdt):\w+(?:\/(?:rsm|ram|udt|qdt):\w+)*/g;

/**
 * Names the business terms a finding is about. Rule texts usually cite them ("… (BT-1)").
 * Where they don't (the Factur-X profile rules only say "Element 'ram:ID' must occur exactly 1 times"),
 * we combine the reported location with the element names in the failed test and look the path up.
 */
export function termsForFinding(message: string, location: string | null, criterion: string | null): string[] {
  const cited = [...new Set([...message.matchAll(/\bB[TG]-\d+\b/g)].map((m) => m[0]))];
  if (cited.length) return cited;
  if (!location) return [];

  const base = parseLocation(location).map((s) => s.name);
  if (!base.length) return [];
  const relatives = criterion?.match(RELATIVE_PATH) ?? [];
  const found = new Set<string>();
  for (const relative of relatives.length ? relatives : [""]) {
    const steps = relative ? [...base, ...relative.split("/")] : [...base];
    // Walk up until some term or group covers the path, so even unmapped elements get their group.
    while (steps.length) {
      const hits = candidatesForPath("/" + steps.join("/"));
      if (hits.length) {
        for (const hit of hits) found.add(hit.term.id);
        break;
      }
      steps.pop();
    }
  }
  return [...found];
}
