import { z } from "zod";
import { nameSchema } from "@/lib/nodes";
import { idSchema, route } from "@/server/http";
import { details, rename } from "@/server/nodes";

type Context = RouteContext<"/api/nodes/[id]">;

export const GET = route<Context>(async (_request, _user, { params }) => details(idSchema.parse((await params).id)));

const body = z.object({ name: nameSchema });

export const PATCH = route<Context>(async (request, _user, { params }) => {
  const { name } = body.parse(await request.json());
  return rename(idSchema.parse((await params).id), name);
});
