import { route } from "@/server/http";
import { folders } from "@/server/nodes";

export const GET = route(async () => folders());
