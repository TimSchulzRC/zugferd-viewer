import { downloadResponse } from "@/server/download";
import { idsParam, route } from "@/server/http";
import { tree } from "@/server/nodes";

export const GET = route(async (request) => {
  const ids = idsParam(request);
  return downloadResponse(ids, await tree(ids));
});
