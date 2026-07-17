/**
 * registerResource: wires a ResourceContract + service handlers into CRUD routes
 * per ADR-0001 (type-level constraint), ADR-0004 (API design), ADR-0008 (authz),
 * ADR-0010 (audit + realtime).
 *
 * Usage:
 *   registerResource(app, invoiceResource, {
 *     list: listInvoices,
 *     get: getInvoice,
 *     create: createInvoice,
 *     update: updateInvoice,
 *     delete: deleteInvoice,
 *   });
 *
 * Registers 5 routes with:
 * - Contract validation (via createRoute + defaultHook)
 * - Permission check at command door (ctx.authz.assert)
 * - Audit write on mutations (via writeAudit helper)
 * - Realtime event publish on mutations (via ctx.publisher)
 *
 * Route shapes per ADR-0004:
 * - Single resource: bare object
 * - List: { data, meta }
 * - Errors: { error: { code, message, details } } + requestId
 */

import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ValidationError } from "@kongmy-stack/core";
import { generateId } from "@kongmy-stack/db";
import type { ResourceContract } from "@kongmy-stack/contract";
import type { AppBindings } from "../main.js";

/**
 * Service handler signatures (compile-time contract).
 * Missing any handler = type error (ADR-0001).
 */
export interface ResourceServiceHandlers {
  list(
    ctx: AppBindings["Variables"],
    query: { limit: number; offset: number }
  ): Promise<{
    data: unknown[];
    meta: { limit: number; offset: number; total: number; hasMore: boolean };
  }>;

  get(ctx: AppBindings["Variables"], id: string): Promise<unknown>;

  create(
    ctx: AppBindings["Variables"],
    input: unknown
  ): Promise<unknown>;

  update(
    ctx: AppBindings["Variables"],
    id: string,
    input: unknown
  ): Promise<unknown>;

  delete(ctx: AppBindings["Variables"], id: string): Promise<{ success: boolean }>;
}

/**
 * Helper: write audit log at command door
 * Called for all mutations (create, update, delete)
 */
async function writeAudit(
  ctx: AppBindings["Variables"],
  action: string,
  resourceId: string,
  resourceName: string
) {
  const auditId = generateId("audit");
  const rawDb = (ctx.db as { rawDb?: { exec: (sql: string) => Promise<unknown> } }).rawDb;
  if (!rawDb) throw new Error("audit write requires rawDb executor");
  await rawDb.exec(
    `INSERT INTO audit_log (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
     VALUES ('${auditId}', '${ctx.tenant.orgId}', '${ctx.user.id}', '${action}', '${resourceName}', '${resourceId}', 'auto', NOW())`
  );
  return auditId;
}

/**
 * Helper: publish realtime event on mutation
 */
function publishMutationEvent(
  ctx: AppBindings["Variables"],
  eventType: string,
  resourceId: string,
  _resourceName: string
) {
  const event = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    type: eventType as any, // Type is dynamic based on resource name
    resourceId,
    organizationId: ctx.tenant.orgId,
    timestamp: new Date().toISOString(),
    userId: ctx.user.id,
  };
  ctx.publisher.publish(event);
}

/**
 * Contract docs fields, with absent ones omitted rather than set to undefined.
 * createRoute declares `summary?: string`, so an explicit `undefined` is not assignable under
 * exactOptionalPropertyTypes — the key has to be absent, not present-and-undefined.
 */
function routeDocs(route: {
  summary?: string | undefined;
  description?: string | undefined;
}) {
  return {
    ...(route.summary !== undefined && { summary: route.summary }),
    ...(route.description !== undefined && { description: route.description }),
  };
}

/**
 * registerResource: wire a ResourceContract + handlers into CRUD routes
 *
 * Constraints (compile-time, per ADR-0001):
 * - All 5 handlers must be present (missing = TS error)
 * - Handlers must match the ResourceServiceHandlers interface exactly
 *
 * Routes wired:
 * 1. GET /{resources}?limit&offset → list
 * 2. GET /{resources}/:id → get
 * 3. POST /{resources} → create (201 on success)
 * 4. PUT /{resources}/:id → update
 * 5. DELETE /{resources}/:id → delete
 *
 * Per-route behavior:
 * - Validation: defaultHook converts schema errors to 422
 * - AuthZ: authz.assert(permission) at command door (both sides)
 * - Audit: written for mutations only
 * - Realtime: events published for mutations only
 * - Errors: via ONE errorHandler (main.ts)
 */
