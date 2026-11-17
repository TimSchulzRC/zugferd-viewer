import { inlineResponse } from "@/server/download";
import { idSchema, route } from "@/server/http";
import { contentFor } from "@/server/nodes";

export const GET = route<RouteContext<"/api/nodes/[id]/content">>(async (_request, user, { params }) => inlineResponse(await contentFor(user.id, idSchema.parse((await params).id))));
