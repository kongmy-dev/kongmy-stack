/**
 * Invoice service layer: authz at the command door, repo calls, audit writes.
 * Routes stay thin adapters; only services touch @kongmy-stack/db (ADR-0003,
 * enforced by dep-cruiser rule api-routes-no-db-repos).
 */

import {
  type InvoiceCreateInput,
  type InvoiceUpdateInput,
  type InvoiceListItem,
  type RealtimeEvent,
} from "@kongmy-stack/contract";
import { NotFoundError, ValidationError } from "@kongmy-stack/core";
import { invoiceRepo, generateId, type TenantScope } from "@kongmy-stack/db";
import type { AppBindings } from "../main.js";

type Ctx = AppBindings["Variables"];

/**
 * Helper: publish a realtime event for invoice mutations
 */
function publishInvoiceEvent(
  ctx: Ctx,
  type: RealtimeEvent["type"],
  resourceId: string,
  data?: Record<string, unknown>
) {
  const event: RealtimeEvent = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    type,
    resourceId,
    organizationId: ctx.tenant.orgId,
    timestamp: new Date().toISOString(),
    userId: ctx.user.id,
    data,
  };
  ctx.publisher.publish(event);
}

function scopeOf(ctx: Ctx): TenantScope {
  return { org: ctx.tenant.orgId, branch: ctx.tenant.branchId };
}

