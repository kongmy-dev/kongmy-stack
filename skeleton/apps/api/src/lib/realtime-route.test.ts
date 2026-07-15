/**
 * Realtime SSE endpoint contract tests (ADR-0006, ADR-0005)
 *
 * Tests:
 * 1. SSE endpoint requires authentication (401 for anonymous)
 * 2. Authenticated users can establish SSE connection
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { createTestApp } from "../test-utils.js";

describe("Realtime SSE Endpoint", () => {
  let testApp: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  it("GET /realtime returns 401 without authentication", async () => {
    const response = await testApp.app.request("/realtime", {
      headers: {
        "x-anonymous": "true",
      },
    });
    expect(response.status).toBe(401);

    const json = await response.json();
    expect(json.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /realtime accepts authenticated request (200 with SSE headers)", async () => {
    // Make authenticated request (via x-user-id header mock)
    const response = await testApp.app.request("/realtime", {
      headers: {
        "x-user-id": "user_123",
        "x-org-id": "org_456",
        "x-roles": "admin",
      },
    });

    // SSE connections return 200 + text/event-stream
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });
});
