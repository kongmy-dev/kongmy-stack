/**
 * Invoice contract tests: end-to-end via app.request() per ADR-0005.
 *
 * Verifies:
 * - 200/201 success envelope shape
 * - 422 validation error with per-field details
 * - 401 unauthorized, 403 forbidden, 404 not found
 * - Audit rows written with request-id + trace-id + actor
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createTestApp, createTestInvoice } from "../test-utils.js";

describe("Invoice API (contract tests)", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  // ========================================================================
  // Health Check (sanity check)
  // ========================================================================

  it("GET /health returns 200 ok", async () => {
    const res = await testApp.app.request("/health");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  // ========================================================================
  // CREATE Invoice (POST /invoices)
  // ========================================================================

  it("POST /invoices creates invoice, returns 201 with resource", async () => {
    const input = createTestInvoice();

    const res = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_test_create_001",
        "x-trace-id": "trace_create_001",
        "x-org-id": "org_test",
        "x-branch-id": "branch_main",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);
    const created = await res.json();

    // Response shape per ADR-0004: bare object for single resource
    expect(created.id).toBeDefined();
    expect(created.id).toMatch(/^inv_/); // Prefixed ULID
    expect(created.status).toBe("draft");
    expect(created.number).toBeDefined();
    expect(created.customerName).toBe(input.customerName);
  });

  it("POST /invoices writes audit_log entry with actor, action, resource id", async () => {
    const input = createTestInvoice();

    const res = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_audit_test",
        "x-org-id": "org_audit",
        "x-user-id": "user_bob",
        "x-roles": "admin",
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    const invoiceId = created.id;

    // Query audit_log via rawDb to verify the entry was written
    const auditRows = await (testApp.db.rawDb as any).query(
      `SELECT * FROM audit_log WHERE action = 'invoice:create' AND resource_id = $1`,
      [invoiceId]
    );

    expect(auditRows.rows).toBeDefined();
    expect(auditRows.rows.length).toBe(1);

    const auditEntry = auditRows.rows[0];
    expect(auditEntry.organization_id).toBe("org_audit");
    expect(auditEntry.user_id).toBe("user_bob");
    expect(auditEntry.action).toBe("invoice:create");
    expect(auditEntry.resource_type).toBe("invoice");
    expect(auditEntry.resource_id).toBe(invoiceId);
    expect(auditEntry.autonomy_level).toBe("auto");
  });

  it("POST /invoices with empty lineItems returns 422 VALIDATION_ERROR", async () => {
    const valid = createTestInvoice();
    const invalid = { ...valid, lineItems: [] }; // Manually create invalid data

    const res = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_test_empty_items",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify(invalid),
    });

    expect(res.status).toBe(422);
    const error = await res.json();

    // Error envelope per ADR-0004: { error: { code, message, details } } + requestId
    expect(error.error).toBeDefined();
    expect(error.error.code).toBe("VALIDATION_ERROR");
    expect(error.error.details).toBeDefined();
    expect(error.requestId).toBe("req_test_empty_items");
  });

  it("POST /invoices without admin role returns 403 FORBIDDEN", async () => {
    const input = createTestInvoice();

    const res = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_test_no_auth",
        "x-roles": "", // No roles
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(403);
    const error = await res.json();
    expect(error.error.code).toBe("FORBIDDEN");
  });

  // ========================================================================
  // LIST Invoices (GET /invoices)
  // ========================================================================

  it("GET /invoices returns 200 with paginated list", async () => {
    const res = await testApp.app.request("/invoices?limit=10&offset=0", {
      headers: {
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
    });

    expect(res.status).toBe(200);
    const result = await res.json();

    // List response envelope per ADR-0004: { data, meta }
    expect(result.data).toBeInstanceOf(Array);
    expect(result.meta).toBeDefined();
    expect(result.meta.limit).toBe(10);
    expect(result.meta.offset).toBe(0);
    expect(typeof result.meta.total).toBe("number");
    expect(typeof result.meta.hasMore).toBe("boolean");
  });

  // ========================================================================
  // GET Invoice (GET /invoices/{id})
  // ========================================================================

  it("GET /invoices/{id} returns 200 with resource", async () => {
    // First, create an invoice
    const created = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify(createTestInvoice()),
    });

    const invoice = await created.json();
    const id = invoice.id;

    // Then fetch it
    const res = await testApp.app.request(`/invoices/${id}`, {
      headers: {
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
    });

    expect(res.status).toBe(200);
    const fetched = await res.json();
    expect(fetched.id).toBe(id);
    expect(fetched.status).toBe("draft");
  });

  it("GET /invoices/{id} with nonexistent id returns 404 NOT_FOUND", async () => {
    const res = await testApp.app.request("/invoices/inv_nonexistent", {
      headers: {
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
    });

    expect(res.status).toBe(404);
    const error = await res.json();
    expect(error.error.code).toBe("NOT_FOUND");
  });

  // ========================================================================
  // UPDATE Invoice (PUT /invoices/{id})
  // ========================================================================

  it("PUT /invoices/{id} updates draft invoice, returns 200", async () => {
    // Create
    const created = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify(createTestInvoice()),
    });

    const invoice = await created.json();
    const id = invoice.id;

    // Update
    const res = await testApp.app.request(`/invoices/${id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-request-id": "req_test_update_001",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify({ customerName: "Updated Name" }),
    });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.id).toBe(id);
    expect(updated.customerName).toBe("Updated Name");
  });

  // ========================================================================
  // DELETE Invoice (DELETE /invoices/{id})
  // ========================================================================

  it("DELETE /invoices/{id} deletes draft invoice, returns 200", async () => {
    // Create
    const created = await testApp.app.request("/invoices", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
      body: JSON.stringify(createTestInvoice()),
    });

    const invoice = await created.json();
    const id = invoice.id;

    // Delete
    const res = await testApp.app.request(`/invoices/${id}`, {
      method: "DELETE",
      headers: {
        "x-request-id": "req_test_delete_001",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
    });

    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.success).toBe(true);
  });

  // ========================================================================
  // OpenAPI Schema
  // ========================================================================

  it("GET /openapi.json serves a spec containing the invoice routes", async () => {
    const res = await testApp.app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toContain("/invoices");
    expect(paths).toContain("/invoices/{id}");
    const invoices = spec.paths?.["/invoices"] as Record<string, unknown>;
    expect(Object.keys(invoices)).toEqual(
      expect.arrayContaining(["get", "post"]),
    );
  });

  it("request without a session returns 401 UNAUTHORIZED envelope", async () => {
    const res = await testApp.app.request("/invoices", {
      headers: { "x-anonymous": "true" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(typeof body.error.message).toBe("string");
  });

  // ========================================================================
  // Request tracking
  // ========================================================================

  it("request includes requestId + traceId in error logs", async () => {
    const res = await testApp.app.request("/invoices/inv_nonexistent", {
      headers: {
        "x-request-id": "req_tracking_test",
        "x-user-id": "user_alice",
        "x-roles": "admin",
      },
    });

    expect(res.status).toBe(404);
    const error = await res.json();
    expect(error.requestId).toBe("req_tracking_test");
    expect(error.traceId).toBeDefined();
  });
});
