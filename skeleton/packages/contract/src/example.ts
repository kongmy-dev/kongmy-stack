import { z } from "zod";
import {
  id,
  money,
  dateTime,
  dateOnly,
  documentNumber,
  email,
  auditStamp,
  basisPoints,
  currencyCode,
} from "./scalars.js";
import {
  resource,
  action,
} from "./helpers.js";
import {
  documentLifecycle,
  documentStatus,
} from "./document-lifecycle.js";

/**
 * Example: Invoice resource contract
 *
 * Demonstrates all contract patterns:
 * - Scalars with describe()
 * - CRUD routes via resource()
 * - Document lifecycle (post/cancel actions)
 * - Custom actions (send, resend)
 * - Permission derivation
 * - Error codes
 *
 * This is the SSOT for: API routes, OpenAPI doc, MCP tools, generated clients, forms, URL state
 */

// ============================================================================
// Invoice Scalars
// ============================================================================

const invoiceId = id("inv");
const customerId = id("cust");

/**
 * Invoice line item (immutable within line set)
 */
const invoiceLineItem = z
  .object({
    lineNo: z
      .number()
      .int()
      .positive()
      .describe("Line item sequence number"),
    description: z
      .string()
      .min(1)
      .max(500)
      .describe("Line item description"),
    quantity: z
      .number()
      .positive()
      .describe("Quantity (in unit of measure)"),
    unitOfMeasure: z
      .enum(["PCS", "KG", "L", "M", "H"])
      .describe("Unit of measure"),
    unitPrice: money.describe("Price per unit (in minor currency units)"),
    taxRateBps: basisPoints
      .describe("Tax rate in basis points (e.g., 600 = 6%)"),
    lineTotal: money.describe("Subtotal: quantity × unitPrice"),
    lineTaxAmount: money.describe("Tax on line item"),
  })
  .describe("Invoice line item with quantity, pricing, and tax");

export type InvoiceLineItem = z.infer<typeof invoiceLineItem>;

// ============================================================================
// Invoice State Schemas
// ============================================================================

/**
 * Invoice in draft state (editable)
 */
export const invoiceDraft = z
  .object({
    id: invoiceId,
    number: documentNumber.describe("Invoice number (e.g., INV-2026-00042)"),
    status: documentStatus.describe("draft (editable)"),
    customerId: customerId,
    customerName: z.string().describe("Customer display name"),
    customerEmail: email.describe("Customer email for sending"),
    issuedDate: dateOnly.describe("Invoice issue date"),
    dueDate: dateOnly.describe("Payment due date"),
    currency: currencyCode.describe("Invoice currency"),
    lineItems: z
      .array(invoiceLineItem)
      .min(1)
      .describe("Array of line items"),
    subtotal: money.describe("Sum of lineTotal across all items"),
    totalTax: money.describe("Sum of lineTaxAmount"),
    total: money.describe("Subtotal + tax"),
    notes: z
      .string()
      .max(1000)
      .optional()
      .describe("Additional notes"),
    ...auditStamp.shape,
  })
  .describe("Invoice in draft state (fully editable)");

export type InvoiceDraft = z.infer<typeof invoiceDraft>;

/**
 * Invoice in posted state (immutable)
 * Same structure as draft, but marked posted
 */
export const invoicePosted = invoiceDraft
  .pick({
    id: true,
    number: true,
    customerId: true,
    customerName: true,
    customerEmail: true,
    issuedDate: true,
    dueDate: true,
    currency: true,
    lineItems: true,
    subtotal: true,
    totalTax: true,
    total: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    status: z.literal("posted").describe("posted (immutable)"),
    postedAt: dateTime
      .describe("Timestamp when posted"),
  })
  .describe("Invoice in posted state (immutable, corrections via reversals)");

export type InvoicePosted = z.infer<typeof invoicePosted>;

/**
 * Invoice list item (summary for tables)
 */
export const invoiceListItem = invoiceDraft
  .pick({
    id: true,
    number: true,
    status: true,
    customerName: true,
    issuedDate: true,
    dueDate: true,
    total: true,
    createdAt: true,
  })
  .describe("Invoice summary for list/table views");

export type InvoiceListItem = z.infer<typeof invoiceListItem>;

/**
 * Invoice create input (client submits without id/status/audit fields)
 */
export const invoiceCreateInput = invoiceDraft
  .omit({
    id: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  })
  .describe("Invoice creation input (POST /invoices)");

