import { z } from "zod";
import { nameSchema } from "@/lib/nodes";
import { idSchema, route } from "@/server/http";
import { fileFor, rename } from "@/server/nodes";

type Context = RouteContext<"/api/nodes/[id]">;

export const GET = route<Context>(async (_request, user, { params }) => fileFor(user.id, idSchema.parse((await params).id)));

const body = z.object({ name: nameSchema });

export const PATCH = route<Context>(async (request, user, { params }) => {
  const { name } = body.parse(await request.json());
  return rename(user.id, idSchema.parse((await params).id), name);
});
