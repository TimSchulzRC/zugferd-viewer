import { newPermissionSchema } from "@/lib/nodes";
import { idSchema, route } from "@/server/http";
import { grant, permissionsOf } from "@/server/permissions";

type Context = RouteContext<"/api/nodes/[id]/permissions">;

export const GET = route<Context>(async (_request, user, { params }) => permissionsOf(user.id, idSchema.parse((await params).id)));

export const POST = route<Context>(async (request, user, { params }) => grant(user.id, idSchema.parse((await params).id), newPermissionSchema.parse(await request.json())));
