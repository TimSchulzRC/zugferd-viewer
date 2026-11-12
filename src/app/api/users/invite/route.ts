import { z } from "zod";
import { createUser } from "@/server/auth";
import { pool } from "@/server/db";
import { HttpError, route } from "@/server/http";
import { sendInvitation } from "@/server/mail";

const body = z.object({ email: z.email("Das ist keine E-Mail-Adresse").transform((email) => email.toLowerCase()) });

/** Creates the user and mails them. Calling it again for someone who never signed in resends the mail. */
export const POST = route(
  async (request, user) => {
    const { email } = body.parse(await request.json());
    if (!(await createUser(email, "user"))) {
      const { rows } = await pool().query('select "emailVerified" from "user" where email = $1', [email]);
      if (rows[0]?.emailVerified) throw new HttpError(409, "Diese Person ist schon dabei");
    }
    await sendInvitation(email, user.name && user.name !== user.email.split("@")[0] ? user.name : user.email).catch((error) => {
      console.error("Sending the invitation failed", error);
      throw new HttpError(502, "Die Einladung konnte nicht gesendet werden");
    });
    return { ok: true };
  },
  { admin: true },
);
