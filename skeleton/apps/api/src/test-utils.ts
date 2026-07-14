/**
 * Contract test utilities per ADR-0005.
 * Provides in-memory adapters + test-data factories for app.request() testing.
 *
 * Testing pyramid: contract tests are the workhorse (no port, no mocks, full path).
 */

import { createInMemoryAdapter, generateId } from "@kongmy-stack/db";
import { invoiceCreateInput, type InvoiceCreateInput } from "@kongmy-stack/contract";
import { createApp, env } from "./main.js";

/**
 * createTestApp: factory for contract tests.
 * Returns app + in-memory db, ready for app.request().
 */
export async function createTestApp() {
  const db = await createInMemoryAdapter();
  const app = createApp({ db, env });

  return { app, db };
}

/**
 * Test-data factory: generate valid invoice input from contract schema.
 * Zod-derived, stays in sync with contracts automatically (ADR-0005).
 * Uses generateId() from T4 to produce real prefixed ULIDs.
 */
export function createTestInvoice(
  overrides?: Partial<InvoiceCreateInput>
): InvoiceCreateInput {
  const seqNum = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");

  return invoiceCreateInput.parse({
    number: `INV-2026-${seqNum}`, // Matches documentNumber regex: INV-2026-00001
    customerId: generateId("cust"), // Real prefixed ULID: cust_01J8AUZC...
    customerName: "Test Customer",
    customerEmail: "test@example.com",
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
    currency: "USD",
    lineItems: [
      {
        lineNo: 1,
        description: "Test Item",
        quantity: 1,
        unitOfMeasure: "PCS",
        unitPrice: 10000, // $100.00 in minor units
        taxRateBps: 600, // 6%
        lineTotal: 10000,
        lineTaxAmount: 600,
      },
    ],
    subtotal: 10000,
    totalTax: 600,
    total: 10600,
    ...overrides,
  });
}
