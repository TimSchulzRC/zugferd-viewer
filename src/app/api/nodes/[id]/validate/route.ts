import { idSchema, route } from "@/server/http";
import { revalidate } from "@/server/nodes";

export const POST = route<RouteContext<"/api/nodes/[id]/validate">>(async (_request, user, { params }) => revalidate(user.id, idSchema.parse((await params).id)));
