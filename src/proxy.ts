import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends visitors without a session cookie to the sign-in page. This only looks at whether the
 * cookie exists; every API route checks the session itself, so a forged cookie gets no data.
 * Public links (/s/<token>) are open to everyone; their API checks the link instead. MCP clients
 * read the OAuth discovery documents under /.well-known before anyone has signed in.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!api|login|s/|\\.well-known|_next|favicon.ico|icon.svg|apple-icon.png).*)"],
};
