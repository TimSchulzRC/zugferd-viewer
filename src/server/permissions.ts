import type { Colleague, Permission } from "@/lib/nodes";
import { db } from "./db";
import { HttpError } from "./http";
import { requireAccess } from "./nodes";

/*
 * Sharing inside the app: the owner of a folder or file gives everyone, or chosen people with an
 * account, access to view or to edit it. Links for people outside are in shares.ts.
 */

function permissions() {
  return db()
    .selectFrom("permission")
    .leftJoin("user", "user.id", "permission.user_id")
    .select(["permission.id", "permission.user_id", "permission.can_edit", "user.email"]);
}

type Row = { id: string; user_id: string | null; can_edit: boolean; email: string | null };

function toPermission(row: Row): Permission {
  return { id: row.id, userId: row.user_id, email: row.email, canEdit: row.can_edit };
}

export async function permissionsOf(userId: string, nodeId: string): Promise<Permission[]> {
  await requireAccess(userId, nodeId, "owner");
  // Everyone first, then people by address.
  const rows = await permissions().where("permission.node_id", "=", nodeId).orderBy("permission.user_id", (order) => order.nullsFirst()).orderBy("user.email").execute();
  return rows.map(toPermission);
}

/** Shares a node with one person or everyone (userId null). Sharing again with the same person changes the level. */
export async function grant(userId: string, nodeId: string, input: { userId: string | null; canEdit: boolean }): Promise<Permission> {
  await requireAccess(userId, nodeId, "owner");
  if (input.userId === userId) throw new HttpError(400, "Das gehört dir schon");
  if (input.userId && !(await db().selectFrom("user").select("id").where("id", "=", input.userId).executeTakeFirst())) throw new HttpError(404, "Diese Person gibt es nicht");
  const existing = await db()
    .selectFrom("permission")
    .select("id")
    .where("node_id", "=", nodeId)
    .where("user_id", input.userId === null ? "is" : "=", input.userId)
    .executeTakeFirst();
  const { id } = existing
    ? await db().updateTable("permission").set({ can_edit: input.canEdit }).where("id", "=", existing.id).returning("id").executeTakeFirstOrThrow()
    : await db()
        .insertInto("permission")
        .values({ node_id: nodeId, user_id: input.userId, can_edit: input.canEdit, created_by: userId })
        .returning("id")
        .executeTakeFirstOrThrow();
  return toPermission(await permissions().where("permission.id", "=", id).executeTakeFirstOrThrow());
}

export async function revoke(userId: string, id: string) {
  const row = await db().selectFrom("permission").select("node_id").where("id", "=", id).executeTakeFirst();
  if (!row) throw new HttpError(404, "Nicht gefunden");
  await requireAccess(userId, row.node_id, "owner");
  await db().deleteFrom("permission").where("id", "=", id).execute();
}

/** Everyone else with an account, to share with. */
export async function colleagues(userId: string): Promise<Colleague[]> {
  return db().selectFrom("user").select(["id", "email"]).where("id", "<>", userId).orderBy("email").execute();
}
