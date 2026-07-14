/**
 * API entry point: pure factory pattern per ADR-0003, ADR-0005.
 *
 * Composition happens here only. No I/O at module load time.
 * createApp(deps) is testable via app.request(); actual server setup deferred to runtime bootstrap.
 *
 * Environment: zod-validated fail-fast (env.ts).
 * Request context: two-level per ADR-0003 (app deps injected in middleware).
 * Error handling: ONE errorHandler mapping AppError → HTTP per ADR-0004.
 * Audit: written at command door via middleware per ADR-0010.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import type { Context } from "hono";
import {
  isAppError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
  httpStatusFromError,
} from "@kongmy-stack/core";
import type { DbInstance } from "@kongmy-stack/db";
import { routes } from "./routes/index.js";
import { loadEnv } from "./env.js";

export const env = loadEnv();

// ============================================================================
// Context Type
// ============================================================================

/**
 * Two-level context per ADR-0003.
 * App-level deps (db, etc.) injected once at startup.
 * Request-level data (tenant, user, request-id) added per request.
 */
export interface AppContext {
  // App-level deps (from main.ts)
  db: DbInstance;
  env: typeof env;

  // Request-level data (from middleware)
  requestId: string;
  traceId: string;
  tenant: {
    orgId: string;
    branchId: string;
  };
  user: {
    id: string;
    roles: string[]; // role names
  };
  authz: {
    can(permission: string): boolean;
    assert(permission: string): void;
  };
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
}

export type AppBindings = {
  Variables: AppContext;
};

// ============================================================================
// Error Handler
// ============================================================================

/**
 * ONE errorHandler per ADR-0004, ADR-0010.
 * Maps AppError → HTTP envelope + request-id echo.
 * Logs errors with trace-id + request-id for correlation.
 */
function errorHandler(err: Error, ctx: Context<AppBindings>) {
  const requestId = (ctx.get?.("requestId") as string | undefined) || "unknown";
  const traceId = (ctx.get?.("traceId") as string | undefined) || "unknown";
  const logger = ctx.get?.("logger");

  if (isAppError(err)) {
    const status = httpStatusFromError(err);
    const response = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
      traceId,
    };

    logger?.error?.("request_error", {
      code: err.code,
      status,
      message: err.message,
      path: ctx.req.path,
      method: ctx.req.method,
      requestId,
      traceId,
    });

    return ctx.json(response, status as any);
  }

  // Unhandled error → 500 with code only (sanitized)
  const response = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal error occurred",
    },
    requestId,
    traceId,
  };

  logger?.error?.("unhandled_error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: ctx.req.path,
    method: ctx.req.method,
    requestId,
    traceId,
  });

  return ctx.json(response, 500 as any);
}

// ============================================================================
// Context Middleware
// ============================================================================

/**
 * Per-request context construction middleware.
 * Adds tenant, user, authz, logger, tracing to ctx.
 *
 * In a real app:
 * - tenant loaded from session/JWT claim
 * - user loaded from session
 * - roles/permissions fetched from db (or cached)
 * - logger is a structured instance (pino/winston/etc)
 * - tracing: W3C traceparent parsed/generated, span created
 *
 * For contract tests: minimal mock setup suffices.
 */
async function contextMiddleware(
  ctx: Context<AppBindings>,
  next: () => Promise<void>
) {
  // Mock context setup for testing; real impl would load from session, JWT, etc.
  // No session at all (mock signal: x-anonymous) → 401 through the one errorHandler.
  if (ctx.req.header("x-anonymous") === "true") {
    throw new UnauthorizedError("No active session");
  }
  const requestId = ctx.req.header("x-request-id") || `req_${Date.now()}`;
  const traceId = ctx.req.header("traceparent")?.split("-")[1] || `trace_${Date.now()}`;

  const mockTenant = {
    orgId: ctx.req.header("x-org-id") || "org_test",
    branchId: ctx.req.header("x-branch-id") || "branch_main",
  };

  const mockUser = {
    id: ctx.req.header("x-user-id") || "user_test",
    roles: (ctx.req.header("x-roles") || "user").split(",").filter(Boolean),
  };

  const mockAuthz = {
    can: (_perm: string) => {
      // Mock: only admin role can do things. In real impl: check permission set from roles.
      return mockUser.roles.includes("admin");
    },
    assert: (perm: string) => {
      if (!mockAuthz.can(perm)) {
        throw new ForbiddenError(`Permission denied: ${perm}`);
      }
    },
  };

  const mockLogger = {
    info: (msg: string, data?: Record<string, unknown>) => {
      console.log(JSON.stringify({ level: "info", message: msg, requestId, traceId, ...data }));
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      console.error(JSON.stringify({ level: "error", message: msg, requestId, traceId, ...data }));
    },
  };

  ctx.set("requestId", requestId);
  ctx.set("traceId", traceId);
  ctx.set("tenant", mockTenant);
  ctx.set("user", mockUser);
  ctx.set("authz", mockAuthz);
  ctx.set("logger", mockLogger);

  await next();
}

