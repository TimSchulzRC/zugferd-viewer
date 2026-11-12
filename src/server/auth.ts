import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { admin, emailOTP } from "better-auth/plugins";
import { headers } from "next/headers";
import { migrateAppTables, pool } from "./db";
import { env, microsoft } from "./env";
import { sendLoginCode } from "./mail";

function create() {
  const { APP_URL, BETTER_AUTH_SECRET } = env();
  const ms = microsoft();
  return betterAuth({
    baseURL: APP_URL,
    secret: BETTER_AUTH_SECRET,
    database: pool(),
    // Nobody signs up on their own. An admin invites, which creates the user (see inviteUser).
    socialProviders: ms ? { microsoft: { ...ms, prompt: "select_account", disableSignUp: true } } : {},
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["microsoft"],
        // Invited users have not verified their address yet when they first arrive via Microsoft.
        // Safe here because only admins create users, so nobody can pre-register someone else's address.
        requireLocalEmailVerified: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A user who has signed in once is no longer shown as "invited".
          after: async (session) => {
            await pool().query('update "user" set "emailVerified" = true where id = $1 and "emailVerified" = false', [session.userId]);
          },
        },
      },
    },
    plugins: [
      emailOTP({
        disableSignUp: true,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return;
          // Not awaited: the response time must not reveal whether the address exists.
          sendLoginCode(email, otp).catch((error) => console.error("Sending the login code failed", error));
        },
      }),
      admin(),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof create>;
const globals = globalThis as { zugferdAuth?: Auth; zugferdReady?: Promise<void> };

export function auth(): Auth {
  return (globals.zugferdAuth ??= create());
}

export type SessionUser = Auth["$Infer"]["Session"]["user"];

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

/** Creates the user an invitation or ADMIN_EMAIL refers to. Returns false if the address is already known. */
export async function createUser(email: string, role: "admin" | "user"): Promise<boolean> {
  const context = await auth().$context;
  if (await context.internalAdapter.findUserByEmail(email)) return false;
  await context.internalAdapter.createUser({ email, name: email.split("@")[0], emailVerified: false, role }, { method: "admin" });
  return true;
}

/** Brings the schema up to date and makes sure the first administrator exists. Runs once per process. */
export function ready(): Promise<void> {
  return (globals.zugferdReady ??= (async () => {
    const { runMigrations } = await getMigrations(auth().options);
    await runMigrations();
    await migrateAppTables();
    const { ADMIN_EMAIL } = env();
    await createUser(ADMIN_EMAIL, "admin");
    await pool().query(`update "user" set role = 'admin' where email = $1 and role is distinct from 'admin'`, [ADMIN_EMAIL]);
  })());
}
