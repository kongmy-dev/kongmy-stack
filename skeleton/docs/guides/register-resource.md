# registerResource: Wiring CRUD Routes

Reference: ADR-0001 (constraint mechanism), ADR-0004 (API design), ADR-0008 (authz), ADR-0010 (audit + realtime).

**registerResource()** is the machine-enforced convention for wiring a `ResourceContract` + service handlers into CRUD routes with automatic:
- Contract validation (input validation → 422 errors)
- Permission enforcement (authz.assert at command door)
- Audit logging (mutations recorded in audit_log)
- Realtime event publishing (mutations notify subscribers)

Per ADR-0001, missing a handler = compile error. No way to forget.

## Quick Start

```typescript
// Import contract + service handlers
import { invoiceResource } from "@kongmy-stack/contract";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
} from "../services/invoice.js";
import { registerResource } from "../lib/registerResource.js";

// Register CRUD routes in your app
export function registerInvoices(app: any) {
  registerResource(app, invoiceResource, {
    list: listInvoices,
    get: getInvoice,
    create: createInvoice,
    update: updateInvoice,
    delete: deleteInvoice,
  });

  // Custom actions (not CRUD) stay hand-wired
  const sendRoute = createRoute({
    method: "post",
    path: "/invoices/:id/send",
    // ...
  });
  app.openapi(sendRoute, async (c) => {
    // ...
  });
}
```

## What Gets Wired

For each `ResourceContract`, registerResource creates 5 routes:

| Route | Method | Path | Handler | What registerResource Does |
|-------|--------|------|---------|---------------------------|
| List | GET | `/{resources}?limit&offset` | `list(ctx, query)` | Validates query params → calls handler → returns `{data, meta}` |
| Get | GET | `/{resources}/:id` | `get(ctx, id)` | Validates ID → calls handler → returns bare object |
| Create | POST | `/{resources}` | `create(ctx, input)` | Validates input → calls handler → writes audit → publishes event → returns 201 |
| Update | PUT | `/{resources}/:id` | `update(ctx, id, input)` | Validates input → calls handler → writes audit → publishes event → returns bare object |
| Delete | DELETE | `/{resources}/:id` | `delete(ctx, id)` | Calls handler → writes audit → publishes event → returns `{success}` |

Every route:
1. **Validates** via the contract schema (defaultHook converts zod errors to 422)
2. **Enforces permissions** via `ctx.authz.assert(contract.permissions.X)`
3. For mutations (create/update/delete): **Writes audit** with actor + action + resource-id
4. For mutations: **Publishes event** for realtime subscribers

## Service Handler Signatures

Your handlers must match `ResourceServiceHandlers` exactly:

```typescript
interface ResourceServiceHandlers {
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
```

**All 5 handlers are required.** Omit one = TypeScript error (ADR-0001 constraint).

## Permission IDs (from contract)

Permissions are **machine-derived** from your contract (ADR-0008):

```typescript
// Given:
const invoiceResource = resource({
  name: "invoice",
  // ...
});

// registerResource uses:
// - invoiceResource.permissions.read       (LIST + GET)
// - invoiceResource.permissions.create     (POST)
// - invoiceResource.permissions.update     (PUT)
// - invoiceResource.permissions.delete     (DELETE)
```

You never write permission IDs by hand. They come from the contract, enforced by CI.

## Audit Log Entries

For each mutation, registerResource writes to `audit_log`:

```sql
INSERT INTO audit_log 
  (audit_id, organization_id, user_id, action, resource_type, resource_id, autonomy_level, created_at)
VALUES
  ('audit_01ABC...', 'org_xyz', 'user_bob', 'invoice:create', 'invoice', 'inv_01XYZ...', 'auto', NOW());
```

Accessible for compliance + audit trails. Shown in activity feeds via `entityRef`.

## Realtime Events

Mutations publish events:

```typescript
{
  eventId: "evt_1234567_abcdef",
  type: "invoice_created" | "invoice_updated" | "invoice_deleted",
  resourceId: "inv_01XYZ...",
  organizationId: "org_xyz",
  timestamp: "2026-01-15T10:30:00Z",
  userId: "user_bob",
}
```

Subscribers on the SSE endpoint receive updates instantly.

## Custom Actions (Not CRUD)

registerResource handles the standard CRUD. For custom actions (like "send invoice"), keep them hand-wired:

