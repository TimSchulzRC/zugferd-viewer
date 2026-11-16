import { z } from "zod";
import { reportSchema } from "./report";

/** Shapes shared by the API routes and the client. */

export const nodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  kind: z.enum(["folder", "file"]),
  name: z.string(),
  size: z.number().nullable(),
  status: z.enum(["einvoice", "valid", "invalid"]).nullable(),
  updatedAt: z.string(),
  /** Whether a public link that has not expired points at this node. */
  shared: z.boolean().default(false),
});
export type Node = z.infer<typeof nodeSchema>;

const crumb = z.object({ id: z.string(), name: z.string() });
export type Crumb = z.infer<typeof crumb>;

export const listingSchema = z.object({ path: z.array(crumb), items: z.array(nodeSchema) });
export type Listing = z.infer<typeof listingSchema>;

export const fileSchema = z.object({ node: nodeSchema, path: z.array(crumb), report: reportSchema.nullable() });
export type FileDetails = z.infer<typeof fileSchema>;

export const folderSchema = z.object({ id: z.string(), parentId: z.string().nullable(), name: z.string() });
export type Folder = z.infer<typeof folderSchema>;

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name fehlt")
  .max(200, "Name ist zu lang")
  .refine((name) => !/[/\\]/.test(name) && name !== "." && name !== "..", "Name darf weder / noch \\ enthalten");

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ACCEPTED = /\.(pdf|xml)$/i;

/** A public link as its creator sees it. */
export const shareSchema = z.object({
  id: z.string(),
  token: z.string(),
  hasPassword: z.boolean(),
  /** Last day the link works, YYYY-MM-DD, or null for no end. */
  expiresOn: z.string().nullable(),
  expired: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().nullable(),
});
export type Share = z.infer<typeof shareSchema>;

export const newShareSchema = z.object({
  password: z.string().max(200).optional(),
  expiresOn: z.iso.date("Kein gültiges Datum").nullable().optional(),
});

/** What a visitor of /s/<token> learns before and after entering the password. */
export const shareInfoSchema = z.discriminatedUnion("locked", [
  z.object({ locked: z.literal(true) }),
  z.object({ locked: z.literal(false), kind: z.enum(["folder", "file"]), name: z.string(), rootId: z.string(), expiresOn: z.string().nullable() }),
]);
export type ShareInfo = z.infer<typeof shareInfoSchema>;
