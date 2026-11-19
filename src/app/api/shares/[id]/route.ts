import { shareUpdateSchema } from "@/lib/nodes";
import { idSchema, route } from "@/server/http";
import { deleteShare, updateShare } from "@/server/shares";

type Context = RouteContext<"/api/shares/[id]">;

export const PATCH = route<Context>(async (request, user, { params }) => updateShare(user.id, idSchema.parse((await params).id), shareUpdateSchema.parse(await request.json())));

export const DELETE = route<Context>(async (_request, user, { params }) => {
  await deleteShare(user.id, idSchema.parse((await params).id));
  return { ok: true };
});
