/**
 * Database layer tests — PGlite in-memory.
 *
 * Per ADR-0005: contract tests via in-memory adapters; full repo path exercised.
 * Per ADR-0009: gapless sequence concurrency test with real SQL.
 *
 * Run with: bun test db.test.ts
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createInMemoryAdapter, type DbInstance } from "./adapters/in-memory";
import { invoiceRepo } from "./repos";
import { allocateSequenceNumber, formatDocumentNumber, type RawExecutor } from "./helpers";
import { assertEntityInScope } from "./with-scope";
import type { TenantScope } from "./with-scope";

let db: DbInstance;
const testOrg: TenantScope = { org: "org_test1", branch: "branch_test1" };
const otherOrg: TenantScope = { org: "org_other", branch: "branch_other" };

beforeEach(async () => {
  db = await createInMemoryAdapter();
});

describe("Invoice Repository", () => {
  it("creates an invoice", async () => {
    const invoice = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00001",
      customerName: "Acme Corp",
      amount: 50000,
    });

    expect(invoice.inv_id).toMatch(/^inv_/);
    expect(invoice.organization_id).toBe(testOrg.org);
    expect(invoice.branch_id).toBe(testOrg.branch);
    expect(invoice.customer_name).toBe("Acme Corp");
    expect(invoice.amount).toBe(50000);
    expect(invoice.status).toBe("draft");
    expect(invoice.created_at).toBeDefined();
    expect(invoice.updated_at).toBeDefined();
  });

  it("retrieves an invoice by ID", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00002",
      customerName: "Beta Inc",
      amount: 100000,
    });

    const fetched = await invoiceRepo.getById(db, testOrg, created.inv_id);

    expect(fetched).toBeTruthy();
    expect(fetched?.inv_id).toBe(created.inv_id);
    expect(fetched?.customer_name).toBe("Beta Inc");
  });

  it("returns null for non-existent invoice", async () => {
    const fetched = await invoiceRepo.getById(db, testOrg, "inv_nonexistent");
    expect(fetched).toBeNull();
  });

  it("lists invoices with pagination", async () => {
    // Create 5 invoices
    for (let i = 1; i <= 5; i++) {
      await invoiceRepo.create(db, testOrg, {
        branchId: testOrg.branch,
        invoiceNumber: `INV-2026-0000${i}`,
        customerName: `Customer ${i}`,
        amount: i * 10000,
      });
    }

    const firstPage = await invoiceRepo.list(db, testOrg, { limit: 2, offset: 0 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(5);

    const secondPage = await invoiceRepo.list(db, testOrg, { limit: 2, offset: 2 });
    expect(secondPage.items).toHaveLength(2);
  });

  it("updates an invoice", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00010",
      customerName: "Old Name",
      amount: 50000,
    });

    // Delay to ensure timestamp differs (ISO timestamps have millisecond precision)
    await new Promise((r) => setTimeout(r, 100));

    const updated = await invoiceRepo.update(db, testOrg, created.inv_id, {
      customerName: "New Name",
      status: "posted",
    });

    expect(updated.customer_name).toBe("New Name");
    expect(updated.status).toBe("posted");
    expect(updated.inv_id).toBe(created.inv_id);
    expect(updated.updated_at > created.updated_at).toBe(true); // timestamp changed
  });

  it("deletes an invoice", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00011",
      customerName: "To Delete",
      amount: 30000,
    });

    await invoiceRepo.delete(db, testOrg, created.inv_id);

    const fetched = await invoiceRepo.getById(db, testOrg, created.inv_id);
    expect(fetched).toBeNull();
  });
});

describe("Scope constraints", () => {
  it("blocks cross-tenant reads", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00020",
      customerName: "Secret Invoice",
      amount: 999999,
    });

    // Try to read with a different org
    const attempt = async () => {
      await invoiceRepo.getById(db, otherOrg, created.inv_id);
    };

    expect(attempt()).rejects.toThrow("Cross-tenant access violation");
  });

  it("blocks cross-branch reads", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00021",
      customerName: "Branch Secret",
      amount: 888888,
    });

    const wrongBranch: TenantScope = {
      org: testOrg.org,
      branch: "branch_different",
    };

    const attempt = async () => {
      await invoiceRepo.getById(db, wrongBranch, created.inv_id);
    };

    expect(attempt()).rejects.toThrow("Cross-branch access violation");
  });

  it("lists only invoices in scope", async () => {
    // Create invoices for testOrg
    await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00030",
      customerName: "In Scope 1",
      amount: 10000,
    });

    await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00031",
      customerName: "In Scope 2",
      amount: 20000,
    });

    // Create invoices for otherOrg
    await invoiceRepo.create(db, otherOrg, {
      branchId: otherOrg.branch,
      invoiceNumber: "INV-2026-00032",
      customerName: "Out of Scope",
      amount: 30000,
    });

    const list = await invoiceRepo.list(db, testOrg);
    expect(list.items).toHaveLength(2);
    expect(list.total).toBe(2);
    expect(list.items.every((i) => i.organization_id === testOrg.org)).toBe(true);
  });

  it("rejects cross-tenant access in assertEntityInScope", () => {
    const entity = { organization_id: "org_other", branch_id: testOrg.branch };

    expect(() => assertEntityInScope(entity, testOrg)).toThrow(
      "Cross-tenant access violation"
    );
  });
});

describe("Gapless document sequences", () => {
  it("allocates sequential numbers without gaps", async () => {
    const org = "org_seq_test";
    const series = "INV";
    const year = 2026;
    const executor = (db as DbInstance & { rawDb: RawExecutor }).rawDb;

    const numbers = new Set<number>();

    // Allocate 25 numbers sequentially
    for (let i = 0; i < 25; i++) {
      const num = await allocateSequenceNumber(executor, org, series, year);
      numbers.add(num);
    }

    // Verify they're exactly {1..25}
    const sorted = Array.from(numbers).sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("allocates sequences concurrently without gaps", async () => {
    const org = "org_concurrent_test";
    const series = "PO";
    const year = 2026;
    const executor = (db as DbInstance & { rawDb: RawExecutor }).rawDb;

    // Launch 25 concurrent allocations
    const promises = Array.from({ length: 25 }, () =>
      allocateSequenceNumber(executor, org, series, year)
    );

    const results = await Promise.all(promises);
    const numbers = new Set(results);

    // Verify: no duplicates, exactly {1..25}
    expect(numbers.size).toBe(25);

    const sorted = Array.from(numbers).sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("formats document numbers correctly", () => {
    const formatted = formatDocumentNumber("INV", 2026, 42);
    expect(formatted).toBe("INV-2026-00042");

    const formatted2 = formatDocumentNumber("PO", 2025, 1);
    expect(formatted2).toBe("PO-2025-00001");

    const formatted3 = formatDocumentNumber("SO", 2026, 12345);
    expect(formatted3).toBe("SO-2026-12345");
  });
});

describe("Timestamps and IDs", () => {
  it("sets createdAt and updatedAt on create", async () => {
    const invoice = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00100",
      customerName: "Timestamp Test",
      amount: 50000,
    });

    expect(invoice.created_at).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO-8601
    expect(invoice.updated_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(invoice.created_at).toBe(invoice.updated_at); // same on create
  });

  it("updates updatedAt on update", async () => {
    const created = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00101",
      customerName: "Original",
      amount: 50000,
    });

    // Delay to ensure timestamp differs (ISO timestamps have millisecond precision)
    await new Promise((r) => setTimeout(r, 100));

    const updated = await invoiceRepo.update(db, testOrg, created.inv_id, {
      customerName: "Updated",
    });

    expect(updated.updated_at).not.toBe(created.updated_at);
    expect(updated.updated_at > created.updated_at).toBe(true);
  });

  it("generates prefixed ULIDs", async () => {
    const invoice = await invoiceRepo.create(db, testOrg, {
      branchId: testOrg.branch,
      invoiceNumber: "INV-2026-00102",
      customerName: "ULID Test",
      amount: 50000,
    });

    expect(invoice.inv_id).toMatch(/^inv_[0-9A-Z]{26}$/); // inv_ + 26-char ULID
  });
});
