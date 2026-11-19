import { z } from "zod";
import { colleagueSchema, fileSchema, folderSchema, listingSchema, nodeSchema, permissionSchema, shareInfoSchema, shareSchema, type FileDetails } from "./nodes";

/**
 * Full page load on purpose: signing in or out must drop every cached query and re-run the
 * session check, which a client-side route change would keep. It replaces the current entry, so
 * the browser's back button never returns to the sign-in page after signing in.
 */
export function reload(path: string) {
  window.location.replace(path);
}

/** An API error with its HTTP status, so the share page can tell "password needed" from other failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(schema: z.ZodType<T>, url: string, init?: RequestInit, signedIn = true): Promise<T> {
  const response = await fetch(url, init);
  if (signedIn && response.status === 401) {
    reload("/login");
    throw new Error("Nicht angemeldet");
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, json?.error ?? "Das hat nicht geklappt");
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
  shares: (nodeId: string) => request(z.array(shareSchema), `/api/nodes/${nodeId}/shares`),
  createShare: (nodeId: string, options: { email: string; expiresOn?: string | null }) => request(shareSchema, `/api/nodes/${nodeId}/shares`, json("POST", options)),
  updateShare: (id: string, changes: { canUpload: boolean }) => request(shareSchema, `/api/shares/${id}`, json("PATCH", changes)),
  deleteShare: (id: string) => request(ok, `/api/shares/${id}`, { method: "DELETE" }),
  permissions: (nodeId: string) => request(z.array(permissionSchema), `/api/nodes/${nodeId}/permissions`),
  grant: (nodeId: string, input: { userId: string | null; canEdit: boolean }) => request(permissionSchema, `/api/nodes/${nodeId}/permissions`, json("POST", input)),
  revoke: (id: string) => request(ok, `/api/permissions/${id}`, { method: "DELETE" }),
  colleagues: () => request(z.array(colleagueSchema), "/api/users"),
  invite: (email: string) => request(ok, "/api/users/invite", json("POST", { email })),
  upload: (parentId: string | null, file: File) => {
    const body = new FormData();
    body.set("file", file);
    if (parentId) body.set("parentId", parentId);
    return request(nodeSchema, "/api/nodes/upload", { method: "POST", body });
  },
};

/** Starts a browser download: the file itself for one file, a zip for several or for folders. */
export function download(ids: string[], base = "/api") {
  const link = document.createElement("a");
  link.href = `${base}/download?ids=${ids.join(",")}`;
  link.download = "";
  link.click();
}

/** Visitors of a public link use these instead of api; the server limits them to what the link covers. */
export function shareApi(token: string) {
  const base = `/api/s/${encodeURIComponent(token)}`;
  return {
    base,
    info: () => request(shareInfoSchema, base, undefined, false),
    requestCode: () => request(ok, `${base}/code`, { method: "POST" }, false),
    unlock: (code: string) => request(ok, `${base}/unlock`, json("POST", { code }), false),
    list: (parentId: string | null) => request(listingSchema, `${base}/nodes${parentId ? `?parent=${parentId}` : ""}`, undefined, false),
    file: (id: string) => request(fileSchema, `${base}/nodes/${id}`, undefined, false),
    /** Only works when the owner allowed uploads for this link; the server checks. */
    upload: (parentId: string | null, file: File) =>
      request(nodeSchema, `${base}/upload${parentId ? `?parent=${parentId}` : ""}`, { method: "POST", headers: { "X-File-Name": encodeURIComponent(file.name) }, body: file }, false),
  };
}

/** The address of a public link, for copying. Built in the browser, so it matches the host people actually use. */
export function shareUrl(token: string) {
  return `${window.location.origin}/s/${token}`;
}

/** Where the viewer gets a file from: the signed-in API, or a public link. */
export type Source = {
  key: string;
  file: (id: string) => Promise<FileDetails>;
  contentUrl: (id: string) => string;
  download: (ids: string[]) => void;
  /** Only signed-in users can re-run the validator or rename. */
  revalidate?: (id: string) => Promise<FileDetails>;
  rename?: (id: string, name: string) => Promise<unknown>;
};

export const ownSource: Source = {
  key: "own",
  file: api.file,
  contentUrl: (id) => `/api/nodes/${id}/content`,
  download: (ids) => download(ids),
  revalidate: api.revalidate,
  rename: api.rename,
};

export function shareSource(token: string): Source {
  const share = shareApi(token);
  return {
    key: `share:${token}`,
    file: share.file,
    contentUrl: (id) => `${share.base}/nodes/${id}/content`,
    download: (ids) => download(ids, share.base),
  };
}
