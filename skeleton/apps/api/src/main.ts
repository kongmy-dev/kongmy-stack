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
import { registerAuth } from "./routes/auth.js";
import { registerRealtime } from "./routes/realtime.js";
import { betterAuthProvider, headerMockProvider } from "./lib/session.js";
import { inMemoryPublisher, type RealtimePublisher } from "./lib/realtime.js";
import { inMemoryNotifier, type Notifier } from "./lib/notifier.js";
import { loadEnv } from "./env.js";
import { invoiceResource, invoiceLifecycle, sendInvoiceAction } from "@kongmy-stack/contract";
import { extractTraceContext, type TraceContext } from "./lib/tracing.js";
import { createMeter, recordRequest, exportMetricsText, type Meter } from "./lib/metrics.js";

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
  publisher: RealtimePublisher;
  notifier: Notifier;

  // Request-level data (from middleware)
  requestId: string;
  trace: TraceContext; // W3C traceparent context per ADR-0010
  traceId: string; // Shorthand for trace.traceId (backward compat)
  session: any; // Session from provider (or null if not authenticated)
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
  meter: Meter; // Domain counters per ADR-0010
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
  const trace = (ctx.get?.("trace") as TraceContext | undefined);
  const traceId = trace?.traceId || "unknown";
  const spanId = trace?.spanId || "unknown";
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
      spanId,
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
    spanId,
  });

  return ctx.json(response, 500 as any);
}

// ============================================================================
// Context Middleware
// ============================================================================

/**
 * Per-request context construction middleware factory.
 * Adds tenant, user, authz, logger, tracing, session to ctx.
 *
 * Supports two session providers:
 * - headerMockProvider: For contract tests (x-user-id, x-org-id, x-roles headers)
 * - betterAuthProvider: For real auth (cookies, DB lookup)
 *
 * In a real app:
 * - tenant loaded from session/JWT claim
 * - user loaded from session
 * - roles/permissions fetched from db (or cached)
 * - logger is a structured instance (pino/winston/etc)
 * - tracing: W3C traceparent parsed/generated, span created
 */
