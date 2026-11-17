import { downloadResponse } from "@/server/download";
import { idsParam, route } from "@/server/http";
import { treeFor } from "@/server/nodes";

export const GET = route(async (request, user) => {
  const ids = idsParam(request);
  return downloadResponse(ids, await treeFor(user.id, ids));
});
