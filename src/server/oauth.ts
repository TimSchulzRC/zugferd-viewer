import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import type { BetterAuthOptions } from "better-auth";
import { connection } from "next/server";
import { pool } from "./db";
import { auth, MCP_SCOPE, mcpUrl, ready } from "./auth";

/*
 * Sign-in for the MCP server: the discovery documents an MCP client reads before it registers, and
 * the check of the access token it then sends. Better Auth is the authorization server (issuer
 * <app>/api/auth), the MCP route is the protected resource.
 */

// The client's own parameter type does not take this app's typed instance, so it gets the plain shape.
type ResourceClientAuth = { options: BetterAuthOptions; $context: Promise<{ baseURL: string }> };
const globals = globalThis as { zugferdResourceClient?: ReturnType<ReturnType<typeof oauthProviderResourceClient<ResourceClientAuth>>["getActions"]> };

function resourceClient() {
  return (globals.zugferdResourceClient ??= oauthProviderResourceClient(auth() as unknown as ResourceClientAuth).getActions());
}

async function prepared() {
  await connection();
  await ready();
}

/** RFC 9728: where the MCP server sends clients to sign in. */
export async function protectedResourceMetadata() {
  await prepared();
  const metadata = await resourceClient().getProtectedResourceMetadata({
    resource: mcpUrl(),
    resource_name: "ZUGFeRD Viewer",
    scopes_supported: [MCP_SCOPE, "offline_access"],
    bearer_methods_supported: ["header"],
  });
  return Response.json(metadata, { headers: { "Cache-Control": "no-store" } });
}

/** RFC 8414 at /.well-known/oauth-authorization-server/api/auth, the path the issuer asks for. */
export async function authServerMetadata(request: Request) {
  await prepared();
  return oauthProviderAuthServerMetadata(auth())(request);
}

type Failure = { statusCode: number; body?: unknown; headers?: HeadersInit };

function isFailure(error: unknown): error is Failure {
  return typeof error === "object" && error !== null && typeof (error as Failure).statusCode === "number";
}

/**
 * The user an MCP request acts for. The token must be an access token this app issued for the MCP
 * server; tokens for anything else, session cookies and ID tokens do not count. Someone removed or
 * locked out in the meantime gets nothing, even with a token that has not expired yet.
 */
export async function mcpUser(request: Request): Promise<{ id: string; email: string } | Response> {
  await prepared();
  let subject: string | undefined;
  try {
    const claims = await resourceClient().verifyAccessTokenRequest(request, { verifyOptions: { audience: mcpUrl(), typ: "at+jwt", requiredClaims: ["sub", "azp"] } });
    subject = claims.sub;
  } catch (error) {
    if (!isFailure(error) || error.statusCode >= 500) throw error;
    return Response.json(error.body ?? { error: "invalid_token" }, { status: error.statusCode, headers: error.headers });
  }
  const { rows } = await pool().query<{ id: string; email: string; banned: boolean | null; banExpires: Date | null }>(
    'select id, email, banned, "banExpires" from "user" where id = $1',
    [subject],
  );
  const user = rows[0];
  const locked = user?.banned && (!user.banExpires || user.banExpires > new Date());
  if (!user || locked) {
    return Response.json(
      { error: "invalid_token", error_description: "Dieses Konto hat keinen Zugang mehr" },
      { status: 401, headers: { "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl()}"` } },
    );
  }
  return { id: user.id, email: user.email };
}

export function resourceMetadataUrl() {
  const url = new URL(mcpUrl());
  return `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`;
}
