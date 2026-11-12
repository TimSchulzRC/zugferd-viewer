import { z } from "zod";

/** "s3.example.com" is what people paste, so a missing scheme means https. */
const endpoint = z
  .string()
  .min(1)
  .transform((value) => (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, ""))
  .pipe(z.url());

const url = z.url().transform((value) => value.replace(/\/$/, ""));

const schema = z
  .object({
    // What the platform reports as the app's address. With several domains Coolify reports the
    // first one, which need not be the one people use, so PUBLIC_URL can name the real one.
    APP_URL: url,
    PUBLIC_URL: url.optional(),
    BETTER_AUTH_SECRET: z.string().min(32),
    ADMIN_EMAIL: z.email().transform((email) => email.toLowerCase()),
    DATABASE_URL: z.string().min(1),
    VALIDATOR_URL: z.string().default("http://localhost:8080"),
    S3_ENDPOINT: endpoint,
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_REGION: z.string().optional(),
    LETTERMINT_TOKEN: z.string().optional(),
    MAIL_FROM: z.string().default("ZUGFeRD Viewer <noreply@example.com>"),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT_ID: z.string().optional(),
  })
  .transform(({ PUBLIC_URL, ...rest }) => ({
    ...rest,
    APP_URL: PUBLIC_URL ?? rest.APP_URL,
    // Hetzner names the region in the host (fsn1.your-objectstorage.com). Elsewhere the S3 default works.
    S3_REGION: rest.S3_REGION ?? new URL(rest.S3_ENDPOINT).hostname.match(/^([a-z0-9]+)\.your-objectstorage\.com$/)?.[1] ?? "us-east-1",
  }));

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Read lazily so `next build` works without the runtime configuration. */
export function env(): Env {
  if (cached) return cached;
  // Coolify passes unset variables as empty strings.
  const present = Object.fromEntries(Object.entries(process.env).flatMap(([key, value]) => (value?.trim() ? [[key, value.trim()]] : [])));
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