export type InvoiceCreateInput = z.infer<typeof invoiceCreateInput>;

/**
 * Invoice update input (draft state only, subset of fields)
 */
export const invoiceUpdateInput = invoiceCreateInput
  .partial()
  .describe("Invoice update input (PUT /invoices/{id}, draft only)");

export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateInput>;

// ============================================================================
// CRUD Contract
// ============================================================================

export const invoiceResource = resource({
  name: "invoice",
  summary: "Sales invoice",
  description: "Accounting-grade sales invoice with draft→posted→cancelled lifecycle",
  listSchema: invoiceListItem,
  getSchema: invoiceDraft, // GET returns draft or posted state
  createSchema: invoiceCreateInput,
  updateSchema: invoiceUpdateInput,
  errorCodes: [
    "NOT_FOUND",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "BUSINESS_RULE_VIOLATION",
    "CONFLICT",
  ],
});

/**
 * Derived CRUD permissions:
 *   - invoice:read (GET /invoices, GET /invoices/{id})
 *   - invoice:create (POST /invoices)
 *   - invoice:update (PUT /invoices/{id}, draft state only)
 *   - invoice:delete (DELETE /invoices/{id}, draft state only)
 */

// ============================================================================
// Document Lifecycle: post & cancel actions
// ============================================================================

export const invoiceLifecycle = documentLifecycle({
  resource: "invoice",
  draftSchema: invoiceDraft,
  postedSchema: invoicePosted,
  validateBeforePost: z
    .object({
      lineItems: invoiceLineItem
        .array()
        .min(1)
        .describe("Must have at least one line item"),
      total: money.describe("Total must be > 0"),
    })
    .describe("Validation checks before posting invoice"),
  postSummary: "Post invoice (draft → posted, immutable)",
  cancelSummary: "Cancel invoice (mark void)",
});

/**
 * Derived lifecycle permissions:
 *   - invoice:post (POST /invoices/{id}/post)
 *   - invoice:cancel (POST /invoices/{id}/cancel)
 */

// ============================================================================
// Custom Actions: send & resend
// ============================================================================

const sendInvoiceInput = z
  .object({
    recipientEmail: email
      .describe("Email to send to (overrides customer email)")
      .optional(),
    note: z
      .string()
      .max(500)
      .optional()
      .describe("Custom message to include in email"),
  })
  .describe("Input for sending invoice via email");

export type SendInvoiceInput = z.infer<typeof sendInvoiceInput>;

const sendInvoiceOutput = z
  .object({
    id: invoiceId,
    sentAt: dateTime.describe("Timestamp of send"),
    sentTo: email.describe("Email address sent to"),
  })
  .describe("Response after successfully sending invoice");

export type SendInvoiceOutput = z.infer<typeof sendInvoiceOutput>;

export const sendInvoiceAction = action({
  name: "send",
  resource: "invoice",
  summary: "Send invoice to customer",
  description: "Send invoice via email to customer or specified recipient",
  inputSchema: sendInvoiceInput,
  outputSchema: sendInvoiceOutput,
  category: "write",
  errorCodes: [
    "NOT_FOUND",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "INVALID_STATE",
  ],
  autonomy: "assist",
});

/**
 * Derived action permission:
 *   - invoice:send (POST /invoices/{id}/send)
 */

// ============================================================================
// Summary: All Permissions Derived from This Contract
// ============================================================================

/**
 * Complete permission matrix for invoice resource:
 *
 * CRUD (resource helper):
 *   - invoice:read
 *   - invoice:create
 *   - invoice:update (draft-only, enforced in service)
 *   - invoice:delete (draft-only, enforced in service)
 *
 * Lifecycle (documentLifecycle helper):
 *   - invoice:post (draft → posted transition)
 *   - invoice:cancel (any → cancelled transition)
 *
 * Custom Actions (action helper):
 *   - invoice:send (email dispatch)
 *
 * Total: 7 permissions, all machine-derived from helper calls
 * No hand-written permission IDs anywhere.
 *
 * Rules enforced by contract + service layer:
 * - update/delete only allowed if status === 'draft'
 * - post only allowed if status === 'draft'
 * - cancel allowed from draft or posted
 * - posted documents immutable (all updates rejected at service layer)
 * - send only allowed if status === 'posted' (moot: posted → signed invoice in email)
 */