export function registerResource(
  app: any,
  contract: ResourceContract,
  handlers: ResourceServiceHandlers
) {
  const resourceName = contract.name;
  const resourceNamePlural = `${resourceName}s`;

  // ========================================================================
  // LIST (GET /{resources}?limit&offset)
  // ========================================================================

  // Query parameters need z.coerce for HTTP string-to-number conversion
  // Contract's paginationQuery is for service layer; route layer needs coerced version
  const listQuerySchema = z
    .object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .optional()
        .default(0),
    });

  const listRoute = createRoute({
    method: "get",
    path: `/${resourceNamePlural}`,
    ...routeDocs(contract.listRoute),
    request: {
      query: listQuerySchema,
    },
    responses: {
      200: {
        description: `List of ${resourceName}s`,
        content: {
          "application/json": {
            schema: contract.listRoute.outputSchema,
          },
        },
      },
    },
  });

  app.openapi(listRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    ctx.authz.assert(contract.permissions.read);
    const query = c.req.valid("query");
    return c.json(await handlers.list(ctx, query));
  });

  // ========================================================================
  // GET (GET /{resources}/:id)
  // ========================================================================

  const getRoute = createRoute({
    method: "get",
    path: `/${resourceNamePlural}/:id`,
    ...routeDocs(contract.getRoute),
    request: {
      params: z.object({
        id: z.string().describe(`${resourceName} ID`),
      }),
    },
    responses: {
      200: {
        description: `Single ${resourceName}`,
        content: {
          "application/json": {
            schema: contract.getRoute.outputSchema,
          },
        },
      },
    },
  });

  app.openapi(getRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    ctx.authz.assert(contract.permissions.read);
    const id = c.req.param("id") || "";
    return c.json(await handlers.get(ctx, id));
  });

  // ========================================================================
  // CREATE (POST /{resources})
  // ========================================================================

  const createResourceRoute = createRoute({
    method: "post",
    path: `/${resourceNamePlural}`,
    ...routeDocs(contract.createRoute),
    request: {
      body: {
        content: {
          "application/json": {
            schema: contract.createRoute.inputSchema || z.object({}),
          },
        },
      },
    },
    responses: {
      201: {
        description: `Created ${resourceName}`,
        content: {
          "application/json": {
            schema: contract.createRoute.outputSchema,
          },
        },
      },
    },
  });

  app.openapi(createResourceRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    ctx.authz.assert(contract.permissions.create);

    const body = await c.req.json();
    const parseResult = contract.createRoute.inputSchema!.safeParse(body);
    if (!parseResult.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join(".");
        if (!details[path]) details[path] = [];
        details[path].push(issue.message);
      }
      throw new ValidationError("Validation failed", details);
    }

    const result = await handlers.create(ctx, parseResult.data);

    // Write audit and publish event for create
    const resourceId = (result as any).id;
    if (resourceId) {
      await writeAudit(ctx, contract.permissions.create, resourceId, resourceName);
      publishMutationEvent(
        ctx,
        `${resourceName}_created`,
        resourceId,
        resourceName
      );
    }

    return c.json(result, 201);
  });

  // ========================================================================
  // UPDATE (PUT /{resources}/:id)
  // ========================================================================

  const updateRoute = createRoute({
    method: "put",
    path: `/${resourceNamePlural}/:id`,
    ...routeDocs(contract.updateRoute),
    request: {
      params: z.object({
        id: z.string().describe(`${resourceName} ID`),
      }),
      body: {
        content: {
          "application/json": {
            schema: contract.updateRoute.inputSchema || z.object({}),
          },
        },
      },
    },
    responses: {
      200: {
        description: `Updated ${resourceName}`,
        content: {
          "application/json": {
            schema: contract.updateRoute.outputSchema,
          },
        },
      },
    },
  });

  app.openapi(updateRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    ctx.authz.assert(contract.permissions.update);

    const id = c.req.param("id") || "";
    const body = await c.req.json();
    const parseResult = contract.updateRoute.inputSchema!.safeParse(body);
    if (!parseResult.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parseResult.error.issues) {
        const path = issue.path.join(".");
        if (!details[path]) details[path] = [];
        details[path].push(issue.message);
      }
      throw new ValidationError("Validation failed", details);
    }

    const result = await handlers.update(ctx, id, parseResult.data);

    // Write audit and publish event for update
    await writeAudit(ctx, contract.permissions.update, id, resourceName);
    publishMutationEvent(
      ctx,
      `${resourceName}_updated`,
      id,
      resourceName
    );

    return c.json(result);
  });

  // ========================================================================
  // DELETE (DELETE /{resources}/:id)
  // ========================================================================

  const deleteRoute = createRoute({
    method: "delete",
    path: `/${resourceNamePlural}/:id`,
    ...routeDocs(contract.deleteRoute),
    request: {
      params: z.object({
        id: z.string().describe(`${resourceName} ID`),
      }),
    },
    responses: {
      200: {
        description: `Deleted ${resourceName}`,
        content: {
          "application/json": {
            schema: contract.deleteRoute.outputSchema,
          },
        },
      },
    },
  });

  app.openapi(deleteRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    ctx.authz.assert(contract.permissions.delete);

    const id = c.req.param("id") || "";
    const result = await handlers.delete(ctx, id);

    // Write audit and publish event for delete
    await writeAudit(ctx, contract.permissions.delete, id, resourceName);
    publishMutationEvent(
      ctx,
      `${resourceName}_deleted`,
      id,
      resourceName
    );

    return c.json(result);
  });
}