```typescript
export function registerInvoices(app: any) {
  // CRUD via registerResource
  registerResource(app, invoiceResource, handlers);

  // Custom action: hand-wired
  const sendRoute = createRoute({
    method: "post",
    path: "/invoices/:id/send",
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: { description: "Sent", content: { "application/json": { schema: sendInvoiceOutput } } },
    },
  });

  app.openapi(sendRoute, async (c: any) => {
    const ctx = c.var as AppBindings["Variables"];
    const id = c.req.param("id");
    return c.json(await sendInvoice(ctx, id));
  });
}
```

Or create an `action()` contract + handler, then wire it similarly.

## Compile-Time Constraint: Missing Handler

If you omit a handler, TypeScript catches it at compile time:

```typescript
// ❌ This doesn't compile:
registerResource(app, invoiceResource, {
  list: listInvoices,
  get: getInvoice,
  create: createInvoice,
  // update: updateInvoice,  ← Oops, forgot this
  delete: deleteInvoice,
});

// Error: 
// Type '{ list: ...; get: ...; create: ...; delete: ... }' 
// is not assignable to type 'ResourceServiceHandlers'.
//   Property 'update' is missing.
```

This is ADR-0001 in action: **constraint via types, not docs or discipline.**

## Testing

Per ADR-0005, test CRUD via `app.request()` with contract test factories:

```typescript
import { createTestApp, createTestInvoice } from "../test-utils.js";

describe("Invoice CRUD", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  it("POST /invoices creates and returns 201", async () => {
    const res = await app.request("/invoices", {
      method: "POST",
      headers: { "x-user-id": "alice", "x-roles": "admin" },
      body: JSON.stringify(createTestInvoice()),
    });

    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toMatch(/^inv_/);
  });

  it("POST /invoices without permission returns 403", async () => {
    const res = await app.request("/invoices", {
      method: "POST",
      headers: { "x-user-id": "alice", "x-roles": "viewer" }, // No invoice:create
      body: JSON.stringify(createTestInvoice()),
    });

    expect(res.status).toBe(403);
  });

  it("POST /invoices writes audit and publishes event", async () => {
    // audit_log query after request: verify row exists
    // event from publisher: verify emitted
  });
});
```

## Gotchas

### 1. Services still validate and handle business logic

registerResource validates the **contract shape** and enforces **permissions + audit + events**.  
Your service still handles **business logic** (e.g., "can't update posted invoices"):

```typescript
export async function updateInvoice(ctx, id, input) {
  ctx.authz.assert("invoice:update"); // Belt-and-suspenders (registerResource also asserts)

  const invoice = await invoiceRepo.getById(ctx.db, ctx.tenant, id);
  if (!invoice) throw new NotFoundError(...);

  // Business rule: draft-only
  if (invoice.status !== "draft") {
    throw new ValidationError("Cannot update posted invoice", { status: ["Draft invoices only"] });
  }

  // ... do the update ...
  return updated;
}
```

registerResource doesn't know about "draft-only" — that's domain logic in your service.

### 2. Query parameter coercion

Query params come in as strings from HTTP. registerResource coerces them to numbers via `z.coerce.number()`:

```
GET /invoices?limit=10&offset=0
       ↓ (coerced)
query = { limit: 10, offset: 0 }
       ↓ (passed to handler)
handlers.list(ctx, query)
```

If your contract's paginationQuery doesn't have coerce, that's fine — it's for service-layer validation. The route layer (registerResource) handles HTTP.

### 3. Response shape is enforced

registerResource returns the **exact shape** from the contract:

- Single resource (get, create, update, delete): **bare object** ← `{ id, ..., status }`
- List: **`{ data: [...], meta: { limit, offset, total, hasMore } }`**
- Delete: **`{ success: true }`**

If your service returns `{ data: {...} }` for a single resource, the route will pass it through (the contract validation in `outputSchema` catches mismatches).

## Extending registerResource

registerResource handles standard CRUD. For variants:

- **Soft deletes** (status = "archived"): keep delete hand-wired; service checks status.
- **Restore endpoint**: hand-wire as a custom action.
- **Bulk operations**: hand-wire as a separate route (doesn't fit CRUD).
- **Alternative list filters**: use `query` param handling in your service (e.g., `&status=draft`).

## Further Reading

- **ADR-0001**: Constraint mechanism — why no base classes.
- **ADR-0004**: API design — bare objects vs. envelopes, error codes, scalars.
- **ADR-0008**: AuthZ model — permission IDs derived from contracts, one enforcement point.
- **ADR-0010**: Audit at the command door — what gets logged and why.
- `skeleton/apps/api/src/routes/invoice.ts`: Real usage — invoice CRUD via registerResource.
- `skeleton/apps/api/src/lib/registerResource.ts`: Implementation — inspect to understand the wiring.
