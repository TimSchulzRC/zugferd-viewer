import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decodeText, FILE_TYPE_LABELS, FILE_TYPES, isPdf } from "@/lib/file-type";
import type { Crumb, Node } from "@/lib/nodes";
import { describeProfile, formatOf, offersXRechnung, reportFor, RULESETS } from "@/lib/report";
import { HttpError } from "./http";
import { contentFor, fileFor, findFor, list } from "./nodes";
import { embeddedXml } from "./pdf";

/*
 * The MCP server for Claude Code and other MCP clients. It only reads, and every tool goes through
 * the same access checks as the app's own API with the id of the signed-in user, so a client sees
 * exactly what that person sees in the app and nothing more. See app/api/mcp/route.ts for sign-in.
 */

const STATUS_TEXT: Record<NonNullable<Node["status"]>, string> = {
  einvoice: "valid e-invoice (EN 16931 profile, counts as an e-invoice under § 14 UStG)",
  valid: "valid, but the profile is no full EN 16931 invoice (MINIMUM, BASIC WL, ZUGFeRD 1/2.0)",
  invalid: "invalid: the validator reported errors",
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const MAX_CHARS = 200_000;

function pathText(path: Crumb[]) {
  return path.length ? path.map((crumb) => crumb.name).join(" / ") : "(top level)";
}

/** A node in the shape the tools return: what it is, its check result, and what the user may do. */
function describe(node: Node) {
  const file = node.kind === "file";
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    ...(file && {
      type: node.type,
      format: node.type === "invoice" ? (formatOf(node.profile) ?? describeProfile(node.profile)?.name ?? null) : FILE_TYPE_LABELS[node.type as keyof typeof FILE_TYPE_LABELS],
      status: node.status,
      statusText: node.status ? STATUS_TEXT[node.status] : node.type === "invoice" ? "not checked (the validator could not read it or was unavailable)" : "not an invoice, not checked",
      size: node.size,
    }),
    updatedAt: node.updatedAt,
    access: node.access,
    owner: node.owner ?? "you",
  };
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Access errors read as the app shows them ("Nicht gefunden"); anything else stays in the server log. */
function tool<Args>(run: (args: Args) => Promise<unknown>) {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      return json(await run(args));
    } catch (error) {
      if (error instanceof HttpError) return { isError: true, content: [{ type: "text", text: error.message }] };
      console.error("MCP tool failed", error);
      return { isError: true, content: [{ type: "text", text: "Das hat nicht geklappt" }] };
    }
  };
}

const id = z.uuid();

export function mcpServer(userId: string, email: string) {
  const server = new McpServer(
    { name: "zugferd-viewer", version: "1.0.0" },
    {
      instructions: `Read-only access to the files of ${email} in ZUGFeRD Viewer: e-invoices (ZUGFeRD/Factur-X PDFs, XRechnung and other CII or UBL XML), IDocs, EDIFACT, CSV, JSON and text files, with the stored result of the Mustang validator for each invoice. You see exactly what this person sees in the app: their own folders and what others shared with them. Nothing can be changed here. Start with list_folder or find_files, then get_file for the validation report and read_file for the content.`,
    },
  );

  server.registerTool(
    "list_folder",
    {
      title: "List a folder",
      description:
        "Lists a folder's folders and files with their type, format (ZUGFeRD, XRechnung, IDoc, …) and validation status. Without folderId it lists the top level: the user's own folders and files plus what others shared with them.",
      inputSchema: { folderId: id.optional().describe("Folder id from an earlier result; omit for the top level") },
      annotations: READ_ONLY,
    },
    tool(async ({ folderId }: { folderId?: string }) => {
      const listing = await list(userId, folderId ?? null);
      return { path: pathText(listing.path), access: listing.access, items: listing.items.map(describe) };
    }),
  );

  server.registerTool(
    "find_files",
    {
      title: "Find files",
      description:
        "Finds files across everything the user can see (or below one folder), newest first. Filter by part of the name, validation status or file type. status 'unchecked' finds invoices without a validation result.",
      inputSchema: {
        name: z.string().max(200).optional().describe("Part of the file name, case does not matter"),
        status: z.enum(["einvoice", "valid", "invalid", "unchecked"]).optional(),
        type: z.enum(FILE_TYPES).optional().describe("invoice covers every PDF and every CII or UBL invoice XML"),
        folderId: id.optional().describe("Only search below this folder"),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: READ_ONLY,
    },
    tool(async (filter: Parameters<typeof findFor>[1]) => {
      const found = await findFor(userId, filter);
      return found.map(({ node, path }) => ({ ...describe(node), folder: pathText(path), folderId: node.parentId }));
    }),
  );

  server.registerTool(
    "get_file",
    {
      title: "Get a file and its validation report",
      description:
        "Returns a file's details and the stored Mustang validation report: overall result, PDF/A and XML result, the profile, and every finding with severity, rule id (e.g. BR-DE-15), message, XPath location and the business terms (BT-…) it concerns. ruleset 'xrechnung' reads the report as an XRechnung check (only offered for BASIC and EN 16931 profiles, like in the app).",
      inputSchema: { fileId: id, ruleset: z.enum(RULESETS).default("zugferd") },
      annotations: READ_ONLY,
    },
    tool(async ({ fileId, ruleset }: { fileId: string; ruleset: (typeof RULESETS)[number] }) => {
      const { node, path, report } = await fileFor(userId, fileId);
      const choosable = offersXRechnung(report);
      return {
        file: describe(node),
        folder: pathText(path),
        folderId: node.parentId,
        validation: report && {
          ruleset: choosable ? ruleset : "zugferd",
          xrechnungRulesetAvailable: choosable,
          profileName: describeProfile(report.profile)?.name ?? null,
          ...reportFor(report, choosable ? ruleset : "zugferd"),
        },
      };
    }),
  );

  server.registerTool(
    "read_file",
    {
      title: "Read a file's content",
      description:
        "Returns the text of a file. For a PDF it returns the invoice XML embedded in it (factur-x.xml, zugferd-invoice.xml, …), since the PDF itself is binary. Long files come in parts: pass offset to read on.",
      inputSchema: {
        fileId: id,
        offset: z.number().int().min(0).default(0).describe("Character to start at"),
        maxChars: z.number().int().min(1).max(MAX_CHARS).default(50_000),
      },
      annotations: READ_ONLY,
    },
    tool(async ({ fileId, offset, maxChars }: { fileId: string; offset: number; maxChars: number }) => {
      const { name, object } = await contentFor(userId, fileId);
      const bytes = await object.bytes();
      let text: string;
      let source: string;
      if (isPdf(bytes)) {
        const embedded = await embeddedXml(bytes).catch((error) => {
          console.error(`Reading the attachments of ${name} failed`, error);
          throw new HttpError(422, "Die PDF ließ sich nicht lesen");
        });
        if (!embedded) return { name, note: "PDF without an embedded invoice XML, so there is no text to return." };
        text = embedded.xml;
        source = `XML embedded in the PDF as ${embedded.name}`;
      } else {
        const decoded = decodeText(bytes);
        if (decoded === null) return { name, note: "Binary file without readable text." };
        text = decoded;
        source = "file content";
      }
      const part = text.slice(offset, offset + maxChars);
      const end = offset + part.length;
      return { name, source, totalChars: text.length, offset, ...(end < text.length && { nextOffset: end }), text: part };
    }),
  );

  return server;
}
