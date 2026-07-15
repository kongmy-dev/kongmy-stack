/**
 * HTTP Caching Helper (ADR-0006)
 *
 * Default: all responses carry `Cache-Control: no-store` (no caching).
 * Opt-in: routes can call `cacheable(ctx, seconds)` to set cache headers for public reads.
 *
 * Per ADR-0004: cache is reserved for public, read-only resources (no auth required).
 * Private data always carries no-store, even if cacheable() is called.
 *
 * Middleware inserted in main.ts early in the stack (after logger/cors).
 */

import type { Context } from "hono";
import type { AppBindings } from "../main.js";

/**
 * Middleware: default all responses to Cache-Control: no-store.
 * This runs early in the middleware stack to set the default cache headers.
 */
export function cacheControlMiddleware() {
  return async (
    ctx: Context<AppBindings>,
    next: () => Promise<void>
  ) => {
    // Set default: no-store on all responses
    ctx.header("Cache-Control", "no-store");
    await next();
  };
}

/**
 * Helper: opt routes into cache for public reads.
 * Call from a route handler to override the default no-store with cacheable headers.
 *
 * Example:
 *   app.get("/public-data", async (ctx) => {
 *     cacheable(ctx, 3600); // Cache for 1 hour
 *     return ctx.json({ data: "..." });
 *   });
 *
 * Rules:
 * - Only use for unauthenticated routes (public reads)
 * - Sets Cache-Control: public, max-age=<seconds>
 * - If route requires auth, do NOT call cacheable() (default no-store protects private data)
 */
export function cacheable(ctx: Context<AppBindings>, seconds: number): void {
  if (seconds < 0) {
    throw new Error("cacheable: max-age must be >= 0");
  }
  ctx.header("Cache-Control", `public, max-age=${seconds}`);
}

/**
 * Helper: explicitly no-cache (must revalidate but allows conditional requests).
 * Useful for resources that change frequently but have strong ETags.
 * Rarely used; no-store is the safe default.
 */
export function noCache(ctx: Context<AppBindings>): void {
  ctx.header("Cache-Control", "no-cache");
}
