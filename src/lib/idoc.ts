import segments from "./idoc-segments.json";

/*
 * SAP IDocs, as a flat file or as XML. A flat file holds one record per line: a control record
 * (EDI_DC40, 524 characters) and then data records, each 63 characters of administration followed
 * by up to 1000 characters of segment data. Fields have no separators, only fixed lengths, which
 * idoc-segments.json lists per segment.
 */

const DEFINITIONS = segments as unknown as Record<string, [name: string, length: number][]>;
const CONTROL = "EDI_DC40";
const CONTROL_LENGTH = 524;
/** SEGNAM 30, MANDT 3, DOCNUM 16, SEGNUM 6, PSGNUM 6, HLEVEL 2. */
export const ADMIN = [
  ["SEGNAM", 30],
  ["MANDT", 3],
  ["DOCNUM", 16],
  ["SEGNUM", 6],
  ["PSGNUM", 6],
  ["HLEVEL", 2],
] as const;
const ADMIN_LENGTH = 63;
const RECORD_LENGTH = 1063;

/** start and end are the field's place in its line of the flat file; an XML IDoc has none. */
export type IdocField = { name: string; value: string; start: number; end: number };

export type IdocSegment = {
  /** The name the definitions and labels go by: E1EDK01. */
  type: string;
  /** The name in the file. Flat files carry the versioned external name: E2EDK01005. */
  name: string;
  /** Index of the record in the flat file, -1 for XML. */
  line: number;
  depth: number;
  /** Every field of the definition the line reaches, empty ones included. */
  fields: IdocField[];
  /** Data no definition covers: the whole content of an unknown segment, or what follows the last known field. */
  rest: IdocField | null;
  children: IdocSegment[];
};

export type Idoc = { line: number; control: IdocField[]; segments: IdocSegment[] };
export type IdocFile = { records: string[]; idocs: Idoc[] };

/** "E2EDK01005" is version 005 of the external name of E1EDK01. */
function typeOf(name: string): string {
  const internal = name.replace(/^([A-Z])2/, "$11");
  const candidates = [name, internal, name.replace(/\d{3}$/, ""), internal.replace(/\d{3}$/, "")];
  return candidates.find((candidate) => candidate in DEFINITIONS) ?? name;
}

function cut(record: string, offset: number, type: string): { fields: IdocField[]; rest: IdocField | null } {
  const fields: IdocField[] = [];
  let start = offset;
  for (const [name, length] of DEFINITIONS[type] ?? []) {
    if (start >= record.length) break;
    const end = Math.min(start + length, record.length);
    fields.push({ name, value: record.slice(start, end).trim(), start, end });
    start += length;
  }
  const rest = record.slice(start).trim();
  return { fields, rest: rest ? { name: "", value: rest, start, end: record.length } : null };
}

/** Some ports write the records one after another without line breaks. */
function split(text: string): string[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length !== 1 || lines[0].length <= CONTROL_LENGTH + ADMIN_LENGTH) return lines;
  const records: string[] = [];
  for (let at = 0; at < lines[0].length; ) {
    const length = lines[0].startsWith(CONTROL, at) ? CONTROL_LENGTH : RECORD_LENGTH;
    records.push(lines[0].slice(at, at + length));
    at += length;
  }
  return records;
}

export function parseIdoc(text: string): IdocFile {
  const records = split(text);
  const idocs: Idoc[] = [];
  let byNumber = new Map<number, IdocSegment>();
  let open: { level: number; segment: IdocSegment }[] = [];

  records.forEach((record, line) => {
    if (record.startsWith(CONTROL)) {
      idocs.push({ line, control: cut(record, 0, CONTROL).fields, segments: [] });
      byNumber = new Map();
      open = [];
      return;
    }
    const idoc = idocs.at(-1);
    if (!idoc) return;
    const name = record.slice(0, 30).trim();
    const number = Number.parseInt(record.slice(49, 55), 10);
    const parentNumber = Number.parseInt(record.slice(55, 61), 10);
    const level = Number.parseInt(record.slice(61, 63), 10);

    // PSGNUM names the parent. Files written without it still carry the level.
    let parent = byNumber.get(parentNumber);
    if (!parent && Number.isNaN(parentNumber) && !Number.isNaN(level)) {
      while (open.length && open.at(-1)!.level >= level) open.pop();
      parent = open.at(-1)?.segment;
    }
    const type = typeOf(name);
    const segment: IdocSegment = { type, name, line, depth: parent ? parent.depth + 1 : 0, ...cut(record, ADMIN_LENGTH, type), children: [] };
    (parent ? parent.children : idoc.segments).push(segment);
    if (!Number.isNaN(number)) byNumber.set(number, segment);
    if (!Number.isNaN(level)) open.push({ level, segment });
  });
  return { records, idocs };
}

const elements = (el: Element) => [...el.children];
const leaf = (el: Element): IdocField => ({ name: el.localName, value: el.textContent?.trim() ?? "", start: -1, end: -1 });

function xmlSegment(el: Element, depth: number): IdocSegment {
  // Below a segment, an element with elements of its own is a child segment, anything else a field.
  const isSegment = (child: Element) => child.children.length > 0 || child.hasAttribute("SEGMENT");
  return {
    type: typeOf(el.localName),
    name: el.localName,
    line: -1,
    depth,
    fields: elements(el).filter((child) => !isSegment(child)).map(leaf),
    rest: null,
    children: elements(el).filter(isSegment).map((child) => xmlSegment(child, depth + 1)),
  };
}

/** The IDocs of an XML file, or null if it holds none. */
export function parseXmlIdoc(doc: Document): IdocFile | null {
  const idocs = [...doc.getElementsByTagName("*")]
    .filter((el) => elements(el).some((child) => child.localName === CONTROL))
    .map((el) => ({
      line: -1,
      control: elements(elements(el).find((child) => child.localName === CONTROL)!).map(leaf),
      segments: elements(el).filter((child) => child.localName !== CONTROL).map((child) => xmlSegment(child, 0)),
    }));
  return idocs.length ? { records: [], idocs } : null;
}

export function valueOf(fields: IdocField[], name: string): string {
  return fields.find((field) => field.name === name)?.value ?? "";
}

/** Every segment of the file in the order of its lines, parents before their children. */
export function* walk(list: IdocSegment[]): Generator<IdocSegment> {
  for (const segment of list) {
    yield segment;
    yield* walk(segment.children);
  }
}
