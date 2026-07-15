/**
 * Invoice CRUD routes via registerResource (ADR-0001 constraint mechanism).
 * Custom action (send) remains hand-wired.
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { invoiceResource } from "@kongmy-stack/contract";
import type { AppBindings } from "../main.js";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
} from "../services/invoice.js";
import { registerResource } from "../lib/registerResource.js";

// ============================================================================
// CRUD Route Registration via registerResource
// ============================================================================

export function registerInvoice(app: any) {
  // Wire CRUD routes via registerResource
  // This handles: validation, authz.assert, audit write, realtime events
  registerResource(app, invoiceResource, {
    list: listInvoices,
    get: getInvoice,
    create: createInvoice,
    update: updateInvoice,
    delete: deleteInvoice,
  });

  // ========================================================================
  // Custom Action: send (hand-wired, not part of CRUD pattern)
  // ========================================================================

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
