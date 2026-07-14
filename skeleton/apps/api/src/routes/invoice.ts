/**
 * Invoice CRUD routes with real DB integration.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  invoiceListItem,
  invoiceCreateInput,
  invoiceUpdateInput,
  type InvoiceCreateInput,
  type InvoiceUpdateInput,
  type InvoiceListItem,
} from "@kongmy-stack/contract";
import { NotFoundError, ValidationError } from "@kongmy-stack/core";
import { invoiceRepo, generateId, type TenantScope } from "@kongmy-stack/db";
import type { AppBindings } from "../main.js";

// ============================================================================
// Service Layer
// ============================================================================

async function listInvoices(
  ctx: AppBindings["Variables"],
  query: { limit: number; offset: number }
) {
  ctx.authz.assert("invoice:read");

  const scope: TenantScope = {
    org: ctx.tenant.orgId,
    branch: ctx.tenant.branchId,
  };

  const result = await invoiceRepo.list(ctx.db, scope, {
    limit: query.limit,
    offset: query.offset,
  });

  const data: InvoiceListItem[] = result.items.map((inv) => ({
    id: inv.inv_id as any,
    number: inv.invoice_number as any,
    status: inv.status as any,
    customerName: inv.customer_name,
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
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

async function getInvoice(ctx: AppBindings["Variables"], id: string) {
  ctx.authz.assert("invoice:read");

  const scope: TenantScope = {
    org: ctx.tenant.orgId,
    branch: ctx.tenant.branchId,
  };

  const invoice = await invoiceRepo.getById(ctx.db, scope, id);
  if (!invoice) {
    throw new NotFoundError(`Invoice ${id} not found`);
  }

  return {
    id: invoice.inv_id,
    number: invoice.invoice_number,
    status: invoice.status,
    customerId: "cust_000000000000000000000000001" as any,
    customerName: invoice.customer_name,
    customerEmail: "customer@example.com",
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
    currency: "USD" as any,
    lineItems: [],
    subtotal: invoice.amount,
    totalTax: 0,
    total: invoice.amount,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

async function createInvoice(
  ctx: AppBindings["Variables"],
  input: InvoiceCreateInput
) {
  ctx.authz.assert("invoice:create");

  const scope: TenantScope = {
    org: ctx.tenant.orgId,
    branch: ctx.tenant.branchId,
  };

  if (!input.lineItems || input.lineItems.length === 0) {
    throw new ValidationError("At least one line item required", {
      lineItems: ["Cannot be empty"],
    });
  }

  const invoice = await invoiceRepo.create(ctx.db, scope, {
    branchId: scope.branch,
    invoiceNumber: input.number,
    customerName: input.customerName,
    amount: input.total,
    status: "draft",
  });

  // Audit write at command door
  const auditId = generateId("audit");
  const rawDb = (ctx.db as any).rawDb || ctx.db;
  await rawDb.exec(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
     VALUES ('${auditId}', '${scope.org}', '${ctx.user.id}', 'invoice:create', 'invoice', '${invoice.inv_id}', 'auto', NOW())`
  );

  ctx.logger.info("invoice_created", {
    invoiceId: invoice.inv_id,
    requestId: ctx.requestId,
    auditId,
  });

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

async function updateInvoice(
  ctx: AppBindings["Variables"],
  id: string,
  input: InvoiceUpdateInput
) {
  ctx.authz.assert("invoice:update");

  const scope: TenantScope = {
    org: ctx.tenant.orgId,
    branch: ctx.tenant.branchId,
  };

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

  const auditId = generateId("audit");
  const rawDb = (ctx.db as any).rawDb || ctx.db;
  await rawDb.exec(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
     VALUES ('${auditId}', '${scope.org}', '${ctx.user.id}', 'invoice:update', 'invoice', '${id}', 'auto', NOW())`
  );

  ctx.logger.info("invoice_updated", {
    invoiceId: id,
    requestId: ctx.requestId,
    auditId,
  });

  return {
    id: updated.inv_id,
    number: updated.invoice_number,
    status: updated.status,
    customerId: "cust_000000000000000000000000001" as any,
    customerName: updated.customer_name,
    customerEmail: "customer@example.com",
    issuedDate: "2026-01-01",
    dueDate: "2026-02-01",
    currency: "USD" as any,
    lineItems: [],
    subtotal: updated.amount,
    totalTax: 0,
    total: updated.amount,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  };
}

async function deleteInvoice(
  ctx: AppBindings["Variables"],
  id: string
) {
  ctx.authz.assert("invoice:delete");

  const scope: TenantScope = {
    org: ctx.tenant.orgId,
    branch: ctx.tenant.branchId,
  };

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

  const auditId = generateId("audit");
  const rawDb = (ctx.db as any).rawDb || ctx.db;
  await rawDb.exec(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
     VALUES ('${auditId}', '${scope.org}', '${ctx.user.id}', 'invoice:delete', 'invoice', '${id}', 'auto', NOW())`
  );

  ctx.logger.info("invoice_deleted", {
    invoiceId: id,
    requestId: ctx.requestId,
    auditId,
  });

  return { success: true };
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerInvoice(app: any) {
  const getListRoute = createRoute({
    method: "get",
    path: "/invoices",
    summary: "List invoices",
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).optional().default(20),
        offset: z.coerce.number().int().min(0).optional().default(0),
      }),
    },
    responses: {
      200: {
        description: "Invoices",
        content: {
          "application/json": {
            schema: z.object({
              data: z.array(invoiceListItem).describe("List of invoices"),
              meta: z.object({
                limit: z.number(),
                offset: z.number(),
                total: z.number(),
                hasMore: z.boolean(),
              }).describe("Pagination metadata"),
            }).describe("List response"),
          },
        },
      },
    },
  });

  app.openapi(getListRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const query = c.req.valid("query");
    return c.json(await listInvoices(ctx, query));
  });

  const getOneRoute = createRoute({
    method: "get",
    path: "/invoices/:id",
    summary: "Get invoice",
    request: { params: z.object({ id: z.string().describe("Invoice ID") }) },
    responses: {
      200: {
        description: "Invoice",
        content: { "application/json": { schema: z.object({ id: z.string() }) } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: z.object({ error: z.object({ code: z.string() }) }) } },
      },
    },
  });

  app.openapi(getOneRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const id = c.req.param("id") || "";
    return c.json(await getInvoice(ctx, id));
  });

  const postRoute = createRoute({
    method: "post",
    path: "/invoices",
    summary: "Create invoice",
    request: { body: { content: { "application/json": { schema: invoiceCreateInput } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: z.object({ id: z.string() }) } } },
      422: {
        description: "Validation error",
        content: {
          "application/json": {
            schema: z.object({
              error: z.object({
                code: z.string(),
                details: z.record(z.string(), z.array(z.string())).optional(),
              }),
            }),
          },
        },
      },
    },
  });

  app.openapi(postRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    try {
      const body = await c.req.json();
      const parseResult = invoiceCreateInput.safeParse(body);
      if (!parseResult.success) {
        const details: Record<string, string[]> = {};
        for (const issue of parseResult.error.issues) {
          const path = issue.path.join(".");
          if (!details[path]) details[path] = [];
          details[path].push(issue.message);
        }
        throw new ValidationError("Validation failed", details);
      }
      return c.json(await createInvoice(ctx, parseResult.data), 201);
    } catch (err) {
      throw err;
    }
  });

  const putRoute = createRoute({
    method: "put",
    path: "/invoices/:id",
    summary: "Update invoice",
    request: {
      params: z.object({ id: z.string().describe("Invoice ID") }),
      body: { content: { "application/json": { schema: invoiceUpdateInput } } },
    },
    responses: { 200: { description: "Updated", content: { "application/json": { schema: z.object({ id: z.string() }) } } } },
  });

  app.openapi(putRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const id = c.req.param("id") || "";
    const body = await c.req.json();
    const parseResult = invoiceUpdateInput.safeParse(body);
    if (!parseResult.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join(".");
        if (!details[path]) details[path] = [];
        details[path].push(issue.message);
      }
      throw new ValidationError("Validation failed", details);
    }
    return c.json(await updateInvoice(ctx, id, parseResult.data));
  });

  const deleteRoute = createRoute({
    method: "delete",
    path: "/invoices/:id",
    summary: "Delete invoice",
    request: { params: z.object({ id: z.string().describe("Invoice ID") }) },
    responses: { 200: { description: "Deleted", content: { "application/json": { schema: z.object({ success: z.boolean() }) } } } },
  });

  app.openapi(deleteRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const id = c.req.param("id") || "";
    return c.json(await deleteInvoice(ctx, id));
  });
}
