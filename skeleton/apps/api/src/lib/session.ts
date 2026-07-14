/**
 * Session Provider Seam (ADR-0002, ADR-0008)
 *
 * Two adapters:
 * 1. betterAuthProvider: Real BetterAuth with drizzle DB backing
 * 2. headerMockProvider: Header-based mock (x-user-id, x-org-id, x-roles) for tests
 *
 * This seam enables dogfooding real auth during development while keeping
 * existing contract tests green without changes.
 */

import type { Context } from "hono";
import type { DbInstance } from "@kongmy-stack/db";

export interface Session {
  userId: string;
  organizationId: string;
  email: string;
  roles: string[];
  permissions: Set<string>;
}

export interface SessionProvider {
  /**
   * Extract session from the request. Returns null if no active session.
   */
  getSession(ctx: Context): Promise<Session | null>;
}

/**
 * Header-based mock provider for existing tests.
 * Keeps all 13 contract tests green unchanged.
 *
 * Headers:
 * - x-user-id: user ID (defaults to 'user_test')
 * - x-org-id: organization ID (defaults to 'org_test')
 * - x-roles: comma-separated role names (defaults to 'user')
 * - x-anonymous: 'true' signals no session (401)
 *
 * Permission logic: only admin role can do things (mock behavior).
 * In real app, permissions are loaded from db roles/memberships.
 */
export function headerMockProvider(): SessionProvider {
  return {
    async getSession(ctx: Context): Promise<Session | null> {
      // x-anonymous: true signals 401 (no session)
      if (ctx.req.header("x-anonymous") === "true") {
        return null;
      }

      const userId = ctx.req.header("x-user-id") || "user_test";
      const organizationId = ctx.req.header("x-org-id") || "org_test";
      const rolesHeader = ctx.req.header("x-roles") || "user";
      const roles = rolesHeader.split(",").map((r) => r.trim()).filter(Boolean);

      // Mock: admin role gets all permissions, others get none
      const permissions = new Set<string>();
      if (roles.includes("admin")) {
        permissions.add("invoice:read");
        permissions.add("invoice:create");
        permissions.add("invoice:update");
        permissions.add("invoice:delete");
        permissions.add("invoice:post");
        permissions.add("invoice:cancel");
        permissions.add("invoice:send");
      }

      return {
        userId,
        organizationId,
        email: `${userId}@test.example`,
        roles,
        permissions,
      };
    },
  };
}

/**
 * Real BetterAuth provider.
 * Reads session from auth_session cookie + loads permissions from db roles/memberships.
 *
 * Flow:
 * 1. Extract auth_session cookie from request
 * 2. Look up the session in better_auth_session table
 * 3. Get the better-auth user
 * 4. Find our authorization user record (to get organizationId)
 * 5. Load memberships for this user (in the org/branch)
 * 6. Load roles and their permission_ids
 * 7. Return Session with full permission set
 */
export function betterAuthProvider(db: DbInstance): SessionProvider {
  return {
    async getSession(ctx: Context): Promise<Session | null> {
      try {
        // Extract session token from cookie
        const cookieHeader = ctx.req.header("cookie") || "";
        const sessionMatch = cookieHeader.match(/auth_session=([^;]+)/);
        if (!sessionMatch || !sessionMatch[1]) {
          return null;
        }

        const sessionToken = sessionMatch[1];

        // Look up session in database
        const executor = (db as any).rawDb || db;
        const sessionResult = await (executor as any).query(
          `SELECT * FROM better_auth_session WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
          [sessionToken]
        );

        if (!sessionResult.rows || sessionResult.rows.length === 0) {
          return null;
        }

        const sessionRow = sessionResult.rows[0] as any;

        // Get the better-auth user
        const userResult = await (executor as any).query(
          `SELECT * FROM better_auth_user WHERE id = $1 LIMIT 1`,
          [sessionRow.user_id]
        );

        if (!userResult.rows || userResult.rows.length === 0) {
          return null;
        }

        const betterAuthUser = userResult.rows[0] as any;

        // Find our authorization user record by email
        // This links the better-auth user to our org/roles
        const authUserResult = await (executor as any).query(
          `SELECT * FROM users WHERE email = $1 LIMIT 1`,
          [betterAuthUser.email]
        );

        if (!authUserResult.rows || authUserResult.rows.length === 0) {
          // No authorization user record found; user is authenticated but not provisioned
          return null;
        }

        const authUser = authUserResult.rows[0] as any;

        // Load memberships for this user in their org
        const membershipResult = await (executor as any).query(
          `SELECT membership_id, role_id FROM memberships
           WHERE user_id = $1 AND organization_id = $2`,
          [authUser.user_id, authUser.organization_id]
        );

        const memberships = membershipResult.rows || [];

        // Load all roles and collect permissions
        const permissions = new Set<string>();
        for (const membership of memberships) {
          const roleResult = await (executor as any).query(
            `SELECT permission_ids FROM roles WHERE role_id = $1`,
            [membership.role_id]
          );

          if (roleResult.rows && roleResult.rows.length > 0) {
            const role = roleResult.rows[0] as any;
            const permissionIds = role.permission_ids || [];
            permissionIds.forEach((perm: string) => permissions.add(perm));
          }
        }

        // Extract role names from memberships
        const roleResult = await (executor as any).query(
          `SELECT DISTINCT r.name FROM roles r
           JOIN memberships m ON r.role_id = m.role_id
           WHERE m.user_id = $1 AND m.organization_id = $2`,
          [authUser.user_id, authUser.organization_id]
        );

        const roles = (roleResult.rows || []).map((r: any) => r.name);

        return {
          userId: authUser.user_id,
          organizationId: authUser.organization_id,
          email: betterAuthUser.email,
          roles,
          permissions,
        };
      } catch (err) {
        console.error("BetterAuth provider error:", err);
        return null;
      }
    },
  };
}
