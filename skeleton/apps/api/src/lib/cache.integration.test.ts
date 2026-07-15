/**
 * Cache middleware integration test via main.ts
 *
 * This test verifies that the cache middleware is actually wired into the app
 * and that removing it from main.ts causes this test to fail.
 *
 * Falsifiability pair:
 * 1. WITH middleware in main.ts: /health has Cache-Control: no-store ✓
 * 2. WITHOUT middleware in main.ts: /health lacks Cache-Control: no-store ✗
 */

import { describe, it, expect } from "bun:test";
import { createInMemoryAdapter } from "@kongmy-stack/db";
import { createApp, env } from "../main.js";

describe("Cache Middleware Integration (via main.ts)", () => {
  it("GET /health response has Cache-Control: no-store header (proves middleware is wired)", async () => {
    const db = await createInMemoryAdapter();
    const app = createApp({ db, env });

    const response = await app.request("/health", {
      headers: { "x-anonymous": "true" },
    });

    expect(response.status).toBe(200);
    // THIS TEST MUST FAIL if cache middleware is removed from main.ts line 272
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
