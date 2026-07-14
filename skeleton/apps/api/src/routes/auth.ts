/**
 * Authentication routes — email/password via BetterAuth session tables.
 *
 * Per ADR-0008: one enforcement point at command door (sessionProvider seam).
 * Real auth using better_auth_* tables + permissions from roles/memberships.
 *
 * Routes:
 * - POST /auth/sign-in: email + password → session cookie (Bun.password.verify)
 * - POST /auth/sign-out: clear session
 * - GET /auth/me: expose permissions to client
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { UnauthorizedError } from "@kongmy-stack/core";
import type { AppBindings } from "../main.js";
import { invoiceResource } from "@kongmy-stack/contract";

/**
 * Sign-in request (email + password).
 * Uses Bun.password.verify() for argon2id verification (ADR-0008).
 */
const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuth(app: OpenAPIHono<AppBindings>) {
  /**
   * POST /auth/sign-in
   * Email + password authentication.
   * Verifies password against hashed value in better_auth_account (provider_id='credential').
   * Creates a session and sets it as an HTTP-only cookie.
   *
   * Both invalid email and invalid password return same error (constant shape per ADR-0004).
   */
  app.post("/auth/sign-in", async (ctx) => {
    try {
      const body = await ctx.req.json();
      const { email, password } = signInSchema.parse(body);

      const executor = (ctx.get("db") as any).rawDb || ctx.get("db");

      // Step 1: Look up better_auth_user by email
      const userResult = await (executor as any).query(
        `SELECT * FROM better_auth_user WHERE email = $1 LIMIT 1`,
        [email]
      );

      if (!userResult.rows || userResult.rows.length === 0) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const betterAuthUser = userResult.rows[0] as any;

      // Step 2: Look up better_auth_account with provider_id='credential'
      const accountResult = await (executor as any).query(
        `SELECT * FROM better_auth_account WHERE user_id = $1 AND provider_id = $2 LIMIT 1`,
        [betterAuthUser.id, "credential"]
      );

      if (!accountResult.rows || accountResult.rows.length === 0) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const account = accountResult.rows[0] as any;

      // Step 3: Verify password using Bun.password.verify (argon2id)
      if (!account.password) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const isPasswordValid = await Bun.password.verify(
        password,
        account.password
      );

      if (!isPasswordValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      // Step 4: Create a session token (crypto.randomUUID × 2 concatenated)
      const sessionId = crypto.randomUUID().replace(/-/g, "");
      const sessionToken = crypto.randomUUID().replace(/-/g, "");

      // Step 5: Insert session into better_auth_session table
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      const now = new Date().toISOString();

      await (executor as any).query(
        `INSERT INTO better_auth_session (id, expires_at, token, created_at, updated_at, user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, expiresAt, sessionToken, now, now, betterAuthUser.id]
      );

      // Step 6: Set session as HTTP-only cookie
      const response = ctx.json({ ok: true }, 200);
      response.headers.append(
        "Set-Cookie",
        `auth_session=${sessionToken}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Strict`
      );

      return response;
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        throw err;
      }
      console.error("Sign-in error:", err);
      throw new UnauthorizedError("Sign-in failed");
    }
  });

  /**
   * POST /auth/sign-out
   * Clear the session cookie.
   */
  app.post("/auth/sign-out", async (ctx) => {
    const response = ctx.json({ ok: true }, 200);
    response.headers.append(
      "Set-Cookie",
      `auth_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`
    );
    return response;
  });

  /**
   * GET /auth/me
   * Expose authenticated session and permissions to client.
   * Called by web app to populate session state (user, roles, permissions).
   * Used by beforeLoad guards to check auth status.
   */
  app.get("/auth/me", async (ctx) => {
    const session = ctx.get("session");

    if (!session) {
      return ctx.json(null, 401);
    }

    // Build permission list from contract: extract ALL invoice permissions that this user can do
    const allInvoicePermissions = [
      invoiceResource.permissions.read,
      invoiceResource.permissions.create,
      invoiceResource.permissions.update,
      invoiceResource.permissions.delete,
    ];

    const permissions = allInvoicePermissions.filter((perm) =>
      session.permissions.has(perm)
    );

    return ctx.json(
      {
        userId: session.userId,
        roles: session.roles,
        permissions,
      },
      200
    );
  });
}
