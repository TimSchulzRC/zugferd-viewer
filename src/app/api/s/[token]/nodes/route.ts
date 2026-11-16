import { parentSchema, publicRoute } from "@/server/http";
import { access, sharedList } from "@/server/shares";

export const GET = publicRoute<RouteContext<"/api/s/[token]/nodes">>(async (request, { params }) => {
  const share = await access((await params).token, request);
  return sharedList(share, parentSchema.parse(new URL(request.url).searchParams.get("parent") || null));
});
