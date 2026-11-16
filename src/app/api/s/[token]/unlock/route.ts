import { z } from "zod";
import { publicRoute } from "@/server/http";
import { unlock } from "@/server/shares";

const body = z.object({ code: z.string().max(20) });

export const POST = publicRoute<RouteContext<"/api/s/[token]/unlock">>(async (request, { params }) => {
  const { code } = body.parse(await request.json());
  const cookie = await unlock((await params).token, code);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
});
