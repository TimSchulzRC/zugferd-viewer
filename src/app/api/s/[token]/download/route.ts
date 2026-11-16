import { downloadResponse } from "@/server/download";
import { idsParam, publicRoute } from "@/server/http";
import { access, sharedTree } from "@/server/shares";

export const GET = publicRoute<RouteContext<"/api/s/[token]/download">>(async (request, { params }) => {
  const share = await access((await params).token, request);
  const ids = idsParam(request);
  return downloadResponse(ids, await sharedTree(share, ids));
});
