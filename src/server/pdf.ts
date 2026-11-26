import { EMBEDDED_INVOICE_NAMES } from "@/lib/file-type";

/** The invoice XML a PDF carries as an attachment, as the viewer finds it (see lib/open-file.ts). */
export async function embeddedXml(bytes: Uint8Array): Promise<{ name: string; xml: string } | null> {
  // The legacy build runs in Node. Imported here, the worker runs in this thread and lands in the
  // build; pdf.js' own lookup of its worker file would fail once bundled.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js takes ownership of the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true });
  try {
    const pdf = await task.promise;
    const xml = [...((await pdf.getAttachments()) ?? [])].filter(([, a]) => a.filename.toLowerCase().endsWith(".xml"));
    const invoice = xml.find(([, a]) => EMBEDDED_INVOICE_NAMES.includes(a.filename.toLowerCase())) ?? xml[0];
    if (!invoice) return null;
    const [id, attachment] = invoice;
    const content = attachment.content ?? (await pdf.getAttachmentContent(id));
    return content ? { name: attachment.filename, xml: new TextDecoder().decode(content) } : null;
  } finally {
    await task.destroy();
  }
}
