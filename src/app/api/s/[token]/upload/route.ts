import { MAX_FILE_BYTES } from "@/lib/nodes";
import { HttpError, parentSchema, publicRoute } from "@/server/http";
import { access, sharedUpload } from "@/server/shares";

/** Room for the multipart framing around one file. */
const FORM_OVERHEAD = 64 * 1024;

export const POST = publicRoute<RouteContext<"/api/s/[token]/upload">>(async (request, { params }) => {
  const share = await access((await params).token, request);
  // Visitors have no account, so the body is not read before its size is known to fit one file.
  const length = Number(request.headers.get("content-length"));
  if (!length) throw new HttpError(411, "Länge der Anfrage fehlt");
  if (length > MAX_FILE_BYTES + FORM_OVERHEAD) throw new HttpError(413, "Datei ist größer als 50 MB");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Keine Datei");
  return sharedUpload(share, parentSchema.parse(form.get("parentId") || null), file);
});
