#!/usr/bin/env bun

/**
 * Create a new tenant (organization + branch + default roles)
 *
 * Per ADR-0006: tenant lifecycle script, idempotent by organization name.
 * Creates org, branch, and seeded default roles (admin with all permissions, user with limited).
 *
 * Usage:
 *   # Use DATABASE_URL (file-backed or postgres)
 *   DATABASE_URL="file:./dev.db" bun scripts/new-tenant.ts "Acme Corp"
 *
 *   # Second run with same name returns SAME ids (created: false)
 *   DATABASE_URL="file:./dev.db" bun scripts/new-tenant.ts "Acme Corp"
 *
 *   # Falls back to in-memory if DATABASE_URL not set (with warning)
 *   bun scripts/new-tenant.ts "Test Corp"
 *
 * Output: { organizationId, organizationName, branchId, roles, created: true|false }
 */

import type { DbInstance } from "@kongmy-stack/db";

const generateId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const now = new Date().toISOString();

/**
 * Resolve database adapter from DATABASE_URL (or in-memory with warning).
 * Matches pattern from API's env.ts.
 */
async function resolveDatabase(): Promise<{ db: DbInstance; isInMemory: boolean }> {
  const databaseUrl = process.env.DATABASE_URL || "file::memory:";

  // @ts-ignore - runtime imports
  const { createInMemoryAdapter, createPGliteAdapterWithFile, createPostgresAdapter } = await import("@kongmy-stack/db");

  if (databaseUrl === "file::memory:" || !databaseUrl) {
    console.warn("⚠️  DATABASE_URL not set; using in-memory adapter (data will be lost on exit)");
    const db = await createInMemoryAdapter();
    return { db, isInMemory: true };
  }

  if (databaseUrl.startsWith("file:")) {
    // File-backed PGlite path (e.g., "file:./dev.db" or "file:/tmp/app.db")
    const filePath = databaseUrl.replace(/^file:/, "");
    const db = await createPGliteAdapterWithFile(filePath);
    return { db, isInMemory: false };
  }

  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    // PostgreSQL URL
    const db = await createPostgresAdapter(databaseUrl);
    return { db, isInMemory: false };
  }

  throw new Error(`Invalid DATABASE_URL: ${databaseUrl}`);
}

export interface TenantCreateResult {
  organizationId: string;
  organizationName: string;
  branchId: string;
  branchName: string;
  roles: {
    admin: string;
    user: string;
  };
  created: boolean; // true if new, false if already existed
}

export interface TenantConfig {
  name: string;
  branchName?: string;
  permissions?: {
    read: string;
    create: string;
    update: string;
    delete: string;
    post: string;
    cancel: string;
    send: string;
  };
}

/**
 * Create or retrieve a tenant by name (idempotent).
 *
 * @param db Database adapter instance
 * @param config Tenant configuration
 * @returns Tenant IDs and created flag
 */
export async function createTenant(db: DbInstance, config: TenantConfig): Promise<TenantCreateResult> {
  const executor = db.rawDb || db;
  const { name, branchName = "Main" } = config;
  const permissions = config.permissions || {
    read: "invoice:read",
    create: "invoice:create",
    update: "invoice:update",
    delete: "invoice:delete",
    post: "invoice:post",
    cancel: "invoice:cancel",
    send: "invoice:send",
  };

  const ALL_PERMISSIONS = Object.values(permissions);

  // ============================================================================
  // Ensure unique constraint on name (idempotency requirement)
  // ============================================================================

  try {
    await (executor as any).query(
      `ALTER TABLE organizations ADD CONSTRAINT organizations_name_unique UNIQUE (name)`
    );
  } catch (err) {
    // Constraint already exists or error — ignore (idempotent)
  }

  // ============================================================================
  // Look up existing org by name (idempotency key)
  // ============================================================================

  const existing = await (executor as any).query(
    `SELECT org_id FROM organizations WHERE name = $1 LIMIT 1`,
    [name]
  );

  if (existing?.rows && existing.rows.length > 0) {
    // Organization already exists — return its IDs with created: false
    const orgId = existing.rows[0].org_id;

    // Fetch branch
    const branchQuery = await (executor as any).query(
      `SELECT branch_id FROM branches WHERE organization_id = $1 AND code = $2 LIMIT 1`,
      [orgId, branchName.toUpperCase()]
    );
    const branchId = branchQuery?.rows?.[0]?.branch_id || generateId("branch");

    // Fetch roles
    const rolesQuery = await (executor as any).query(
      `SELECT role_id, name FROM roles WHERE organization_id = $1`,
      [orgId]
    );
    const rolesMap = new Map(rolesQuery?.rows?.map((r: any) => [r.name, r.role_id]) || []);

    return {
      organizationId: orgId,
      organizationName: name,
      branchId,
      branchName,
      roles: {
        admin: rolesMap.get("admin") || generateId("role"),
        user: rolesMap.get("user") || generateId("role"),
      },
      created: false, // Already existed
    };
  }

  // ============================================================================
  // Create new org, branch, and roles
  // ============================================================================

  const orgId = generateId("org");
  const branchId = generateId("branch");

  // Insert org
  await (executor as any).query(
    `INSERT INTO organizations (org_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4)`,
    [orgId, name, now, now]
  );

  // Insert branch
  await (executor as any).query(
    `INSERT INTO branches (branch_id, organization_id, name, code, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [branchId, orgId, branchName, branchName.toUpperCase(), now, now]
  );

  // Admin role: all permissions
  const adminRoleId = generateId("role");
  await (executor as any).query(
    `INSERT INTO roles (role_id, organization_id, name, description, permission_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      adminRoleId,
      orgId,
      "admin",
      "Administrator with all permissions",
      JSON.stringify(ALL_PERMISSIONS),
      now,
      now,
    ]
  );

  // User role: all permissions except delete
  const userRoleId = generateId("role");
  const userPermissions = ALL_PERMISSIONS.filter((p) => p !== permissions.delete);
  await (executor as any).query(
    `INSERT INTO roles (role_id, organization_id, name, description, permission_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userRoleId,
      orgId,
      "user",
      "User with limited permissions (no delete)",
      JSON.stringify(userPermissions),
      now,
      now,
    ]
  );

  return {
    organizationId: orgId,
    organizationName: name,
    branchId,
    branchName,
    roles: {
      admin: adminRoleId,
      user: userRoleId,
    },
    created: true, // Newly created
  };
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: bun scripts/new-tenant.ts <org-name>");
    console.error("Example: bun scripts/new-tenant.ts 'Acme Corp'");
    console.error("");
    console.error("Set DATABASE_URL to persist to file or postgres:");
    console.error("  DATABASE_URL='file:./dev.db' bun scripts/new-tenant.ts 'Acme Corp'");
    process.exit(1);
  }

  const orgName = args[0];

  try {
    const { db, isInMemory } = await resolveDatabase();

    const result = await createTenant(db, { name: orgName });

    console.log(JSON.stringify(result, null, 2));

    if (isInMemory) {
      console.warn("⚠️  Data saved only to memory; will be lost on exit.");
    }
  } catch (err) {
    console.error("Error creating tenant:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export { resolveDatabase };
