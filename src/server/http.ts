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
      if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
      // Postgres unique violation on node_sibling_name.
      if ((error as { code?: string }).code === "23505") return Response.json({ error: "Der Name ist in diesem Ordner schon vergeben" }, { status: 409 });
      console.error(error);
      return Response.json({ error: "Das hat nicht geklappt" }, { status: 500 });
    }
  };
}

export const idSchema = z.uuid();
export const parentSchema = z.uuid().nullable();

/** Content-Disposition with a UTF-8 file name that survives umlauts. */
export function attachment(name: string) {
  return `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
