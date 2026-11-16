import { inlineResponse } from "@/server/download";
import { idSchema, publicRoute } from "@/server/http";
import { access, sharedContent } from "@/server/shares";

export const GET = publicRoute<RouteContext<"/api/s/[token]/nodes/[id]/content">>(async (request, { params }) => {
  const { token, id } = await params;
  return inlineResponse(await sharedContent(await access(token, request), idSchema.parse(id)));
});
