import { candidatesForPath, isGroup, prefixFor, terms, type Condition, type Step, type Term } from "./terms";

const pathCache = new WeakMap<Element, string>();

/** Path with the canonical CII prefixes, whatever prefixes the file itself declares. */
export function elementPath(el: Element): string {
  let path = pathCache.get(el);
  if (path === undefined) {
    const prefix = prefixFor(el.namespaceURI);
    const name = prefix ? `${prefix}:${el.localName}` : el.localName;
    path = (el.parentElement ? elementPath(el.parentElement) : "") + "/" + name;
    pathCache.set(el, path);
  }
  return path;
}

function childText(el: Element, path: string): string | null {
  let current: Element | undefined = el;
  for (const name of path.split("/")) {
    const local = name.split(":").pop();
    current = [...current.children].find((child) => child.localName === local);
    if (!current) return null;
  }
  return current.textContent?.trim() ?? null;
}

function holds(el: Element, condition: Condition): boolean {
  let target: Element | null = el;
  for (let i = 0; i < condition.up; i++) target = target?.parentElement ?? null;
  if (!target) return false;
  if (condition.attr) {
    const value = target.getAttribute(condition.attr);
    if (condition.exists) return value !== null;
    if (condition.in) return value !== null && condition.in.includes(value);
    if (condition.equalsHeader) {
      const local = condition.equalsHeader.split(":").pop()!;
      const header = el.ownerDocument.getElementsByTagNameNS("*", local)[0]?.textContent?.trim();
      // Without currencyID the amount is in the invoice currency.
      if (value === null) return local === "InvoiceCurrencyCode";
      return value === header;
    }
  }
  if (condition.child && condition.in) {
    const text = childText(target, condition.child);
    return text !== null && condition.in.includes(text);
  }
  return true;
}

/** The business term or group an element stands for, if EN 16931 defines one. */
export function resolveTerm(el: Element): Term | undefined {
  return candidatesForPath(elementPath(el)).find(({ when }) => !when || when.every((c) => holds(el, c)))?.term;
}

export function findElement(doc: Document, steps: Step[]): Element | null {
  let current: Element | null = doc.documentElement;
  if (!steps.length || current.localName !== steps[0].local) return null;
  for (const step of steps.slice(1)) {
    const matches: Element[] = [...current.children].filter((child) => child.localName === step.local);
    current = matches[step.index - 1] ?? null;
    if (!current) return null;
  }
  return current;
}

export type Field = { el: Element; term?: Term; label: string; value: string };
/** `el` is the XML element one instance of the group lives in (one line item, one VAT row …), if it has one. */
export type Group = { key: string; id: string; label: string; el?: Element; fields: Field[]; groups: Group[] };
export type Invoice = { root: Group; other: Field[]; currency: string | null };

const DOCUMENT_TYPES: Record<string, string> = {
  "326": "Teilrechnung",
  "380": "Rechnung",
  "381": "Gutschrift",
  "383": "Belastungsanzeige",
  "384": "Rechnungskorrektur",
  "386": "Vorauszahlungsrechnung",
  "387": "Mietrechnung",
  "389": "Selbst ausgestellte Rechnung",
  "751": "Buchungshilfe, keine Rechnung",
  "875": "Abschlagsrechnung",
  "876": "Teilschlussrechnung",
  "877": "Schlussrechnung",
};

const VAT_CATEGORIES: Record<string, string> = {
  S: "Regelsteuersatz",
  Z: "Nullsatz",
  E: "Steuerbefreit",
  AE: "Reverse Charge",
  K: "Innergemeinschaftliche Lieferung",
  G: "Ausfuhr",
  O: "Nicht steuerbar",
  L: "IGIC (Kanaren)",
  M: "IPSI (Ceuta, Melilla)",
};

const PAYMENT_MEANS: Record<string, string> = {
  "1": "Nicht festgelegt",
  "10": "Barzahlung",
  "20": "Scheck",
  "30": "Überweisung",
  "42": "Überweisung",
  "48": "Kartenzahlung",
  "49": "Lastschrift",
  "54": "Kreditkarte",
  "55": "Debitkarte",
  "57": "Dauerauftrag",
  "58": "SEPA-Überweisung",
  "59": "SEPA-Lastschrift",
  "97": "Verrechnung",
};

