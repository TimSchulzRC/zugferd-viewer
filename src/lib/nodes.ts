import { z } from "zod";
import { FILE_TYPES } from "./file-type";
import { reportSchema } from "./report";

/** Shapes shared by the API routes and the client. */

/**
 * What the signed-in user may do with a node. The owner does everything, "edit" lets others add,
 * rename, move and delete inside a folder shared with them, "view" lets them look and download.
 */
export const accessSchema = z.enum(["owner", "edit", "view"]);
export type Access = z.infer<typeof accessSchema>;

export const nodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["folder", "file"]),
  name: z.string(),
  size: z.number().nullable(),
  /** What a file is, null for folders. A type this version does not know yet reads as plain text. */
  type: z.enum(FILE_TYPES).catch("text").nullable().default(null),
  /** Only invoices are validated, so every other file has no status. */
  status: z.enum(["einvoice", "valid", "invalid"]).nullable(),
  /** The profile id from the last validation, null for folders and files the validator could not read. */
  profile: z.string().nullable().default(null),
  updatedAt: z.string(),
  /** For the owner: whether this node is shared with colleagues or by a link that has not expired. */
  shared: z.boolean().default(false),
  access: accessSchema.default("view"),
  /** Who owns the node, so a move stays within one person's files. Empty for link visitors. */
  ownerId: z.string().default(""),
  /** The owner's address when that is someone else, shown next to what others shared with you. */
  owner: z.string().nullable().default(null),
});
export type Node = z.infer<typeof nodeSchema>;

const crumb = z.object({ id: z.string(), name: z.string() });
export type Crumb = z.infer<typeof crumb>;

/** access is what the user may do in the listed folder; at the root that is always "owner". */
export const listingSchema = z.object({ path: z.array(crumb), access: accessSchema.default("view"), items: z.array(nodeSchema) });
export type Listing = z.infer<typeof listingSchema>;

export const fileSchema = z.object({ node: nodeSchema, path: z.array(crumb), report: reportSchema.nullable() });
export type FileDetails = z.infer<typeof fileSchema>;

/** A folder the user may move things into. parentId is null for the top of what they can see. */
export const folderSchema = z.object({ id: z.string(), parentId: z.string().nullable(), name: z.string(), ownerId: z.string(), owner: z.string().nullable() });
export type Folder = z.infer<typeof folderSchema>;

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name fehlt")
  .max(200, "Name ist zu lang")
  .refine((name) => !/[/\\]/.test(name) && name !== "." && name !== "..", "Name darf weder / noch \\ enthalten");

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A link for one outside person, as the people inside see it. */
export const shareSchema = z.object({
  id: z.string(),
  token: z.string(),
  /** The only address that receives the access code. */
  email: z.string(),
  /** Last day the link works, YYYY-MM-DD, or null for no end. */
  expiresOn: z.string().nullable(),
  expired: z.boolean(),
  /** The person may upload files into the shared folder. Only folders can allow it. */
  canUpload: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
});
export type Share = z.infer<typeof shareSchema>;

/** What the owner can change on an existing link. */
export const shareUpdateSchema = z.object({ canUpload: z.boolean() });

export const newShareSchema = z.object({
  email: z.email("Das ist keine E-Mail-Adresse").transform((email) => email.trim().toLowerCase()),
  expiresOn: z.iso.date("Kein gültiges Datum").nullable().optional(),
});

/** What a visitor of /s/<token> learns before and after confirming the code. */
export const shareInfoSchema = z.discriminatedUnion("locked", [
  /** The recipient's address, shortened, so they know which mailbox to check. */
  z.object({ locked: z.literal(true), email: z.string() }),
  z.object({
    locked: z.literal(false),
    kind: z.enum(["folder", "file"]),
    name: z.string(),
    rootId: z.string(),
    expiresOn: z.string().nullable(),
    canUpload: z.boolean().default(false),
  }),
]);
export type ShareInfo = z.infer<typeof shareInfoSchema>;

/** A colleague a node is shared with, or everyone (userId null). */
export const permissionSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  email: z.string().nullable(),
  canEdit: z.boolean(),
});
export type Permission = z.infer<typeof permissionSchema>;

export const newPermissionSchema = z.object({ userId: z.string().min(1).nullable(), canEdit: z.boolean() });

/** The other people with an account, to pick from when sharing. */
export const colleagueSchema = z.object({ id: z.string(), email: z.string() });
export type Colleague = z.infer<typeof colleagueSchema>;
