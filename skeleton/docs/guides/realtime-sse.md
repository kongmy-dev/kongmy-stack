# ADR-0006 Realtime SSE Implementation Guide

**Status:** Completed (Wave B, T1)  
**Decision Date:** 2026-07-15  
**Context:** Template needs real-time updates for invoice mutations to demonstrate scalability; dogfood with the skeleton's own invoice feature.

## What Was Decided

- **Default transport:** Server-Sent Events (SSE) over HTTP, not WebSockets
- **Pattern:** Query-invalidation-over-payload-as-state — event type drives cache invalidation, not the payload
- **Organization scoping:** Events published to subscribers in the same organization only
- **Autonomy gate:** Notifier produces drafts; caller decides whether to send (suggest level default)

## Why SSE

1. **Browser native:** EventSource API, no library needed; automatic reconnect with backoff
2. **Same-origin cookies:** Vite dev proxy + production routing are transparent; no token-in-query-param workarounds
3. **Stateless server:** Each connection is independent; horizontal scaling is trivial
4. **Fallback:** If EventSource not supported (rare), page still works; just slower (polling via query refetch)

Alternative considered: WebSockets (Socket.IO/ws library) adds connection complexity, stateful server requirements, and library bloat for the skeleton. Deferred to later phase when real-time latency requirements demand it.

## Implementation

### Backend Seams

**File:** `skeleton/apps/api/src/lib/realtime.ts`

```typescript
export interface RealtimePublisher {
  publish(event: RealtimeEvent): void;
  subscribe(organizationId: string, subscriber: Subscriber): () => void;
  getSubscribers(organizationId: string): Subscriber[];
  clearSubscribers(): void;
}
```

**Adapter:** `inMemoryPublisher()` — maintains per-org subscriber registry. For production, replace with Redis Pub/Sub or Kafka.

**File:** `skeleton/apps/api/src/routes/realtime.ts`

```typescript
app.openapi(route, async (c) => {
  const ctx = c.var as AppBindings["Variables"];
  if (!ctx.session) throw new UnauthorizedError("...");
  
  return streamSSE(c, async (stream) => {
    const unsubscribe = publisher.subscribe(ctx.tenant.orgId, async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
        id: event.eventId,
        event: event.type,
      });
    });
    // Stream stays open until client closes; unsubscribe on abort
  });
});
```

**Contract:** `skeleton/packages/contract/src/realtime.ts`

```typescript
export const realtimeEventSchema = z.object({
  eventId: z.string().describe("Unique event ID for deduplication"),
  type: z.enum([
    "invoice_created",
    "invoice_updated",
    "invoice_deleted",
    "invoice_posted",
    "invoice_cancelled",
    "invoice_sent",
  ]),
  resourceId: id("inv").describe("ID of the affected resource"),
  organizationId: z.string(),
  timestamp: dateTime,
  userId: z.string(),
  data: z.record(z.unknown()).optional(),
});
```

### Publishing Events

Services (e.g., `createInvoice`, `updateInvoice`) publish events after successful mutations:

```typescript
function publishInvoiceEvent(
  ctx: Ctx,
  type: RealtimeEvent["type"],
  resourceId: string,
  data?: Record<string, unknown>
) {
  const event: RealtimeEvent = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    type,
    resourceId,
    organizationId: ctx.tenant.orgId,
    timestamp: new Date().toISOString(),
    userId: ctx.user.id,
    data,
  };
  ctx.publisher.publish(event);
}

export async function createInvoice(ctx: Ctx, input: InvoiceCreateInput) {
  // ... validation, repo call, audit ...
  publishInvoiceEvent(ctx, "invoice_created", invoice.inv_id);
  return invoice;
}
```

### Frontend Hook

**File:** `skeleton/apps/web/src/lib/useRealtime.ts`

```typescript
export function useRealtime() {
  const queryClient = useQueryClient();
  
  useEffect(() => {
    const eventSource = new EventSource("/api/realtime");
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as RealtimeEvent;
      handleRealtimeEvent(data, queryClient);
    };
    
    eventSource.onerror = () => {
      eventSource.close();
      // Exponential backoff reconnect
    };
    
    return () => eventSource.close();
  }, [queryClient]);
}

function handleRealtimeEvent(event: RealtimeEvent, queryClient: ...) {
  // Event type → query key mapping (per ADR-0006 pattern)
  switch (event.type) {
    case "invoice_created":
    case "invoice_updated":
    case "invoice_deleted":
      queryClient.invalidateQueries({ queryKey: ["invoices", "list"] });
      queryClient.invalidateQueries({ queryKey: ["invoices", event.resourceId] });
      break;
  }
}
```

