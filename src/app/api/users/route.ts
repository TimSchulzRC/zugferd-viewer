import { route } from "@/server/http";
import { colleagues } from "@/server/permissions";

export const GET = route(async (_request, user) => colleagues(user.id));
