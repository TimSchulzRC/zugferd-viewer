export type OpenedFile = {
  file: File;
  pdfUrl: string | null;
  xml: string | null;
  doc: Document | null;
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

export async function openFile(file: File): Promise<OpenedFile> {
  const bytes = await file.arrayBuffer();
  const isPdf = new TextDecoder("latin1").decode(bytes.slice(0, 1024)).includes("%PDF-");
  if (!isPdf) {
    const xml = new TextDecoder().decode(bytes);
    return { file, pdfUrl: null, xml, doc: parse(xml) };
  }
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const xml = await embeddedXml(bytes.slice(0));
  const pdfUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  return { file, pdfUrl, xml, doc: parse(xml) };
}
