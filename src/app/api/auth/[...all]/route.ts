import { toNextJsHandler } from "better-auth/next-js";
import { auth, ready } from "@/server/auth";

async function handle(request: Request) {
  await ready();
  const handlers = toNextJsHandler(auth());
  return request.method === "GET" ? handlers.GET(request) : handlers.POST(request);
}

export { handle as GET, handle as POST };