const UNITS: Record<string, string> = {
  C62: "Stk.",
  H87: "Stk.",
  XPP: "Stk.",
  NAR: "Stk.",
  LS: "pauschal",
  HUR: "Std.",
  MIN: "Min.",
  DAY: "Tage",
  WEE: "Wochen",
  MON: "Monate",
  ANN: "Jahre",
  KGM: "kg",
  GRM: "g",
  TNE: "t",
  MTR: "m",
  KMT: "km",
  CMT: "cm",
  MMT: "mm",
  MTK: "m²",
  MTQ: "m³",
  LTR: "l",
  KWH: "kWh",
  P1: "%",
  SET: "Sets",
  PR: "Paar",
  XBX: "Kartons",
  XPK: "Pakete",
};

const CODE_LISTS: Record<string, Record<string, string>> = {
  "BT-3": DOCUMENT_TYPES,
  "BT-81": PAYMENT_MEANS,
  "BT-95": VAT_CATEGORIES,
  "BT-102": VAT_CATEGORIES,
  "BT-118": VAT_CATEGORIES,
  "BT-151": VAT_CATEGORIES,
};

export function formatNumber(raw: string, minDecimals = 0): string {
  const number = Number(raw);
  if (raw.trim() === "" || Number.isNaN(number)) return raw;
  const decimals = raw.trim().split(".")[1]?.length ?? 0;
  return number.toLocaleString("de-DE", { minimumFractionDigits: Math.max(minDecimals, Math.min(decimals, 2)), maximumFractionDigits: Math.max(minDecimals, decimals) });
}

function formatValue(el: Element, term: Term | undefined, currency: string | null): string {
  const raw = el.textContent?.trim() ?? "";
  const local = el.localName;
  if ((local === "DateTimeString" || local === "DateString") && /^\d{8}$/.test(raw))
    return `${raw.slice(6, 8)}.${raw.slice(4, 6)}.${raw.slice(0, 4)}`;
  if (local.endsWith("Amount")) return `${formatNumber(raw, 2)} ${el.getAttribute("currencyID") ?? currency ?? ""}`.trim();
  if (local.endsWith("Percent")) return `${formatNumber(raw)} %`;
  if (local.endsWith("Quantity")) {
    const unit = el.getAttribute("unitCode");
    return unit ? `${formatNumber(raw)} ${UNITS[unit] ?? unit}` : formatNumber(raw);
  }
  if (local === "Indicator") return raw === "true" ? "Ja" : raw === "false" ? "Nein" : raw;
  if (local === "AttachmentBinaryObject") {
    const kb = Math.max(1, Math.round((raw.length * 3) / 4 / 1024));
    return `${el.getAttribute("filename") ?? "Anhang"} (${kb.toLocaleString("de-DE")} kB)`;
  }
  const meaning = term && CODE_LISTS[term.id]?.[raw];
  if (meaning) return `${meaning} (${raw})`;
  const scheme = el.getAttribute("schemeID");
  return scheme ? `${raw} (${scheme})` : raw;
}

// These only tell allowance from charge; the group title already says which it is.
const HIDDEN = new Set(["ChargeIndicator"]);

