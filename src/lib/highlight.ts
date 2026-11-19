import { csvDelimiter, LINE_BREAK } from "./csv";
import type { FileType } from "./file-type";
import { ADMIN, type IdocField, type IdocFile, type IdocSegment, walk } from "./idoc";
import { fieldLabel, qualifierOf, SEGMENT_LABELS } from "./idoc-terms";
import type { Line, Token, TokenKind } from "./xml-format";

/** Lines for the code view, coloured by what the file is. XML goes through formatXml instead. */

/** Past this the browser struggles; the download still has everything. */
export const MAX_LINES = 20_000;
const MAX_LINE = 4_000;

const NUMBER = /^-?\d+(?:[.,]\d+)?-?$/;

function shorten(text: string) {
  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}… (${text.length.toLocaleString("de-DE")} Zeichen)` : text;
}

function plain(text: string): Line[] {
  return text.split(LINE_BREAK, MAX_LINES + 1).map((line) => ({ indent: 0, tokens: [{ kind: "plain", text: shorten(line) }] }));
}

function title(type: string, field: IdocField) {
  const label = fieldLabel(type, field.name);
  return label ? `${field.name} · ${label}` : field.name;
}

/** One record: values alternate between two colours so neighbours without a gap stay apart. */
function record(text: string, type: string, fields: IdocField[], rest: IdocField | null, lead: Token[], from: number): Token[] {
  const tokens = [...lead];
  const qualifier = qualifierOf(type)?.field;
  let at = from;
  let odd = false;
  const push = (kind: TokenKind, end: number, hint?: string) => {
    if (end > at) tokens.push({ kind, text: text.slice(at, end), title: hint });
    at = end;
  };
  for (const field of fields) {
    if (!field.value) continue;
    // Empty fields and the padding in front of this one become a single stretch of spaces.
    push("plain", field.start);
    push(field.name === qualifier ? "attr" : odd ? "alt" : "text", field.end, title(type, field));
    odd = !odd;
  }
  if (rest) {
    push("plain", rest.start);
    tokens.push({ kind: fields.length ? "comment" : "plain", text: shorten(text.slice(rest.start)), title: fields.length ? "Nicht in der Segmentdefinition" : undefined });
  } else push("plain", text.length);
  return tokens;
}

function idoc(file: IdocFile): Line[] {
  const lines: Line[] = [];
  const segments = new Map<number, IdocSegment>();
  for (const one of file.idocs) for (const segment of walk(one.segments)) segments.set(segment.line, segment);
  const controls = new Map(file.idocs.map((one) => [one.line, one]));
  let nested = false;

  file.records.slice(0, MAX_LINES + 1).forEach((text, index) => {
    const control = controls.get(index);
    const segment = segments.get(index);
    if (control) {
      const [table, ...fields] = control.control;
      lines.push({ indent: 0, gap: index > 0, tokens: record(text, "EDI_DC40", fields, null, [{ kind: "name", text: text.slice(0, table.end), title: SEGMENT_LABELS.EDI_DC40 }], table.end) });
    } else if (segment) {
      const lead: Token[] = [];
      let at = 0;
      for (const [name, length] of ADMIN) {
        const part = text.slice(at, at + length);
        lead.push(name === "SEGNAM" ? { kind: "name", text: part, title: SEGMENT_LABELS[segment.type] ?? segment.type } : { kind: "prolog", text: part, title: name });
        at += length;
      }
      // A segment with children (an item) and the first segment after its block start a new group.
      const gap = segment.depth === 0 && (segment.children.length > 0 || nested);
      lines.push({ indent: segment.depth, gap, tokens: record(text, segment.type, segment.fields, segment.rest, lead, at) });
      nested = segment.depth > 0 || segment.children.length > 0;
    } else lines.push({ indent: 0, tokens: [{ kind: "plain", text: shorten(text) }] });
  });
  return lines;
}

const JSON_TOKEN = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]/g;

/** Re-indents the file's own tokens. Parsing and printing it again would round long numbers and drop repeated keys. */
function json(text: string): Line[] {
  try {
    JSON.parse(text);
  } catch {
    return plain(text);
  }
  const all = text.match(JSON_TOKEN) ?? [];
  const lines: Line[] = [];
  let indent = 0;
  let tokens: Token[] = [];
  const end = () => {
    if (tokens.length) lines.push({ indent, tokens });
    tokens = [];
  };
  for (let i = 0; i < all.length && lines.length <= MAX_LINES; i++) {
    const token = all[i];
    if (token === "{" || token === "[") {
      tokens.push({ kind: "bracket", text: token });
      // An empty object or array stays on one line.
      if (all[i + 1] === "}" || all[i + 1] === "]") continue;
      end();
      indent++;
    } else if (token === "}" || token === "]") {
      if (all[i - 1] !== "{" && all[i - 1] !== "[") {
        end();
        indent--;
      }
      tokens.push({ kind: "bracket", text: token });
    } else if (token === ",") {
      tokens.push({ kind: "bracket", text: token });
      end();
    } else if (token === ":") tokens.push({ kind: "equals", text: ": " });
    else if (token.startsWith('"')) tokens.push({ kind: "quote", text: '"' }, { kind: all[i + 1] === ":" ? "name" : "value", text: shorten(token.slice(1, -1)) }, { kind: "quote", text: '"' });
    else tokens.push({ kind: /^[tfn]/.test(token) ? "attr" : "number", text: token });
  }
  end();
  return lines;
}

/** One EDIFACT segment per line, whether or not the file breaks lines after them. */
function edifact(text: string): Line[] {
  const una = text.match(/^\s*UNA(.{6})/)?.[1];
  const [component, element, , release, , terminator] = una ?? ":+.? '";
  const body = una ? text.slice(text.indexOf("UNA") + 9) : text;
  const lines: Line[] = [];
  if (una) lines.push({ indent: 0, tokens: [{ kind: "name", text: "UNA" }, { kind: "bracket", text: una }] });

  let tokens: Token[] = [];
  let value = "";
  const flush = () => {
    if (!value) return;
    tokens.push({ kind: tokens.length ? (NUMBER.test(value) ? "number" : "text") : "name", text: value });
    value = "";
  };
  for (let i = 0; i < body.length && lines.length <= MAX_LINES; i++) {
    const ch = body[i];
    if (ch === release && i + 1 < body.length) value += ch + body[++i];
    else if (ch === terminator) {
      flush();
      tokens.push({ kind: "bracket", text: ch });
      const tag = tokens[0].text;
      lines.push({ indent: 0, gap: tag === "UNH" || tag === "UNG" || tag === "UNZ", tokens });
      tokens = [];
    } else if (ch === element || ch === component) {
      flush();
      tokens.push({ kind: ch === element ? "bracket" : "prefix", text: ch });
    } else if (value || tokens.length || !/\s/.test(ch)) value += ch;
  }
  flush();
  if (tokens.length) lines.push({ indent: 0, tokens });
  return lines;
}

const COLUMN_KINDS: TokenKind[] = ["text", "alt", "value", "attr"];

/** Columns take turns through four colours, so a value can be followed down the file. */
function csv(text: string): Line[] {
  const delimiter = csvDelimiter(text);
  // A quoted cell may hold the delimiter.
  const cell = new RegExp(`"(?:[^"]|"")*"|[^${delimiter === "|" ? "\\|" : delimiter}]+`, "g");
  return text.split(LINE_BREAK, MAX_LINES + 1).map((row) => {
    const tokens: Token[] = [];
    let at = 0;
    let column = 0;
    for (const match of row.matchAll(cell)) {
      for (; at < match.index; at++, column++) tokens.push({ kind: "bracket", text: delimiter });
      tokens.push({ kind: COLUMN_KINDS[column % COLUMN_KINDS.length], text: shorten(match[0]) });
      at = match.index + match[0].length;
    }
    for (; at < row.length; at++) tokens.push({ kind: "bracket", text: delimiter });
    return { indent: 0, tokens };
  });
}

/** idocFile is the parsed flat file, when the text is one. */
export function highlight(text: string, type: FileType, idocFile: IdocFile | null): { lines: Line[]; truncated: boolean } {
  const lines = idocFile?.records.length ? idoc(idocFile) : type === "json" ? json(text) : type === "edifact" ? edifact(text) : type === "csv" ? csv(text) : plain(text);
  // Editors show no line for the line break that ends a file.
  if (lines.length > 1 && lines.at(-1)!.tokens.every((token) => !token.text)) lines.pop();
  return { lines: lines.slice(0, MAX_LINES), truncated: lines.length > MAX_LINES };
}
