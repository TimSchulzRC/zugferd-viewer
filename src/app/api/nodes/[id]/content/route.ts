import { inlineResponse } from "@/server/download";
import { idSchema, route } from "@/server/http";
import { content } from "@/server/nodes";

export const GET = route<RouteContext<"/api/nodes/[id]/content">>(async (_request, _user, { params }) => inlineResponse(await content(idSchema.parse((await params).id))));
