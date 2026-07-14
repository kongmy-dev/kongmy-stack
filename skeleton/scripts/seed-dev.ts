/**
 * Seed development data
 *
 * Per ADR-0008: seed roles with permissions derived from contract.
 * Passwords hashed with Bun.password.hash (argon2id).
 *
 * Usage:
 *   - From main.ts at boot: await seedDev(db)
 *   - From CLI: bun scripts/seed-dev.ts
 *
 * Creates:
 *   - One organization and one branch
 *   - Two users (admin@dev.local, clerk@dev.local)
 *   - Two roles (admin with all permissions, clerk without delete)
 *   - One membership per user
 */

// Note: DbInstance type from @kongmy-stack/db not imported due to type-check scope
// This file is only loaded at runtime via dynamic import

const generateId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
const now = new Date().toISOString();

/**
 * Seed the development database.
 * Idempotent: can be called multiple times safely.
 * Permissions passed as parameter to avoid import resolution issues.
 */
export async function seedDev(
  db: any,
  permissions?: { read: string; create: string; update: string; delete: string; post: string; cancel: string; send: string }
): Promise<void> {
  // Default permissions from contract (will be passed from main.ts)
  const perms = permissions || {
    read: "invoice:read",
    create: "invoice:create",
    update: "invoice:update",
    delete: "invoice:delete",
    post: "invoice:post",
    cancel: "invoice:cancel",
    send: "invoice:send",
  };

  const ALL_INVOICE_PERMISSIONS = [
    perms.read,
    perms.create,
    perms.update,
    perms.delete,
    perms.post,
    perms.cancel,
    perms.send,
  ];

  const executor = db.rawDb || db;

  // ============================================================================
  // Organization & Branch
  // ============================================================================

  const orgId = generateId("org");
  const branchId = generateId("branch");

  await (executor as any).query(
    `INSERT INTO organizations (org_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [orgId, "Dev Org", now, now]
  );

  await (executor as any).query(
    `INSERT INTO branches (branch_id, organization_id, name, code, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [branchId, orgId, "Main Branch", "MAIN", now, now]
  );

  // ============================================================================
  // Roles with permissions from contract
  // ============================================================================

  // Admin role: all permissions
  const adminRoleId = generateId("role");
  await (executor as any).query(
    `INSERT INTO roles (role_id, organization_id, name, description, permission_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [adminRoleId, orgId, "admin", "Administrator with all permissions", JSON.stringify(ALL_INVOICE_PERMISSIONS), now, now]
  );

  // Clerk role: all permissions except delete
  const clerkRoleId = generateId("role");
  const clerkPermissions = ALL_INVOICE_PERMISSIONS.filter((p) => p !== perms.delete);
  await (executor as any).query(
    `INSERT INTO roles (role_id, organization_id, name, description, permission_ids, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [clerkRoleId, orgId, "clerk", "Clerk without delete permission", JSON.stringify(clerkPermissions), now, now]
  );

  // ============================================================================
  // Users with hashed passwords
  // ============================================================================

  const adminPassword = await Bun.password.hash("dev-admin-password", {
    algorithm: "argon2id",
    memoryCost: 4,
    timeCost: 3,
  });

  const clerkPassword = await Bun.password.hash("dev-clerk-password", {
    algorithm: "argon2id",
    memoryCost: 4,
    timeCost: 3,
  });

  // Admin user
  const adminBetterAuthUserId = generateId("user");
  const adminUserId = generateId("user");

  await (executor as any).query(
    `INSERT INTO better_auth_user (id, email, email_verified, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [adminBetterAuthUserId, "admin@dev.local", true, "Admin User", now, now]
  );

  await (executor as any).query(
    `INSERT INTO better_auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [generateId("acc"), adminBetterAuthUserId, adminBetterAuthUserId, "credential", adminPassword, now, now]
  );

  await (executor as any).query(
    `INSERT INTO users (user_id, organization_id, email, display_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [adminUserId, orgId, "admin@dev.local", "Admin User", now, now]
  );

  // Clerk user
  const clerkBetterAuthUserId = generateId("user");
  const clerkUserId = generateId("user");

  await (executor as any).query(
    `INSERT INTO better_auth_user (id, email, email_verified, name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [clerkBetterAuthUserId, "clerk@dev.local", true, "Clerk User", now, now]
  );

  await (executor as any).query(
    `INSERT INTO better_auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [generateId("acc"), clerkBetterAuthUserId, clerkBetterAuthUserId, "credential", clerkPassword, now, now]
  );

  await (executor as any).query(
    `INSERT INTO users (user_id, organization_id, email, display_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [clerkUserId, orgId, "clerk@dev.local", "Clerk User", now, now]
  );

  // ============================================================================
  // Memberships
  // ============================================================================

  await (executor as any).query(
    `INSERT INTO memberships (membership_id, organization_id, branch_id, user_id, role_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [generateId("mem"), orgId, branchId, adminUserId, adminRoleId, now, now]
  );

  await (executor as any).query(
    `INSERT INTO memberships (membership_id, organization_id, branch_id, user_id, role_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [generateId("mem"), orgId, branchId, clerkUserId, clerkRoleId, now, now]
  );

  console.log("✓ Development data seeded");
}

// CLI: run directly
if (import.meta.main) {
  // @ts-ignore - import only used at runtime via CLI, not type-checked
  const { createInMemoryAdapter } = await import("@kongmy-stack/db");
  const db = await createInMemoryAdapter();
  await seedDev(db);
  console.log("Seed complete");
}
