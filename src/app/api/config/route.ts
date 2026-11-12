import { connection } from "next/server";
import { microsoft } from "@/server/env";

/** What the sign-in page needs to know before anyone is signed in. */
export async function GET() {
  // Answer per request. Otherwise `next build` runs this once, without the runtime configuration.
  await connection();
  return Response.json({ microsoft: microsoft() !== null });
}
