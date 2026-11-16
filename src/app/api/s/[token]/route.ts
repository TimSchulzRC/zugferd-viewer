import { publicRoute } from "@/server/http";
import { info } from "@/server/shares";

export const GET = publicRoute<RouteContext<"/api/s/[token]">>(async (request, { params }) => info((await params).token, request));
