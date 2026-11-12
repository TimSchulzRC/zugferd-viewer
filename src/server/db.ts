import { Kysely, PostgresDialect, sql, type Generated } from "kysely";
import { Pool } from "pg";
import type { Report } from "@/lib/report";
import { env } from "./env";

export type NodeStatus = "einvoice" | "valid" | "invalid";

type NodeTable = {
  id: Generated<string>;
  parent_id: string | null;
  kind: "folder" | "file";
  name: string;
  size: number | null;
  storage_key: string | null;
  status: NodeStatus | null;
  report: Report | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
};

type Database = { node: NodeTable };

const globals = globalThis as { zugferdPool?: Pool; zugferdDb?: Kysely<Database> };

/** One pool per process. `next dev` reloads modules, so it lives on globalThis. */
export function pool(): Pool {
  return (globals.zugferdPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 }));
}

export function db(): Kysely<Database> {
  return (globals.zugferdDb ??= new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool() }) }));
}

/** Creates the app's own tables. Better Auth's tables must exist first because node references "user". */
export async function migrateAppTables() {
  await sql`
    create table if not exists node (
      id uuid primary key default gen_random_uuid(),
      parent_id uuid references node(id) on delete cascade,
      kind text not null check (kind in ('folder', 'file')),
      name text not null check (name <> ''),
      size bigint,
      storage_key text,
      status text,
      report jsonb,
      created_by text references "user"(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db());
  // Names are unique per folder, ignoring case, so downloads unpack cleanly on every OS.
  await sql`
    create unique index if not exists node_sibling_name
      on node (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  `.execute(db());
  await sql`create index if not exists node_parent on node (parent_id)`.execute(db());
}