function createContextMiddleware(sessionProvider: any) {
  return async function contextMiddleware(
    ctx: Context<AppBindings>,
    next: () => Promise<void>
  ) {
    const requestId = ctx.req.header("x-request-id") || `req_${Date.now()}`;

    // Extract or generate W3C traceparent per ADR-0010
    const incomingTraceparent = ctx.req.header("traceparent");
    const trace = extractTraceContext(incomingTraceparent);

    // Try to get session from provider
    const session = await sessionProvider.getSession(ctx);

    // If no session and x-anonymous is "true", allow (for /health, /openapi.json)
    // If no session and x-anonymous is NOT set, routes requiring auth will enforce
    if (!session && ctx.req.header("x-anonymous") === "true") {
      // Anonymous allowed for public endpoints
    }

    const mockTenant = {
      orgId: ctx.req.header("x-org-id") || (session?.organizationId) || "org_test",
      branchId: ctx.req.header("x-branch-id") || "branch_main",
    };

    const mockUser = {
      id: session?.userId || ctx.req.header("x-user-id") || "user_test",
      roles: session?.roles || (ctx.req.header("x-roles") || "user").split(",").filter(Boolean),
    };

    // Build authz from session permissions
    const sessionPermissions = session?.permissions || new Set<string>();
    const mockAuthz = {
      can: (perm: string) => sessionPermissions.has(perm),
      assert: (perm: string) => {
        // If no session, throw UnauthorizedError (auth required)
        if (!session) {
          throw new UnauthorizedError("No active session");
        }
        // If authenticated but permission missing, throw ForbiddenError
        if (!mockAuthz.can(perm)) {
          throw new ForbiddenError(`Permission denied: ${perm}`);
        }
      },
    };

    const mockLogger = {
      info: (msg: string, data?: Record<string, unknown>) => {
        console.log(JSON.stringify({ level: "info", message: msg, requestId, traceId: trace.traceId, spanId: trace.spanId, ...data }));
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        console.error(JSON.stringify({ level: "error", message: msg, requestId, traceId: trace.traceId, spanId: trace.spanId, ...data }));
      },
    };

    const meter = createMeter();

    ctx.set("requestId", requestId);
    ctx.set("trace", trace);
    ctx.set("traceId", trace.traceId); // Backward compat
    ctx.set("session", session);
    ctx.set("tenant", mockTenant);
    ctx.set("user", mockUser);
    ctx.set("authz", mockAuthz);
    ctx.set("logger", mockLogger);
    ctx.set("meter", meter);

    await next();
  };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * createApp(deps): pure factory, testable via app.request().
 * No top-level I/O; no server listening here.
 * Routes, middleware, error handler wired; ready for testing or binding to runtime.
 */
export function createApp(deps: {
  db: DbInstance;
  env: typeof env;
  sessionProvider?: any;
  publisher?: RealtimePublisher;
  notifier?: Notifier;
}) {
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

  // Metrics middleware: record RED metrics per ADR-0010
  // Records before + after the request, capturing status and duration
  app.use("*", async (ctx, next) => {
    const startTime = Date.now();
    let status = 200;

    try {
      await next();
      // After next() completes, status should be set by the response
      status = ctx.res.status || 200;
    } catch (err) {
      // If an error was thrown, it will be handled by errorHandler
      // We'll record the status here, but errorHandler might change it
      status = ctx.res.status || 500;
      throw err; // Re-throw for errorHandler to catch
    } finally {
      const durationMs = Date.now() - startTime;
      // If status is still default, check ctx.res one more time
      if (status === 200 && ctx.res.status) {
        status = ctx.res.status;
      }
      recordRequest(ctx.req.method, ctx.req.path, status, durationMs);

      // Set traceparent response header for downstream propagation
      const trace = ctx.get?.("trace") as TraceContext | undefined;
      if (trace) {
        ctx.header("traceparent", trace.traceparent());
      }
    }
  });

  // Determine session provider based on environment
  const sessionProvider = deps.sessionProvider || (
    deps.env.NODE_ENV === "test" ? headerMockProvider() : betterAuthProvider(deps.db)
  );

  // Create seam instances if not provided (for tests or standalone server)
  const publisher = deps.publisher || inMemoryPublisher();
  const notifier = deps.notifier || inMemoryNotifier();

  // Context middleware: inject app deps + request-level data
  const contextMiddleware = createContextMiddleware(sessionProvider);
  app.use("*", async (ctx, next) => {
    ctx.set("db", deps.db);
    ctx.set("env", deps.env);
    ctx.set("publisher", publisher);
    ctx.set("notifier", notifier);
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
  // Metrics endpoint (Prometheus text format, no auth required)
  // ========================================================================
  app.get("/metrics", (ctx) => {
    // Gate behind env flag or default to enabled for observability
    const metricsEnabled = deps.env.OTEL_TRACE_ENABLED === "true" || true;
    if (!metricsEnabled) {
      return ctx.text("Metrics disabled", 404);
    }
    return ctx.text(exportMetricsText(), 200, {
      "content-type": "text/plain; charset=utf-8",
    });
  });

  // ========================================================================
  // Authentication routes
  // ========================================================================
  registerAuth(app);

  // ========================================================================
  // Realtime SSE endpoint
  // ========================================================================
  registerRealtime(app, publisher);

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

  // Seed development data if not in production (ADR-0008)
  if (env.NODE_ENV !== "production") {
    const { seedDev } = await import("../../../scripts/seed-dev.ts");
    await seedDev(db, {
      read: invoiceResource.permissions.read,
      create: invoiceResource.permissions.create,
      update: invoiceResource.permissions.update,
      delete: invoiceResource.permissions.delete,
      post: invoiceLifecycle.post.permission,
      cancel: invoiceLifecycle.cancel.permission,
      send: sendInvoiceAction.permission,
    });
  }

  const app = createApp({ db, env });

  const port = env.PORT || 3000;
  console.log(`Server starting on port ${port}...`);

  // Graceful shutdown per ADR-0005
  Bun.serve({
    port,
    fetch: app.fetch,
    // Bun kills idle connections after 10s by default — that beheads every
    // SSE stream (/realtime). 0 disables the idle timeout; the SSE route's
    // 30s keep-alive still exists for intermediary proxies.
    idleTimeout: 0,
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
