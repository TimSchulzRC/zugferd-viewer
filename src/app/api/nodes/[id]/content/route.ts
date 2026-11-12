import { idSchema, route } from "@/server/http";
import { content } from "@/server/nodes";

export const GET = route<RouteContext<"/api/nodes/[id]/content">>(async (_request, _user, { params }) => {
  const { name, size, object } = await content(idSchema.parse((await params).id));
  return new Response(object.stream(), {
    headers: {
      "Content-Type": /\.pdf$/i.test(name) ? "application/pdf" : "application/xml",
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    },
  });
});
