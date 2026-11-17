import { idSchema, route } from "@/server/http";
import { deleteShare } from "@/server/shares";

export const DELETE = route<RouteContext<"/api/shares/[id]">>(async (_request, user, { params }) => {
  await deleteShare(user.id, idSchema.parse((await params).id));
  return { ok: true };
});
