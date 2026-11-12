import { z } from "zod";
import { fileSchema, folderSchema, listingSchema, nodeSchema } from "./nodes";

/**
 * Full page load on purpose: signing in or out must drop every cached query and re-run the
 * session check, which a client-side route change would keep.
 */
export function reload(path: string) {
  window.location.href = path;
}

async function request<T>(schema: z.ZodType<T>, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 401) {
    reload("/login");
    throw new Error("Nicht angemeldet");
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error ?? "Das hat nicht geklappt");
  return schema.parse(json);
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const ok = z.object({ ok: z.literal(true) });

export const api = {
  list: (parentId: string | null) => request(listingSchema, `/api/nodes${parentId ? `?parent=${parentId}` : ""}`),
  folders: () => request(z.array(folderSchema), "/api/folders"),
  file: (id: string) => request(fileSchema, `/api/nodes/${id}`),
  createFolder: (parentId: string | null, name: string) => request(nodeSchema, "/api/nodes", json("POST", { parentId, name })),
  rename: (id: string, name: string) => request(nodeSchema, `/api/nodes/${id}`, json("PATCH", { name })),
  move: (ids: string[], parentId: string | null) => request(ok, "/api/nodes/bulk", json("POST", { action: "move", ids, parentId })),
  remove: (ids: string[]) => request(ok, "/api/nodes/bulk", json("POST", { action: "delete", ids })),
  revalidate: (id: string) => request(fileSchema, `/api/nodes/${id}/validate`, { method: "POST" }),
  invite: (email: string) => request(ok, "/api/users/invite", json("POST", { email })),
  upload: (parentId: string | null, file: File) => {
    const body = new FormData();
    body.set("file", file);
    if (parentId) body.set("parentId", parentId);
    return request(nodeSchema, "/api/nodes/upload", { method: "POST", body });
  },
};

/** Starts a browser download: the file itself for one file, a zip for several or for folders. */
export function download(ids: string[]) {
  const link = document.createElement("a");
  link.href = `/api/download?ids=${ids.join(",")}`;
  link.download = "";
  link.click();
}
