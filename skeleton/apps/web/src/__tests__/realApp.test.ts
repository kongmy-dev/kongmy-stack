/**
 * Seam 6 proven against the REAL stack — no HTTP server, no fetch mocks:
 * the web client's injectable fetchFn routes requests straight into T5's
 * Hono app (createApp + PGlite in-memory adapter). The 422 envelope below is
 * produced by the real contract validator and real errorHandler.
 */
import { describe, expect, it, beforeAll } from "bun:test";
import { createTestAppWithRealAuth, createTestInvoice } from "../../../api/src/test-utils.js";
import { makeApiClient, ApiError, type ApiClient } from "../lib/api";
import { mapValidationErrorToForm } from "../lib/errorMapper";

let client: ApiClient;
let app: any;

beforeAll(async () => {
  const testApp = await createTestAppWithRealAuth();
  app = testApp.app;

  // Authenticate via real auth path: POST /auth/sign-in (seam 7)
  const signInRes = await app.request("/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@dev.local",
      password: "dev-admin-password",
    }),
  });

  // Extract session cookie from response
  let sessionCookie = "";
  const setCookieHeader = signInRes.headers.get("set-cookie");
  if (setCookieHeader) {
    sessionCookie = setCookieHeader.split(";")[0];
  }

  // Create client that forwards cookies in requests
  client = makeApiClient({
    baseUrl: "",
    fetchFn: ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (sessionCookie) {
        headers.set("Cookie", sessionCookie);
      }
      return app.request(input as string, { ...init, headers });
    }) as typeof fetch,
  });
});

describe("web client against the real API app", () => {
  it("happy path: create then list through the real stack", async () => {
    // zod-derived factory (ADR-0005): payload stays in sync with the contract
    const created = await client.invoices.create(
      createTestInvoice() as Record<string, unknown>
    );
    expect(created.id).toBeDefined();

    const list = await client.invoices.list({ limit: 20, offset: 0 });
    expect(list.data.length).toBeGreaterThanOrEqual(1);
    expect(list.meta.total as number).toBeGreaterThanOrEqual(1);
  });

  it("forced 422 from the real validator lands on the correct form field", async () => {
    const invalid = {
      ...(createTestInvoice() as Record<string, unknown>),
      lineItems: [], // invalid: service rejects empty line items
    };
    let caught: unknown;
    try {
      await client.invoices.create(invalid);
    } catch (err) {
      caught = err;
    }

    // The envelope came from the real errorHandler
    expect(ApiError.isValidationError(caught)).toBe(true);
    const apiErr = caught as ApiError;
    expect(apiErr.statusCode).toBe(422);
    expect(apiErr.details).toBeDefined();

    // ...and the mapper routes it to the right form field (seam 6)
    const setErrorCalls: Array<{ field: string; message: string }> = [];
    const recordSetError = (field: string, error: { message?: string }) => {
      setErrorCalls.push({ field, message: error.message ?? "" });
    };
    mapValidationErrorToForm(
      apiErr,
      recordSetError as Parameters<typeof mapValidationErrorToForm>[1]
    );
    expect(setErrorCalls.some((c) => c.field === "lineItems")).toBe(true);
  });

  it("unauthenticated request surfaces UNAUTHORIZED through the client", async () => {
    // Create anonymous client without session cookie (no Cookie header).
    // Pass x-anonymous header to signal mock auth should return null (seam 7 test protocol).
    const anonClient = makeApiClient({
      baseUrl: "",
      fetchFn: ((input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("x-anonymous", "true");
        return app.request(input as string, { ...init, headers });
      }) as typeof fetch,
    });

    let caught: unknown;
    try {
      await anonClient.invoices.list({ limit: 20, offset: 0 });
    } catch (err) {
      caught = err;
    }
    expect(ApiError.isUnauthorized(caught)).toBe(true);
    expect((caught as ApiError).statusCode).toBe(401);
  });
});
