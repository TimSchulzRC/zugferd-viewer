export type TokenKind = "bracket" | "prefix" | "name" | "attr" | "equals" | "quote" | "value" | "text" | "number" | "comment" | "prolog";
export type Token = { kind: TokenKind; text: string };
export type Line = { indent: number; tokens: Token[] };
export type FormattedXml = { lines: Line[]; lineOf: Map<Element, number> };

const MAX_TEXT = 300;
// Past this many attributes (the root element's namespace declarations) one line gets unreadable.
const MAX_INLINE_ATTRIBUTES = 2;

/** "ram:ID" becomes a dimmed prefix and the name, so the eye lands on the name. */
function qualifiedName(name: string, kind: "name" | "attr"): Token[] {
  const colon = name.indexOf(":");
  if (colon < 0) return [{ kind, text: name }];
  return [
    { kind: "prefix", text: name.slice(0, colon + 1) },
    { kind, text: name.slice(colon + 1) },
  ];
}

function attribute(attr: Attr): Token[] {
  return [
    ...qualifiedName(attr.name, "attr"),
    { kind: "equals", text: "=" },
    { kind: "quote", text: '"' },
    { kind: "value", text: attr.value },
    { kind: "quote", text: '"' },
  ];
}

/** The opening tag as one line, or with one attribute per line when there are many. */
function openTag(el: Element, close: string): Token[][] {
  const start: Token[] = [{ kind: "bracket", text: "<" }, ...qualifiedName(el.tagName, "name")];
  const attributes = [...el.attributes];
  if (attributes.length <= MAX_INLINE_ATTRIBUTES) {
    for (const attr of attributes) start.push({ kind: "text", text: " " }, ...attribute(attr));
    start.push({ kind: "bracket", text: close });
    return [start];
  }
  const rows = attributes.map((attr) => attribute(attr));
  rows[rows.length - 1].push({ kind: "bracket", text: close });
  return [start, ...rows];
}

function closeTag(el: Element): Token[] {
  return [{ kind: "bracket", text: "</" }, ...qualifiedName(el.tagName, "name"), { kind: "bracket", text: ">" }];
}

function content(text: string): Token {
  return { kind: /^-?\d+(?:[.,]\d+)?$/.test(text) ? "number" : "text", text: shorten(text) };
}

function shorten(text: string) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}… (${text.length.toLocaleString("de-DE")} Zeichen)` : text;
}

/** Indents the document one element per line and remembers which line each element starts on. */
export function formatXml(doc: Document): FormattedXml {
  const lines: Line[] = [{ indent: 0, tokens: [{ kind: "prolog", text: '<?xml version="1.0" encoding="UTF-8"?>' }] }];
  const lineOf = new Map<Element, number>();

  const visit = (node: Node, indent: number) => {
    if (node.nodeType === Node.COMMENT_NODE) {
      for (const text of `<!--${node.textContent}-->`.split("\n")) lines.push({ indent, tokens: [{ kind: "comment", text: text.trim() }] });
    } else if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push({ indent, tokens: [content(text)] });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      lineOf.set(el, lines.length);
      const empty = !el.childNodes.length;
      const leaf = !empty && !el.children.length && ![...el.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE);
      const [first, ...attributeRows] = openTag(el, empty ? "/>" : ">");
      const last = attributeRows.at(-1) ?? first;
      const text = leaf ? (el.textContent?.trim() ?? "") : "";
      const multiline = text.includes("\n");
      if (leaf && !multiline) last.push(content(text), ...closeTag(el));
      lines.push({ indent, tokens: first });
      // Attribute rows hang two levels in, so they don't read as child elements.
      for (const row of attributeRows) lines.push({ indent: indent + 2, tokens: row });
      if (multiline) {
        // Text with line breaks (addresses, notes) gets one row per line, indented like child content.
        for (const row of shorten(text).split("\n")) lines.push({ indent: indent + 1, tokens: [{ kind: "text", text: row.trim() }] });
        lines.push({ indent, tokens: closeTag(el) });
      }
      if (!empty && !leaf) {
        el.childNodes.forEach((child) => visit(child, indent + 1));
        lines.push({ indent, tokens: closeTag(el) });
      }
    }
  };
  doc.childNodes.forEach((node) => visit(node, 0));
  return { lines, lineOf };
}