**Mount:** In `skeleton/apps/web/src/routes/__root.tsx`:

```typescript
export default function RootLayout() {
  useRealtime(); // Mounts once per app; handles auth + reconnect
  // ...
}
```

## Scenario Walkthrough

### Wave B Dogfood Test

Two concurrent browser contexts, both logged in as admin:

1. **Context A:** Navigate to `/invoices`, sit idle with the list loaded
   - TanStack Query fetches invoices, caches with key `["invoices", "list"]`
   - `useRealtime()` opens EventSource to `/api/realtime`
   - Connected and subscribed to events for Context A's org

2. **Context B:** Navigate to `/invoices/create`, fill form, submit
   - API calls `POST /invoices`
   - Service validates, writes to DB, publishes `invoice_created` event
   - Event broadcast to all subscribers in the same org
   - Context A's EventSource receives the event

3. **Context A (automatic):**
   - `useRealtime` hook's message handler sees `invoice_created`
   - Calls `queryClient.invalidateQueries({ queryKey: ["invoices", "list"] })`
   - TanStack Query refetches the list query
   - New invoice appears in the table without page reload or user action

**Proof of causality (falsifiability):** Disable the `invalidateQueries` call in `useRealtime.ts` → test fails (new invoice does NOT appear). Restore → test passes.

## Gotchas & Lessons

### 0. THREE CHAIN-BREAKING BUGS (Wave B, Round 2 fixes)

The first acceptance-test run hit these in sequence. They are documented here so future implementations don't repeat them:

#### Bug A: Query key prefix mismatch

**The problem:** Client code invalidated `["invoices", "list"]` but real query keys from `queryOptions.ts` are `["invoices", limit, offset]`. The prefix `["invoices", "list"]` matches nothing.

**The fix:** Use `["invoices"]` alone as the prefix — it matches both list queries (`["invoices", 20, 0]`) and detail queries (`["invoices", "inv_123"]`).

**Lesson:** Query key shape is contract between `queryOptions.ts` and cache invalidation. When invalidating via prefix, test with the actual key shape, not guesses about naming.

#### Bug B: SSE event naming breaks EventSource.onmessage

**The problem:** Server sent named events: `{ event: "invoice_created", data: "..." }`. Per SSE spec, `EventSource.onmessage` only fires for UNNAMED events (no `event:` field). Named events need `addEventListener("message", ...)` with matching event name, which the client never set up.

**The fix:** Send unnamed events: `{ data: "..." }` only. The event type is already in the payload (`data.type`), so clients switch on that instead.

**Lesson:** SSE's event naming is for multiplexing MULTIPLE event types in one connection. For a single event stream per endpoint, use unnamed events and put discriminators in the payload.

#### Bug C: Bun's default idleTimeout kills SSE streams

**The problem:** Bun.serve's default `idleTimeout: 10s` closes idle HTTP connections. SSE connections are inherently "idle" (no req/resp, just server→client events). After 10s with no inbound data, Bun kills the connection. The client's 30s keep-alive was 3x too slow.

**The fix:** Set `idleTimeout: 0` in Bun.serve to disable idle timeout. The SSE route's 30s keep-alive still serves proxies that have their own timeouts.

**Lesson:** Long-lived HTTP connections (SSE, long-polling) need special server config. Test with actual server implementation, not just contract shapes.

### 1. EventSource URL must be same-origin (or CORS-allowed)

Vite dev proxy (`localhost:5174` → `localhost:3000`) makes this transparent. The browser sees `/api/realtime` as same-origin; cookies are sent automatically.

**Gotcha:** If the SSE endpoint was on a different origin, you'd need:
- Explicit CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`)
- OR: token passed in query param (but then not in URL signature, harder to debug)

Stick with same-origin.

### 2. EventSource doesn't send Authorization header

By design (browser security). Use cookies (default) or query-param token. The skeleton uses session cookies (BetterAuth default), so it just works.

```typescript
// ✅ Works: cookies auto-sent
const eventSource = new EventSource("/api/realtime");

