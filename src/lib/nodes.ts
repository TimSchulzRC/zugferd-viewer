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