async function writeAudit(ctx: Ctx, action: string, resourceId: string) {
  const auditId = generateId("audit");
  const rawDb = (ctx.db as { rawDb?: { exec: (sql: string) => Promise<unknown> } }).rawDb;
  if (!rawDb) throw new Error("audit write requires rawDb executor");
  await rawDb.exec(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
     VALUES ('${auditId}', '${ctx.tenant.orgId}', '${ctx.user.id}', '${action}', 'invoice', '${resourceId}', 'auto', NOW())`
  );
  return auditId;
}

export async function listInvoices(
  ctx: Ctx,
  query: { limit: number; offset: number }
) {
  ctx.authz.assert("invoice:read");
  const scope = scopeOf(ctx);

  const result = await invoiceRepo.list(ctx.db, scope, {
    limit: query.limit,
    offset: query.offset,
  });

  const data: InvoiceListItem[] = result.items.map((inv) => ({
    id: inv.inv_id as InvoiceListItem["id"],
    number: inv.invoice_number as InvoiceListItem["number"],
    status: inv.status as InvoiceListItem["status"],
    customerName: inv.customer_name,
    issuedDate: inv.issued_date,
    dueDate: inv.due_date,
    total: inv.amount,
    createdAt: inv.created_at,
  }));

  return {
    data,
    meta: {
      limit: query.limit,
      offset: query.offset,
      total: result.total,
      hasMore: query.offset + query.limit < result.total,
    },
  };
}

export async function getInvoice(ctx: Ctx, id: string) {
  ctx.authz.assert("invoice:read");
  const scope = scopeOf(ctx);

  const invoice = await invoiceRepo.getById(ctx.db, scope, id);
  if (!invoice) {
    throw new NotFoundError(`Invoice ${id} not found`);
  }

  return {
    id: invoice.inv_id,
    number: invoice.invoice_number,
    status: invoice.status,
    customerId: "cust_000000000000000000000000001",
    customerName: invoice.customer_name,
    customerEmail: "customer@example.com",
    issuedDate: invoice.issued_date,
    dueDate: invoice.due_date,
    currency: "USD",
    lineItems: [],
    subtotal: invoice.amount,
    totalTax: 0,
    total: invoice.amount,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

export async function createInvoice(ctx: Ctx, input: InvoiceCreateInput) {
  ctx.authz.assert("invoice:create");
  const scope = scopeOf(ctx);

  if (!input.lineItems || input.lineItems.length === 0) {
    throw new ValidationError("At least one line item required", {
      lineItems: ["Cannot be empty"],
    });
  }

  const invoice = await invoiceRepo.create(ctx.db, scope, {
    branchId: scope.branch,
    invoiceNumber: input.number,
    customerName: input.customerName,
    issuedDate: input.issuedDate,
    dueDate: input.dueDate,
    amount: input.total,
    status: "draft",
  });

  const auditId = await writeAudit(ctx, "invoice:create", invoice.inv_id);
  ctx.logger.info("invoice_created", {
    invoiceId: invoice.inv_id,
    requestId: ctx.requestId,
    auditId,
  });

  // Publish realtime event for subscribers
  publishInvoiceEvent(ctx, "invoice_created", invoice.inv_id);

  return {
    id: invoice.inv_id,
    number: invoice.invoice_number,
    status: invoice.status,
    customerId: input.customerId,
    customerName: invoice.customer_name,
    customerEmail: input.customerEmail,
    issuedDate: input.issuedDate,
    dueDate: input.dueDate,
    currency: input.currency,
    lineItems: input.lineItems,
    subtotal: input.subtotal,
    totalTax: input.totalTax,
    total: invoice.amount,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

export async function updateInvoice(
  ctx: Ctx,
  id: string,
  input: InvoiceUpdateInput
) {
  ctx.authz.assert("invoice:update");
  const scope = scopeOf(ctx);

  const existing = await invoiceRepo.getById(ctx.db, scope, id);
  if (!existing) {
    throw new NotFoundError(`Invoice ${id} not found`);
  }

  if (existing.status !== "draft") {
    throw new ValidationError("Cannot update posted invoice", {
      status: ["Draft invoices only"],
    });
  }

  const updated = await invoiceRepo.update(ctx.db, scope, id, {
    customerName: input.customerName || existing.customer_name,
  });

  const auditId = await writeAudit(ctx, "invoice:update", id);
  ctx.logger.info("invoice_updated", {
    invoiceId: id,
    requestId: ctx.requestId,
    auditId,
  });

  // Publish realtime event for subscribers
  publishInvoiceEvent(ctx, "invoice_updated", id);

  return {
    id: updated.inv_id,
    number: updated.invoice_number,
    status: updated.status,
    customerId: "cust_000000000000000000000000001",
    customerName: updated.customer_name,
    customerEmail: "customer@example.com",
    issuedDate: updated.issued_date,
    dueDate: updated.due_date,
    currency: "USD",
    lineItems: [],
    subtotal: updated.amount,
    totalTax: 0,
    total: updated.amount,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}

export async function deleteInvoice(ctx: Ctx, id: string) {
  ctx.authz.assert("invoice:delete");
  const scope = scopeOf(ctx);

  const existing = await invoiceRepo.getById(ctx.db, scope, id);
  if (!existing) {
    throw new NotFoundError(`Invoice ${id} not found`);
  }

  if (existing.status !== "draft") {
    throw new ValidationError("Cannot delete posted invoice", {
      status: ["Draft invoices only"],
    });
  }

  await invoiceRepo.delete(ctx.db, scope, id);

  const auditId = await writeAudit(ctx, "invoice:delete", id);
  ctx.logger.info("invoice_deleted", {
    invoiceId: id,
    requestId: ctx.requestId,
    auditId,
  });

  // Publish realtime event for subscribers
  publishInvoiceEvent(ctx, "invoice_deleted", id);

  return { success: true };
}

export async function sendInvoice(ctx: Ctx, id: string) {
  ctx.authz.assert("invoice:send");
  const scope = scopeOf(ctx);

  const invoice = await invoiceRepo.getById(ctx.db, scope, id);
  if (!invoice) {
    throw new NotFoundError(`Invoice ${id} not found`);
  }

  // Autonomy gate: draft the notification (suggest level by default)
  // In a real app with autonomy=auto, this would actually send
  const notificationDraft = await ctx.notifier.draft({
    type: "email",
    recipient: "customer@example.com", // Would come from invoice in real app
    subject: `Invoice ${invoice.invoice_number}`,
    body: `Please find attached your invoice ${invoice.invoice_number}.`,
    metadata: {
      invoiceId: id,
      invoiceNumber: invoice.invoice_number,
    },
  });

  const auditId = await writeAudit(ctx, "invoice:send", id);
  ctx.logger.info("invoice_send_drafted", {
    invoiceId: id,
    draftId: notificationDraft.id,
    requestId: ctx.requestId,
    auditId,
  });

  // Publish realtime event for subscribers
  publishInvoiceEvent(ctx, "invoice_sent", id, {
    notificationDraftId: notificationDraft.id,
  });

  return {
    id: invoice.inv_id,
    status: invoice.status,
    notificationDraftId: notificationDraft.id,
    message: "Invoice send notification drafted",
  };
}
