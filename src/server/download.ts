import { downloadZip } from "client-zip";
import { attachment, HttpError } from "./http";
import { content, type tree } from "./nodes";
import { getObject } from "./storage";

type Entries = Awaited<ReturnType<typeof tree>>;

/** One file comes back as it is. Several files or any folder come back as a zip that keeps the folder structure. */
export async function downloadResponse(ids: string[], entries: Entries): Promise<Response> {
  if (!entries.length) throw new HttpError(404, "Nicht gefunden");

  if (ids.length === 1 && entries.length === 1 && entries[0].kind === "file") {
    const { name, size, object } = await content(ids[0]);
    return new Response(object.stream(), {
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size), "Content-Disposition": attachment(name) },
    });
  }

  async function* files() {
    for (const entry of entries) {
      if (entry.kind === "folder") yield { name: `${entry.path}/`, lastModified: entry.updated_at };
      else if (entry.storage_key) yield { name: entry.path, lastModified: entry.updated_at, input: (await getObject(entry.storage_key)).stream() };
    }
  }
  const name = ids.length === 1 ? `${entries[0].path}.zip` : "Rechnungen.zip";
  return new Response(downloadZip(files()).body, { headers: { "Content-Type": "application/zip", "Content-Disposition": attachment(name) } });
}

/** The PDF or XML itself, for the viewer. */
export function inlineResponse({ name, size, object }: Awaited<ReturnType<typeof content>>): Response {
  return new Response(object.stream(), {
    headers: {
      "Content-Type": /\.pdf$/i.test(name) ? "application/pdf" : "application/xml",
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    },
  });
}
