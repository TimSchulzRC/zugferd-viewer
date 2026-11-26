import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { checkOrigin, HttpError } from "@/server/http";
import { mcpServer } from "@/server/mcp";
import { mcpUser } from "@/server/oauth";

/**
 * The MCP endpoint (Streamable HTTP, stateless). Each request carries an OAuth access token of one
 * user and gets a server of its own that acts for that user alone.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await mcpUser(request);
    if (user instanceof Response) return user;
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await mcpServer(user.id, user.email).connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error("MCP request failed", error);
    return Response.json({ error: "Das hat nicht geklappt" }, { status: 500 });
  }
}
