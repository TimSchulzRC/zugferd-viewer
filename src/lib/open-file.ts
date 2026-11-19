import { decodeText, isPdf, type FileType } from "./file-type";

export type OpenedFile = {
  file: File;
  pdfUrl: string | null;
  /** The invoice data of a PDF, or the file itself if it is XML. */
  xml: string | null;
  doc: Document | null;
  /** The whole file as text, null for a PDF. */
  text: string | null;
};

// Names the standards prescribe for the embedded invoice, most recent first.
const KNOWN_NAMES = ["factur-x.xml", "xrechnung.xml", "zugferd-invoice.xml", "order-x.xml"];

async function embeddedXml(bytes: ArrayBuffer): Promise<string | null> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const attachments = [...((await pdf.getAttachments()) ?? [])].filter(([, a]) => a.filename.toLowerCase().endsWith(".xml"));
    const invoice = attachments.find(([, a]) => KNOWN_NAMES.includes(a.filename.toLowerCase())) ?? attachments[0];
    if (!invoice) return null;
    const [id, attachment] = invoice;
    const content = attachment.content ?? (await pdf.getAttachmentContent(id));
    return content ? new TextDecoder().decode(content) : null;
  } finally {
    await task.destroy();
  }
}

function parse(xml: string | null): Document | null {
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

export async function openFile(file: File, type: FileType): Promise<OpenedFile> {
  const bytes = await file.arrayBuffer();
  if (!isPdf(new Uint8Array(bytes))) {
    const text = decodeText(new Uint8Array(bytes)) ?? new TextDecoder().decode(bytes);
    // An invoice is XML even when broken; of the other types only those that start like XML are.
    const xml = type === "invoice" || text.trimStart().startsWith("<") ? text : null;
    return { file, pdfUrl: null, xml, doc: parse(xml), text };
  }
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const xml = await embeddedXml(bytes.slice(0));
  const pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  return { file, pdfUrl, xml, doc: parse(xml), text: null };
}
