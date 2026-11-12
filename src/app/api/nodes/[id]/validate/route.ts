import { idSchema, route } from "@/server/http";
import { revalidate } from "@/server/nodes";

export const POST = route<RouteContext<"/api/nodes/[id]/validate">>(async (_request, _user, { params }) => revalidate(idSchema.parse((await params).id)));
