import { idSchema, publicRoute } from "@/server/http";
import { access, sharedDetails } from "@/server/shares";

export const GET = publicRoute<RouteContext<"/api/s/[token]/nodes/[id]">>(async (request, { params }) => {
  const { token, id } = await params;
  return sharedDetails(await access(token, request), idSchema.parse(id));
});