// ❌ Doesn't work: Authorization header not sent
// const eventSource = new EventSource("/api/realtime?token=...");
// Header-based auth must use cookies
```

### 3. Reconnect behavior is browser-native

EventSource has built-in exponential backoff. If the server closes the connection or the network fails, the browser will retry with increasing delays. No library needed.

```typescript
eventSource.onerror = () => {
  // Fired on network error, server close, etc.
  // Browser already handles backoff; you can add your own logic
};
```

### 4. Events are not ordered across concurrent publishers

If two separate API instances both publish events (e.g., load-balanced backend), events may arrive out-of-order at a single subscriber. The skeleton uses in-memory publisher (single instance), so this is not a problem. With Redis Pub/Sub, order is guaranteed within a single Redis instance but not across shards.

**Solution for production:** Event versioning + idempotent cache invalidation (event IDs already in schema for deduplication).

### 5. No backpressure; slow subscribers can block

If a subscriber callback is slow, it can delay other subscribers' delivery. For the skeleton's in-memory publisher, callbacks are synchronous; a slow callback blocks the entire publish.

**Solution for production:** Async queuing (subscriber queues events, processes in background).

### 6. Playwright's waitForLoadState("networkidle") never settles with live EventSource

**The problem:** A live EventSource counts as in-flight network forever (technically `pending` in DevTools). Playwright's `waitForLoadState("networkidle")` waits for ALL in-flight requests to complete, so it hangs indefinitely.

**The fix:** Replace all `waitForLoadState("networkidle")` with deterministic waits on specific UI elements that you need next:
- After goto /invoices → `await expect(page.locator('table')).toBeVisible()`
- After goto /create → `await expect(page.locator('input[data-testid="..."]')).toBeVisible()`
- After form submit → `await page.waitForURL("**/invoices")` or wait for the created row

**Lesson:** Acceptance tests with real-time connections must avoid network-based waits; use UI presence or URL changes instead.

### 7. Two parallel tenancies from leftover mock headers (Seam 7 precedence bug)

**The problem (Wave B, Round 3 diagnosis):** `apiFetch` in the web client hardcoded mock headers (x-user-id, x-org-id, x-roles) even when a real session cookie existed. The API's session middleware uses these headers, taking precedence over cookie-based sessions. Result: **all app UI traffic ran in the hardcoded mock org**, while EventSource (which cannot send custom headers) ran in the **real session org**. Same code, two parallel tenants. Event published to org A, subscribed in org B — SSE appeared to work (connection 200, event delivered to page, query refetch triggered) but refetched data was empty because the query ran in a different tenant than the event.

**The diagnostic:** Query cache showed `dataUpdatedAt` advanced (refetch fired), but response was `{"data":[], "total": 0}`. Raw cookie-authenticated requests at the same moment returned the created row. The seam was broken, not the SSE chain.

**The fix:** Remove hardcoded headers from `apiFetch`; rely on cookies (`credentials: "include"` already present). Add optional `headers` parameter to `makeApiClient` for test-only header injection (real path: POST /auth/sign-in, capture cookie, pass via headers option).

**Lesson:** Every seam (auth, realtime, queries) must use the same authentication path. Mock headers are for contract tests only (`app.request()` with header injection). Production code (the default apiClient) must never hardcode auth — it authenticates via the real path (cookies). This is why seam 7 exists: session handling will change (BetterAuth → Keycloak, or cookies → JWTs), and hardcoded headers would survive that swap, creating two silent tenants forever.

## Contract Tests

See `skeleton/apps/api/src/routes/realtime.test.ts`:

- SSE endpoint requires auth (401 for anonymous)
- Authenticated users receive events for their org
- Events are filtered by organization (no cross-org leakage)
- Multiple subscribers in the same org all receive events

## Acceptance Test (Dogfood)

See `skeleton/acceptance/realtime.e2e.ts`:

- Two browser contexts (both admin)
- Context A loads `/invoices`
- Context B creates an invoice
- Assert: new invoice appears in A WITHOUT reload (10s timeout)
- Proof: disable invalidateQueries → test fails → restore → green

## Sealing for Phase 2+

To swap the publisher implementation:

1. Change `inMemoryPublisher()` in `main.ts` to `redisPublisher()` (not yet implemented)
2. Implement `redisPublisher()` satisfying the `RealtimePublisher` interface
3. No other changes needed (contract is stable)

Same pattern for notifier (swap `inMemoryNotifier()` for real email/Telegram adapter).

## References

- ADR-0006: Seam interfaces (realtime: SSE default, envelope types, Query-invalidation over payload-as-state)
- ADR-0002: Patterns (seams = interface + adapters)
- ADR-0004: API design (event contracts)
- Hono `streamSSE` docs: https://hono.dev/docs/api/context#streamsee
- MDN EventSource: https://developer.mozilla.org/en-US/docs/Web/API/EventSource
- TanStack Query `invalidateQueries`: https://tanstack.com/query/latest/docs/framework/react/reference/useQueryClient#queryclientinvalidatequeries
