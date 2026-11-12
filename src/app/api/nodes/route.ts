import { z } from "zod";
import { nameSchema } from "@/lib/nodes";
import { parentSchema, route } from "@/server/http";
import { createFolder, list } from "@/server/nodes";

export const GET = route(async (request) => {
  const parent = new URL(request.url).searchParams.get("parent");
  return list(parentSchema.parse(parent || null));
});

const body = z.object({ parentId: parentSchema, name: nameSchema });

export const POST = route(async (request, user) => {
  const { parentId, name } = body.parse(await request.json());
  return createFolder(parentId, name, user.id);
});
