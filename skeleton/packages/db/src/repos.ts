/**
 * Repository functions — data access layer.
 *
 * Per ADR-0003: routes → service functions → drizzle repo functions.
 * Per ADR-0005: CRUD + pagination exercising prefixed-ULID pk + createdAt/updatedAt.
 * Per ADR-0008: scope constraints enforced at the repo layer.
 *
 * Each repo is a collection of functions, not a class (ADR-0002).
 * Tests call these directly with a fresh in-memory adapter.
 *
 * Example usage:
 *   const db = await createInMemoryAdapter();
 *   const invoice = await invoiceRepo.create(db, { org, branch, invoiceNumber, ... });
 *   const fetched = await invoiceRepo.getById(db, { org, branch }, id);
 */

import type { TenantScope } from "./with-scope";
import { assertEntityInScope } from "./with-scope";
import { generateId, getCurrentTimestamp, type RawExecutor } from "./helpers";
import type { DbInstance } from "./adapters/in-memory";

export interface Invoice {
  inv_id: string;
  organization_id: string;
  branch_id: string;
  invoice_number: string;
  customer_name: string;
  amount: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface InvoiceInput {
  branchId: string;
  invoiceNumber: string;
  customerName: string;
  amount: number;
  status?: string;
}

/**
 * Extract raw executor from drizzle db instance.
 */
function getRawExecutor(db: DbInstance & { rawDb?: RawExecutor }): RawExecutor {
  const executor = db.rawDb || db;
  if (!executor || typeof executor.query !== "function") {
    throw new Error("Database instance does not have rawDb or query method");
  }
  return executor as RawExecutor;
}

/**
 * Invoice repository — demonstrates repo pattern.
 * All functions receive db and scope as parameters (no class state).
 */
export const invoiceRepo = {
  /**
   * Create a new invoice.
   */
  async create(
    db: DbInstance & { rawDb?: RawExecutor },
    scope: TenantScope,
    input: InvoiceInput
  ): Promise<Invoice> {
    const id = generateId("inv");
    const now = getCurrentTimestamp();
    const executor = getRawExecutor(db);

    const invoice: Invoice = {
      inv_id: id,
      organization_id: scope.org,
      branch_id: input.branchId,
      invoice_number: input.invoiceNumber,
      customer_name: input.customerName,
      amount: input.amount,
      status: input.status || "draft",
      created_at: now,
      updated_at: now,
    };

    // Insert using raw SQL
    await executor.query(`
      INSERT INTO invoices
        (inv_id, organization_id, branch_id, invoice_number, customer_name, amount, status, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      invoice.inv_id,
      invoice.organization_id,
      invoice.branch_id,
      invoice.invoice_number,
      invoice.customer_name,
      invoice.amount,
      invoice.status,
      invoice.created_at,
      invoice.updated_at,
    ]);

    return invoice;
  },

  /**
   * Get an invoice by ID.
   * Enforces scope constraint: throws if org/branch don't match.
   */
  async getById(
    db: DbInstance & { rawDb?: RawExecutor },
    scope: TenantScope,
    id: string
  ): Promise<Invoice | null> {
    const executor = getRawExecutor(db);
    const result = await executor.query(`
      SELECT * FROM invoices
      WHERE inv_id = $1
    `, [id]);

    if (!result.rows || result.rows.length === 0) {
      return null;
    }

    const invoice = result.rows[0] as unknown as Invoice;
    assertEntityInScope(invoice, scope);
    return invoice;
  },

  /**
   * List invoices for a scope with pagination.
   * Per ADR-0004: pagination via limit/offset.
   */
  async list(
    db: DbInstance & { rawDb?: RawExecutor },
    scope: TenantScope,
    options?: { limit?: number; offset?: number }
  ): Promise<{ items: Invoice[]; total: number }> {
    const limit = options?.limit || 10;
    const offset = options?.offset || 0;
    const executor = getRawExecutor(db);

    const countResult = await executor.query(`
      SELECT COUNT(*) as count FROM invoices
      WHERE organization_id = $1 AND branch_id = $2
    `, [scope.org, scope.branch]);

    const total =
      countResult.rows && countResult.rows.length > 0
        ? (countResult.rows[0].count as number)
        : 0;

    const itemsResult = await executor.query(`
      SELECT * FROM invoices
      WHERE organization_id = $1 AND branch_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `, [scope.org, scope.branch, limit, offset]);

    const items = ((itemsResult.rows || []) as unknown) as Invoice[];

    return { items, total };
  },

  /**
   * Update an invoice.
   * Enforces scope constraint.
   */
  async update(
    db: DbInstance & { rawDb?: RawExecutor },
    scope: TenantScope,
    id: string,
    input: Partial<InvoiceInput>
  ): Promise<Invoice> {
    const executor = getRawExecutor(db);
    // Fetch to check scope
    const existing = await this.getById(db, scope, id);
    if (!existing) {
      throw new Error(`Invoice ${id} not found`);
    }

    const now = getCurrentTimestamp();
    const updated: Invoice = {
      ...existing,
      ...(input.branchId && { branch_id: input.branchId }),
      ...(input.invoiceNumber && { invoice_number: input.invoiceNumber }),
      ...(input.customerName && { customer_name: input.customerName }),
      ...(typeof input.amount === "number" && { amount: input.amount }),
      ...(input.status && { status: input.status }),
      updated_at: now,
    };

    await executor.query(`
      UPDATE invoices
      SET
        branch_id = $1,
        invoice_number = $2,
        customer_name = $3,
        amount = $4,
        status = $5,
        updated_at = $6
      WHERE inv_id = $7
    `, [
      updated.branch_id,
      updated.invoice_number,
      updated.customer_name,
      updated.amount,
      updated.status,
      updated.updated_at,
      id,
    ]);

    return updated;
  },

  /**
   * Delete an invoice (hard delete, no soft delete per ADR-0005).
   */
  async delete(
    db: DbInstance & { rawDb?: RawExecutor },
    scope: TenantScope,
    id: string
  ): Promise<void> {
    const executor = getRawExecutor(db);
    // Fetch to check scope
    const existing = await this.getById(db, scope, id);
    if (!existing) {
      throw new Error(`Invoice ${id} not found`);
    }

    await executor.query(
      `DELETE FROM invoices WHERE inv_id = $1`,
      [id]
    );
  },
};
