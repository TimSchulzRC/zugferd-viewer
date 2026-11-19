import { MAX_FILE_BYTES } from "@/lib/nodes";
import { HttpError, parentSchema, publicRoute } from "@/server/http";
import { access, inTurn, sharedUpload } from "@/server/shares";

/**
 * The file is the raw body, its name the X-File-Name header (URI-encoded), the target folder ?parent=.
 * No multipart: visitors have no account, and a body is never read before its length is known to fit
 * one file. A multipart parser could build far more in memory than the body's size.
 */
export const POST = publicRoute<RouteContext<"/api/s/[token]/upload">>(async (request, { params }) => {
  const share = await access((await params).token, request);
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) throw new HttpError(411, "Länge der Anfrage fehlt");
  if (Number(declared) > MAX_FILE_BYTES) throw new HttpError(413, "Datei ist größer als 50 MB");
  let name: string;
  try {
    name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    throw new HttpError(400, "Ungültiger Dateiname");
  }
  if (!name) throw new HttpError(400, "Keine Datei");
  const parentId = parentSchema.parse(new URL(request.url).searchParams.get("parent") || null);
  return inTurn(share, async () => sharedUpload(share, parentId, new File([await request.arrayBuffer()], name)));
});
