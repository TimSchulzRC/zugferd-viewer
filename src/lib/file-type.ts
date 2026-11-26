import { looksLikeCsv } from "./csv";

/**
 * What a file is, read from its content. Names don't help: IDocs arrive as .txt, .idoc, .dat or
 * without an ending. The server stores the type on upload, the viewer picks its view by it.
 */
export const FILE_TYPES = ["invoice", "idoc", "xml", "edifact", "json", "csv", "text"] as const;
export type FileType = (typeof FILE_TYPES)[number];

/** How the file list names the types. Invoices show their standard instead (see formatOf in report.ts). */
export const FILE_TYPE_LABELS: Record<Exclude<FileType, "invoice">, string> = {
  idoc: "IDoc",
  xml: "XML",
  edifact: "EDIFACT",
  json: "JSON",
  csv: "CSV",
  text: "Text",
};

const HEAD = 8192;

/** Names the standards prescribe for the invoice embedded in a PDF, most recent first. */
export const EMBEDDED_INVOICE_NAMES = ["factur-x.xml", "xrechnung.xml", "zugferd-invoice.xml", "order-x.xml"];

export function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

/** The text of a file, or null if it is not text. SAP systems that are not Unicode write Windows-1252. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const head = bytes.subarray(0, HEAD);
  if (head.includes(0)) return null;
  // EDIFACT and X12 may separate with the control characters 0x1c to 0x1f, so those count as text.
  const control = head.reduce((count, byte) => count + (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f].includes(byte) ? 1 : 0), 0);
  if (control > head.length / 20) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Root elements of the invoices the validator knows: CII, ZUGFeRD 1 and UBL. */
const INVOICE_ROOTS = new Set(["CrossIndustryInvoice", "CrossIndustryDocument", "Invoice", "CreditNote"]);
const XML_HEAD = 65536;

/**
 * The local name of the document element. Steps over the declaration, comments and the doctype one
 * after the other: the standards' own samples open with pages of licence text in a comment.
 */
function rootName(xml: string): string | null {
  let at = 0;
  const skipPast = (close: string, from = at) => {
    const end = xml.indexOf(close, from);
    at = end < 0 ? xml.length : end + close.length;
  };
  for (;;) {
    while (at < xml.length && /\s/.test(xml[at])) at++;
    if (xml.startsWith("<?", at)) skipPast("?>");
    else if (xml.startsWith("<!--", at)) skipPast("-->");
    else if (xml.startsWith("<!", at)) {
      // A doctype may declare entities in brackets, which hold ">" of their own.
      const subset = xml.indexOf("[", at);
      const end = xml.indexOf(">", at);
      skipPast(">", subset >= 0 && subset < end ? Math.max(subset, xml.indexOf("]", subset)) : at);
    } else break;
  }
  return xml.slice(at, at + 200).match(/^<(?:[\w.-]+:)?([\w.-]+)/)?.[1] ?? null;
}

export function textType(text: string, name: string): FileType {
  const start = text.slice(0, HEAD).replace(/^﻿/, "").trimStart();
  if (start.startsWith("EDI_DC40")) return "idoc";
  if (start.startsWith("<")) {
    if (INVOICE_ROOTS.has(rootName(text.slice(0, XML_HEAD).replace(/^\uFEFF/, "")) ?? "")) return "invoice";
    return /<(?:[\w.-]+:)?EDI_DC40[\s>]/.test(start) ? "idoc" : "xml";
  }
  if (/^(?:UNA.{6}\s*)?UNB\+/.test(start)) return "edifact";
  if (/\.json$/i.test(name)) return "json";
  if (/^[[{]/.test(start) && text.length < 2_000_000) {
    try {
      JSON.parse(text);
      return "json";
    } catch {}
  }
  if (/\.csv$/i.test(name) || looksLikeCsv(text)) return "csv";
  return "text";
}

/** The type of an uploaded file, or null for what the app cannot show: anything binary but PDF. */
export function fileType(bytes: Uint8Array, name: string): FileType | null {
  if (isPdf(bytes)) return "invoice";
  const text = decodeText(bytes);
  return text === null ? null : textType(text, name);
}