/** Sorts every value in the invoice into its EN 16931 group, in document order. */
export function buildInvoice(doc: Document): Invoice {
  const root: Group = { key: "", id: "root", label: "", fields: [], groups: [] };
  const other: Field[] = [];
  const groups = new Map<string, Group>();
  const instanceIds = new WeakMap<Element, number>();
  let nextInstance = 1;
  const currency = doc.getElementsByTagNameNS("*", "InvoiceCurrencyCode")[0]?.textContent?.trim() || null;

  for (const leaf of doc.getElementsByTagName("*")) {
    if (leaf.children.length || !leaf.textContent?.trim()) continue;
    const parent = leaf.parentElement;
    if (parent && HIDDEN.has(parent.localName)) continue;

    // Dates and the like sit one level below the element the term is defined on.
    const wrapped = parent && parent.children.length === 1 && ["udt", "qdt"].includes(prefixFor(leaf.namespaceURI));
    let term = resolveTerm(leaf) ?? (wrapped ? resolveTerm(parent) : undefined);
    let groupId = term?.parent;
    if (term && isGroup(term.id)) {
      groupId = term.id;
      term = undefined;
    }
    if (!term && !groupId) {
      for (let a = parent; a; a = a.parentElement) {
        const t = resolveTerm(a);
        if (t && isGroup(t.id)) {
          groupId = t.id;
          break;
        }
      }
    }

    const field: Field = { el: leaf, term, label: term?.label ?? (wrapped ? parent.localName : leaf.localName), value: formatValue(leaf, term, currency) };
    if (!term && !groupId) {
      other.push(field);
      continue;
    }

    const chain: string[] = [];
    for (let id = groupId; id; id = terms[id]?.parent) chain.unshift(id);
    let group = root;
    for (const id of chain) {
      const paths = new Set(terms[id].paths.map((p) => p.path));
      let instance: Element | null = leaf;
      while (instance && !paths.has(elementPath(instance))) instance = instance.parentElement;
      let instanceId = 0;
      if (instance) {
        instanceId = instanceIds.get(instance) ?? nextInstance++;
        instanceIds.set(instance, instanceId);
      }
      const key = `${group.key}/${id}:${instanceId}`;
      let child = groups.get(key);
      if (!child) {
        child = { key, id, label: terms[id].label, el: instance ?? undefined, fields: [], groups: [] };
        groups.set(key, child);
        group.groups.push(child);
      }
      group = child;
    }
    group.fields.push(field);
  }
  // EN 16931 numbers the terms in reading order (street, city, post code …), XML order is arbitrary.
  const number = (f: Field) => (f.term ? Number(f.term.id.split("-")[1]) : Infinity);
  for (const group of [root, ...groups.values()]) group.fields.sort((a, b) => number(a) - number(b));
  return { root, other, currency };
}

export type Highlight = { fields: Set<Field>; groups: Set<string>; header: boolean };

function flatten(group: Group, fields: Field[] = [], groups: Group[] = []) {
  fields.push(...group.fields);
  for (const child of group.groups) {
    groups.push(child);
    flatten(child, fields, groups);
  }
  return { fields, groups };
}

/**
 * What to mark in the prepared view for a finding. `element` is where the validator located it,
 * `termIds` the business terms it is about.
 *   1. The fields of those terms, inside the located element where possible.
 *   2. A term that is missing has no field, so its group is marked (BT-44 missing: "Käufer").
 *   3. Without terms: the located field, or the group it sits in.
 */
export function highlightFor(invoice: Invoice, element: Element | null, termIds: string[]): Highlight | null {
  const { fields, groups } = flatten(invoice.root);
  fields.push(...invoice.other);
  const inside = (el: Element | undefined) => !!el && !!element && (element === el || element.contains(el));
  const result = (f: Field[], g: Group[] = [], header = false): Highlight => ({ fields: new Set(f), groups: new Set(g.map((group) => group.key)), header });

  const ofTerms = fields.filter((field) => field.term && termIds.includes(field.term.id));
  const ofTermsInside = ofTerms.filter((field) => inside(field.el));
  if (ofTermsInside.length) return result(ofTermsInside);
  if (ofTerms.length) return result(ofTerms);

  for (const id of termIds) {
    const groupId = isGroup(id) ? id : terms[id]?.parent;
    // Invoice-level terms (BT-1 and friends) are shown in the block at the top.
    if (!groupId) return terms[id] ? result([], [], true) : null;
    for (let current: string | undefined = groupId; current; current = terms[current]?.parent) {
      const candidates = groups.filter((group) => group.id === current);
      const near = candidates.filter((group) => inside(group.el) || (!!group.el && !!element && group.el.contains(element)));
      if (candidates.length) return result([], near.length ? near : candidates);
    }
  }

  if (!element) return null;
  const located = fields.filter((field) => inside(field.el));
  // The whole document "contains" every field, which would mark everything.
  if (located.length && located.length < fields.length) return result(located);
  let deepest: Group | undefined;
  for (const group of groups) if (group.el && (group.el === element || group.el.contains(element))) deepest = group;
  return deepest ? result([], [deepest]) : null;
}
