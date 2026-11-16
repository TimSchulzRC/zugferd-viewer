import { connection } from "next/server";
import { z } from "zod";
import { currentUser, ready, type SessionUser } from "./auth";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler<Context> = (request: Request, user: SessionUser, context: Context) => Promise<Response | object>;

function failure(error: unknown): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  // Postgres unique violation on node_sibling_name.
  if ((error as { code?: string }).code === "23505") return Response.json({ error: "Der Name ist in diesem Ordner schon vergeben" }, { status: 409 });
  console.error(error);
  return Response.json({ error: "Das hat nicht geklappt" }, { status: 500 });
}

/** Wraps a route: schema is migrated, the caller is signed in, and errors become JSON the client can show. */
export function route<Context = unknown>(handler: Handler<Context>, options: { admin?: boolean } = {}) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      // Keeps `next build` from running GET routes ahead of time, when there is no configuration yet.
      await connection();
      await ready();
      const user = await currentUser();
      if (!user) throw new HttpError(401, "Nicht angemeldet");
      if (options.admin && user.role !== "admin") throw new HttpError(403, "Nur für Administratoren");
      const result = await handler(request, user, context);
      return result instanceof Response ? result : Response.json(result);
    } catch (error) {
      return failure(error);
    }
  };
}

/** Like route, but for visitors without an account. The handler checks access itself (see shares.ts). */
export function publicRoute<Context = unknown>(handler: (request: Request, context: Context) => Promise<Response | object>) {
  return async (request: Request, context: Context): Promise<Response> => {
    try {
      await connection();
      await ready();
      const result = await handler(request, context);
      return result instanceof Response ? result : Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return failure(error);
    }
  };
}

export const idSchema = z.uuid();
export const parentSchema = z.uuid().nullable();
export const idsSchema = z.array(idSchema).min(1).max(1000);

/** The ?ids=a,b,c list of the download routes. */
export function idsParam(request: Request) {
  return idsSchema.parse((new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(Boolean));
}

/** Content-Disposition with a UTF-8 file name that survives umlauts. */
export function attachment(name: string) {
  return `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
