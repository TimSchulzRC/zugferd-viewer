import { z } from "zod";
import { publicRoute } from "@/server/http";
import { unlock } from "@/server/shares";

const body = z.object({ password: z.string().max(200) });

export const POST = publicRoute<RouteContext<"/api/s/[token]/unlock">>(async (request, { params }) => {
  const { password } = body.parse(await request.json());
  const cookie = await unlock((await params).token, password);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
});
