import { publicRoute } from "@/server/http";
import { requestCode } from "@/server/shares";

export const POST = publicRoute<RouteContext<"/api/s/[token]/code">>(async (_request, { params }) => {
  await requestCode((await params).token);
  return { ok: true };
});
