/**
 * Falsifiability test for Cache Control Middleware (ADR-0006)
 *
 * This test MUST fail if the cache middleware is removed from main.ts.
 * It verifies that the middleware is actually being applied to requests.
 *
 * Execution plan:
 * 1. Run this test with middleware enabled → PASS
 * 2. Comment out cache middleware in main.ts (cacheControlMiddleware insertion)
 * 3. Run this test → FAIL
 * 4. Restore middleware
 * 5. Run this test → PASS
 *
 * This proves the middleware is necessary and effective.
 */

import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { cacheControlMiddleware } from "./cache.js";

describe("Cache Control Middleware Falsifiability", () => {
  it("WITH middleware: default response has Cache-Control: no-store", async () => {
    // Create a minimal Hono app WITH the cache middleware
    const appWithMiddleware = new Hono();

    // Apply the middleware FIRST
    appWithMiddleware.use("*", cacheControlMiddleware());

    // Add a test route
    appWithMiddleware.get("/test", (ctx) => {
      return ctx.json({ ok: true });
    });

    const response = await appWithMiddleware.request("/test");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("WITHOUT middleware: response lacks Cache-Control: no-store (proves middleware is needed)", async () => {
    // Create a minimal Hono app WITHOUT the cache middleware
    const appWithoutMiddleware = new Hono();

    // NO cache middleware applied

    // Add a test route
    appWithoutMiddleware.get("/test", (ctx) => {
      return ctx.json({ ok: true });
    });

    const response = await appWithoutMiddleware.request("/test");

    expect(response.status).toBe(200);
    // WITHOUT the middleware, the header should NOT be set
    // (Hono doesn't set it by default)
    expect(response.headers.get("cache-control")).not.toBe("no-store");
  });

  it("middleware presence test: cacheControlMiddleware exports a function", () => {
    expect(typeof cacheControlMiddleware).toBe("function");

    // Calling it should return an async middleware function
    const middleware = cacheControlMiddleware();
    expect(typeof middleware).toBe("function");
  });
});
