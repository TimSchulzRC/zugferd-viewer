import { idSchema, route } from "@/server/http";
import { revoke } from "@/server/permissions";

export const DELETE = route<RouteContext<"/api/permissions/[id]">>(async (_request, user, { params }) => {
  await revoke(user.id, idSchema.parse((await params).id));
  return { ok: true };
});
