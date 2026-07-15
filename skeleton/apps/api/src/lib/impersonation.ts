/**
 * Impersonation Seam (ADR-0006, ADR-0010)
 *
 * Allows authorized admins to impersonate another user for troubleshooting/auditing.
 * Requires explicit `user:impersonate` permission (enforced at call time).
 * Writes an audit row BEFORE switching identity (required by ADR-0010).
 *
 * Returns a new context variant with:
 * - user.id, user.roles set to target user
 * - impersonatedBy field added to context for logging/audit downstream
 *
 * Usage:
 *   app.post("/impersonate/:userId", async (ctx) => {
 *     const newCtx = await impersonate(ctx, targetUserId);
 *     // Now newCtx.user.id is targetUserId, newCtx.impersonatedBy = original user
 *     return ctx.json({ ok: true });
 *   });
 */

import { ForbiddenError } from "@kongmy-stack/core";
import type { AppBindings } from "../main.js";
import { generateId } from "@kongmy-stack/db";

export type ImpersonationContext = AppBindings["Variables"] & {
  impersonatedBy: {
    userId: string;
    userRoles: string[];
  };
};

/**
 * Impersonate another user, with audit trail.
 *
 * @param ctx Current request context (must have user and authz)
 * @param targetUserId User ID to impersonate
 * @returns New context with user swapped + impersonatedBy field
 * @throws ForbiddenError if user lacks user:impersonate permission
 * @throws Error if audit write fails
 */
export async function impersonate(
  ctx: AppBindings["Variables"],
  targetUserId: string
): Promise<ImpersonationContext> {
  // Check permission
  if (!ctx.authz.can("user:impersonate")) {
    throw new ForbiddenError("Permission denied: user:impersonate");
  }

  // Write audit BEFORE switching identity (ADR-0010)
  const auditId = generateId("audit");
  const rawDb = (ctx.db as { rawDb?: { query: (sql: string, params: unknown[]) => Promise<unknown> } }).rawDb;
  if (!rawDb) throw new Error("impersonation audit write requires rawDb executor");

  await (rawDb as any).query(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      auditId,
      ctx.tenant.orgId,
      ctx.user.id, // Original user performing the impersonation
      "user:impersonate",
      "user",
      targetUserId,
      "auto",
      new Date().toISOString(),
      JSON.stringify({ targetUserId }),
    ]
  );

  // Create new context with swapped user
  const newCtx = {
    ...ctx,
    user: {
      id: targetUserId,
      roles: [], // In a real impl, fetch target user's roles from db
    },
    impersonatedBy: {
      userId: ctx.user.id,
      userRoles: ctx.user.roles,
    },
  } as ImpersonationContext;

  return newCtx;
}
