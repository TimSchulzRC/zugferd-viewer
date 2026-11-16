import { newShareSchema } from "@/lib/nodes";
import { idSchema, route } from "@/server/http";
import { createShare, sharesOf } from "@/server/shares";

type Context = RouteContext<"/api/nodes/[id]/shares">;

export const GET = route<Context>(async (_request, _user, { params }) => sharesOf(idSchema.parse((await params).id)));

export const POST = route<Context>(async (request, user, { params }) => {
  const options = newShareSchema.parse(await request.json());
  return createShare(idSchema.parse((await params).id), options, user);
});
