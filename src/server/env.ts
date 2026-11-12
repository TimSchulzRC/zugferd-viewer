import { z } from "zod";

const schema = z.object({
  APP_URL: z.url().transform((url) => url.replace(/\/$/, "")),
  BETTER_AUTH_SECRET: z.string().min(32),
  ADMIN_EMAIL: z.email().transform((email) => email.toLowerCase()),
  DATABASE_URL: z.string().min(1),
  VALIDATOR_URL: z.string().default("http://localhost:8080"),
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  LETTERMINT_TOKEN: z.string().optional(),
  MAIL_FROM: z.string().default("ZUGFeRD Viewer <noreply@example.com>"),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Read lazily so `next build` works without the runtime configuration. */
export function env(): Env {
  if (cached) return cached;
  // Coolify passes unset variables as empty strings.
  const present = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n  ");
    throw new Error(`Invalid configuration:\n  ${problems}`);
  }
  return (cached = parsed.data);
}

/**
 * Invitations are matched by e-mail address. A multi-tenant app ("common") would accept a token
 * from any Entra tenant, where the address is whatever that tenant's admin typed in. So Microsoft
 * sign-in needs one specific tenant.
 */
export function microsoft() {
  const { MICROSOFT_CLIENT_ID: clientId, MICROSOFT_CLIENT_SECRET: clientSecret, MICROSOFT_TENANT_ID: tenantId } = env();
  if (!clientId || !clientSecret || !tenantId) return null;
  if (["common", "organizations", "consumers"].includes(tenantId)) return null;
  return { clientId, clientSecret, tenantId };
}
