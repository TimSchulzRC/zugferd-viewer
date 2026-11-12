import { z } from "zod";
import { idSchema, parentSchema, route } from "@/server/http";
import { move, remove } from "@/server/nodes";

const ids = z.array(idSchema).min(1).max(1000);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), ids, parentId: parentSchema }),
  z.object({ action: z.literal("delete"), ids }),
]);

export const POST = route(async (request) => {
  const input = body.parse(await request.json());
  if (input.action === "move") await move(input.ids, input.parentId);
  else await remove(input.ids);
  return { ok: true };
});
