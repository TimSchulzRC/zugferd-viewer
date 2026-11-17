import { HttpError, parentSchema, route } from "@/server/http";
import { upload } from "@/server/nodes";

export const POST = route(async (request, user) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Keine Datei");
  return upload(user.id, parentSchema.parse(form.get("parentId") || null), file);
});
