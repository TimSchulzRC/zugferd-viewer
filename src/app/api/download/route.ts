import { downloadZip } from "client-zip";
import { z } from "zod";
import { attachment, HttpError, idSchema, route } from "@/server/http";
import { content, tree } from "@/server/nodes";
import { getObject } from "@/server/storage";

const idsSchema = z.array(idSchema).min(1).max(1000);

/** One file comes back as it is. Several files or any folder come back as a zip that keeps the folder structure. */
export const GET = route(async (request) => {
  const ids = idsSchema.parse((new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean));
  const entries = await tree(ids);
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
});
