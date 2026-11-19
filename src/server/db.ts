import { Kysely, PostgresDialect, sql, type Generated } from "kysely";
import { Pool } from "pg";
import type { FileType } from "@/lib/file-type";
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
  /** Null for folders and for files from before other types than invoices could be uploaded. */
  type: FileType | null;
  status: NodeStatus | null;
  report: Report | null;
  created_by: string | null;
  /** Whose files these are. A node belongs to the owner of its top folder; see nodes.ts. */
  owner_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
};

/** Access for other signed-in users: one of them (user_id) or everyone (user_id null). */
type PermissionTable = {
  id: Generated<string>;
  node_id: string;
  user_id: string | null;
  can_edit: boolean;
  created_by: string | null;
  created_at: Generated<Date>;
};

type ShareTable = {
  id: Generated<string>;
  token: string;
  node_id: string;
  email: string;
  expires_on: string | null;
  code_hash: string | null;
  code_sent_at: Date | null;
  code_attempts: Generated<number>;
  created_by: string | null;
  created_at: Generated<Date>;
};

/** Better Auth owns this table; the app only reads from it. */
type UserTable = { id: string; email: string; name: string };

type Database = { node: NodeTable; share: ShareTable; permission: PermissionTable; user: UserTable };

const globals = globalThis as { zugferdPool?: Pool; zugferdDb?: Kysely<Database> };

/** One pool per process. `next dev` reloads modules, so it lives on globalThis. */
export function pool(): Pool {
  return (globals.zugferdPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 }));
}

export function db(): Kysely<Database> {
  return (globals.zugferdDb ??= new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool() }) }));
}

/**
 * Creates the app's own tables. Better Auth's tables must exist first because node references "user",
 * and so must the administrator: nodes from before owners existed are given to them if nobody else fits.
 */
export async function migrateAppTables(adminEmail: string) {
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
  await sql`create index if not exists node_parent on node (parent_id)`.execute(db());
  await sql`alter table node add column if not exists type text`.execute(db());
  // Links to a folder or file for one outside person, who proves with a mailed code that the link
  // reached them. Deleting the node deletes its links.
  await sql`
    create table if not exists share (
      id uuid primary key default gen_random_uuid(),
      token text not null unique,
      node_id uuid not null references node(id) on delete cascade,
      email text not null,
      expires_on date,
      code_hash text,
      code_sent_at timestamptz,
      code_attempts integer not null default 0,
      created_by text references "user"(id) on delete set null,
      created_at timestamptz not null default now()
    )
  `.execute(db());
  await sql`create index if not exists share_node on share (node_id)`.execute(db());
  await migrateOwners(adminEmail);
}

/**
 * Every node has an owner, and only the owner and the people they share with see it. Before this,
 * everyone saw everything. Existing top folders go to whoever created them (the administrator if
 * that person is gone) and stay shared with everyone for editing, so nobody loses access by the
 * update. Owners remove that share when they want their folder to themselves.
 */
async function migrateOwners(adminEmail: string) {
  await sql`alter table node add column if not exists owner_id text references "user"(id) on delete restrict`.execute(db());
  await sql`
    create table if not exists permission (
      id uuid primary key default gen_random_uuid(),
      node_id uuid not null references node(id) on delete cascade,
      user_id text references "user"(id) on delete cascade,
      can_edit boolean not null default false,
      created_by text references "user"(id) on delete set null,
      created_at timestamptz not null default now()
    )
  `.execute(db());
  // One entry per node and person; user_id null (everyone) counts as a person of its own.
  await sql`create unique index if not exists permission_node_user on permission (node_id, coalesce(user_id, ''))`.execute(db());
  await sql`create index if not exists permission_user on permission (user_id)`.execute(db());

  await db()
    .transaction()
    .execute(async (trx) => {
      const { rows } = await sql<{ id: string }>`select id from node where owner_id is null and parent_id is null for update`.execute(trx);
      if (rows.length) {
        await sql`
          with recursive admin as (select id from "user" where email = ${adminEmail}),
          tree as (
            select id, coalesce(created_by, (select id from admin)) as owner from node where parent_id is null and owner_id is null
            union all
            select n.id, tree.owner from node n join tree on n.parent_id = tree.id
          ) cycle id set is_cycle using visited
          update node set owner_id = tree.owner from tree where node.id = tree.id and not tree.is_cycle
        `.execute(trx);
        await sql`
          insert into permission (node_id, user_id, can_edit)
          select id, null, true from node where id = any(${rows.map((row) => row.id)}::uuid[])
          on conflict do nothing
        `.execute(trx);
      }
      // Whatever no top folder reaches (only possible through a cycle) goes to the administrator.
      await sql`update node set owner_id = (select id from "user" where email = ${adminEmail}) where owner_id is null`.execute(trx);
    });
  await sql`alter table node alter column owner_id set not null`.execute(db());
  await sql`create index if not exists node_owner on node (owner_id)`.execute(db());

  // Names are unique per folder, ignoring case, so downloads unpack cleanly on every OS. Top folders
  // are per owner, so two people may each have a folder "2025". This replaces node_sibling_name.
  await sql`drop index if exists node_sibling_name`.execute(db());
  await sql`
    create unique index if not exists node_sibling_name_per_owner
      on node (coalesce(parent_id::text, 'owner:' || owner_id), lower(name))
  `.execute(db());
}
