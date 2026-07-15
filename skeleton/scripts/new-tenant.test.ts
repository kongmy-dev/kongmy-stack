/**
 * New-tenant idempotency tests (ADR-0006)
 *
 * Tests:
 * 1. First call creates org/branch/roles and returns created: true
 * 2. Second call with same name returns SAME ids and created: false
 * 3. Different name creates new org with different ids
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createInMemoryAdapter } from "@kongmy-stack/db";
import { createTenant, type TenantCreateResult } from "./new-tenant.js";

describe("New-Tenant Idempotency (Same Adapter)", () => {
  let db: Awaited<ReturnType<typeof createInMemoryAdapter>>;

  beforeAll(async () => {
    db = await createInMemoryAdapter();
  });

  it("first call creates tenant and returns created: true", async () => {
    const result = await createTenant(db, { name: "Test Corp" });

    expect(result.created).toBe(true);
    expect(result.organizationId).toMatch(/^org_/);
    expect(result.organizationName).toBe("Test Corp");
    expect(result.branchId).toMatch(/^branch_/);
    expect(result.branchName).toBe("Main");
    expect(result.roles.admin).toMatch(/^role_/);
    expect(result.roles.user).toMatch(/^role_/);
  });

  it("second call with same name returns SAME ids and created: false", async () => {
    const first = await createTenant(db, { name: "Idempotent Corp" });
    expect(first.created).toBe(true);

    const second = await createTenant(db, { name: "Idempotent Corp" });
    expect(second.created).toBe(false);

    // IDs must be identical
    expect(second.organizationId).toBe(first.organizationId);
    expect(second.branchId).toBe(first.branchId);
    expect(second.roles.admin).toBe(first.roles.admin);
    expect(second.roles.user).toBe(first.roles.user);
  });

  it("different names create different orgs with different ids", async () => {
    const org1 = await createTenant(db, { name: "Company A" });
    const org2 = await createTenant(db, { name: "Company B" });

    expect(org1.organizationId).not.toBe(org2.organizationId);
    expect(org1.branchId).not.toBe(org2.branchId);
    expect(org1.roles.admin).not.toBe(org2.roles.admin);
  });

  it("idempotency works across multiple calls", async () => {
    const orgName = "Multi-Call Corp";

    const call1 = await createTenant(db, { name: orgName });
    expect(call1.created).toBe(true);

    const call2 = await createTenant(db, { name: orgName });
    expect(call2.created).toBe(false);
    expect(call2.organizationId).toBe(call1.organizationId);

    const call3 = await createTenant(db, { name: orgName });
    expect(call3.created).toBe(false);
    expect(call3.organizationId).toBe(call1.organizationId);

    const call4 = await createTenant(db, { name: orgName });
    expect(call4.created).toBe(false);
    expect(call4.organizationId).toBe(call1.organizationId);
  });
});
