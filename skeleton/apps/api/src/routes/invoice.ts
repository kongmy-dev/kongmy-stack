/**
 * Invoice CRUD routes with real DB integration.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  invoiceListItem,
  invoiceCreateInput,
  invoiceUpdateInput,
} from "@kongmy-stack/contract";
import { ValidationError } from "@kongmy-stack/core";
import type { AppBindings } from "../main.js";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
} from "../services/invoice.js";

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

  const sendRoute = createRoute({
    method: "post",
    path: "/invoices/:id/send",
    summary: "Send invoice",
    request: { params: z.object({ id: z.string().describe("Invoice ID") }) },
    responses: { 200: { description: "Sent", content: { "application/json": { schema: z.object({ id: z.string(), status: z.string() }) } } } },
  });

  app.openapi(sendRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const id = c.req.param("id") || "";
    return c.json(await sendInvoice(ctx, id));
  });
}