// ============================================================================
// Factory
// ============================================================================

/**
 * createApp(deps): pure factory, testable via app.request().
 * No top-level I/O; no server listening here.
 * Routes, middleware, error handler wired; ready for testing or binding to runtime.
 */
export function createApp(deps: { db: DbInstance; env: typeof env }) {
  const app = new OpenAPIHono<AppBindings>({
    defaultHook: (result) => {
      // Convert OpenAPI validation errors to ValidationError so errorHandler maps to 422
      if (!result.success) {
        const details: Record<string, string[]> = {};
        for (const issue of result.error.issues) {
          const path = issue.path.join(".");
          if (!details[path]) details[path] = [];
          details[path].push(issue.message);
        }
        throw new ValidationError("Validation failed", details);
      }
    },
  });

  // Middleware stack
  app.use(logger());
  app.use(cors());

  // Context middleware: inject app deps + request-level data
  app.use("*", async (ctx, next) => {
    ctx.set("db", deps.db);
    ctx.set("env", deps.env);
    await contextMiddleware(ctx, next);
  });

  // Error handler (runs on exception)
  app.onError((err, ctx) => errorHandler(err, ctx));

  // ========================================================================
  // Health check (no auth required)
  // ========================================================================
  app.get("/health", (ctx) => {
    return ctx.json({
      ok: true,
      version: "0.0.1",
      checks: {
        db: "ok", // Real impl would ping the db
      },
    });
  });

  // ========================================================================
  // Invoice CRUD routes
  // ========================================================================

  // Register invoice resource (see routes/invoice.ts)
  routes.registerInvoice(app);

  // ========================================================================
  // OpenAPI docs per ADR-0011
  // ========================================================================

  // Manually serve a basic OpenAPI spec to avoid @hono/zod-openapi complexity issues
  app.get("/openapi.json", (ctx) => {
    const spec = {
      openapi: "3.0.0",
      info: {
        title: "kongmy-stack API",
        version: "0.0.1",
        description: "Contract-first API with invoice management",
      },
      servers: [
        { url: "http://localhost:3000", description: "Development" },
      ],
      paths: {
        "/health": {
          get: {
            summary: "Health check",
            responses: {
              200: {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        ok: { type: "boolean" },
                        version: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        "/invoices": {
          get: {
            summary: "List invoices",
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", default: 20 },
              },
              {
                name: "offset",
                in: "query",
                schema: { type: "integer", default: 0 },
              },
            ],
            responses: {
              200: {
                description: "List of invoices",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        data: {
                          type: "array",
                          items: { type: "object" },
                        },
                        meta: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
          },
          post: {
            summary: "Create invoice",
            requestBody: {
              content: { "application/json": { schema: { type: "object" } } },
            },
            responses: {
              201: {
                description: "Created",
                content: {
                  "application/json": {
                    schema: { type: "object" },
                  },
                },
              },
            },
          },
        },
        "/invoices/{id}": {
          get: {
            summary: "Get invoice",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: {
              200: {
                description: "Invoice",
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
            },
          },
          put: {
            summary: "Update invoice",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
            ],
            requestBody: {
              content: { "application/json": { schema: { type: "object" } } },
            },
            responses: {
              200: {
                description: "Updated",
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
            },
          },
          delete: {
            summary: "Delete invoice",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: {
              200: {
                description: "Deleted",
                content: {
                  "application/json": {
                    schema: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    };

    return ctx.json(spec);
  });

  return app;
}

// ============================================================================
// Runtime Bootstrap (for standalone server)
// ============================================================================

/**
 * Standalone server startup.
 * In a real deployment (systemd, Docker, Workers), this would be called.
 * For contract tests, createApp() alone suffices.
 */
async function startServer() {
  const { createInMemoryAdapter } = await import("@kongmy-stack/db");
  const db = await createInMemoryAdapter();

  const app = createApp({ db, env });

  const port = env.PORT || 3000;
  console.log(`Server starting on port ${port}...`);

  // Graceful shutdown per ADR-0005
  Bun.serve({
    port,
    fetch: app.fetch,
  });

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    // Close db connections
    if ("close" in db) {
      await (db as any).close();
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// Start if run directly
if (import.meta.main) {
  startServer().catch(console.error);
}
