/**
 * Cache control tests (ADR-0006)
 *
 * Tests:
 * 1. cacheControlMiddleware() sets default Cache-Control: no-store
 * 2. cacheable() helper overrides with public, max-age
 * 3. noCache() helper sets no-cache
 * 4. Validation: cacheable() throws on negative max-age
 */

import { describe, it, expect } from "bun:test";
import { cacheControlMiddleware, cacheable, noCache } from "./cache.js";

describe("Cache Control Helpers", () => {
  it("cacheControlMiddleware() sets Cache-Control: no-store", async () => {
    // Mock ctx to capture headers
    const headers: Record<string, string> = {};
    const mockCtx = {
      header: (key: string, value: string) => {
        headers[key.toLowerCase()] = value;
      },
    };

    const middleware = cacheControlMiddleware();
    const nextCalled = { value: false };

    await middleware(mockCtx as any, async () => {
      nextCalled.value = true;
    });

    expect(nextCalled.value).toBe(true);
    expect(headers["cache-control"]).toBe("no-store");
  });

  it("cacheable() overrides with public, max-age", () => {
    const headers: Record<string, string> = {};
    const mockCtx = {
      header: (key: string, value: string) => {
        headers[key.toLowerCase()] = value;
      },
    };

    cacheable(mockCtx as any, 3600);
    expect(headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("noCache() sets no-cache", () => {
    const headers: Record<string, string> = {};
    const mockCtx = {
      header: (key: string, value: string) => {
        headers[key.toLowerCase()] = value;
      },
    };

    noCache(mockCtx as any);
    expect(headers["cache-control"]).toBe("no-cache");
  });

  it("cacheable() validates max-age >= 0", () => {
    const mockCtx = {
      header: () => {},
    };

    // Should not throw for 0
    expect(() => {
      cacheable(mockCtx as any, 0);
    }).not.toThrow();

    // Should throw for negative
    expect(() => {
      cacheable(mockCtx as any, -1);
    }).toThrow("max-age must be >= 0");
  });
});
