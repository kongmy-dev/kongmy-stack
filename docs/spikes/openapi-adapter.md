# Spike B — OpenAPI adapter: `@hono/zod-openapi` × zod v4

**Pick:** `@hono/zod-openapi` (ADR-0011). Versions proven: `hono@^4 · zod@^4 · @hono/zod-openapi@^0.15`.

## Scenarios verified (runnable in `spikes/b-zod-openapi/`)

- 3 representative routes on zod v4: **list + pagination query**, **create + body validation** (422-shaped error detail), **get by id + 404** — validation, error handling, and OpenAPI generation all work.
- **The architecture-critical shape:** schemas defined in a plain-zod file (zero adapter imports, per ADR-0001), wrapped at the route layer. This is the pattern every `resource()`/`action()` helper will generate.
- Fallback `hono-openapi@1.3.1` built with the same 3 routes: handler wrapping fine, but `generateSpecs()` is undocumented — spec generation could not be verified, so it lost.

## The pattern (contracts stay pure)

```typescript
// packages/contract/… — imports ONLY zod
export const itemSchema = z.object({
  id: z.string().describe('Item ID'),
  name: z.string().describe('Item name'),
}).describe('Item');

// apps/api/… — adapter layer, the ONLY place .openapi() appears
const itemOpenAPI = itemSchema.openapi({ title: 'Item' });
const route = createRoute({
  method: 'get', path: '/items/{id}',
  responses: { 200: { content: { 'application/json': { schema: itemOpenAPI } } } },
});
app.openapi(route, handler);
```

`.describe()` annotations flow from the pure schema into the OpenAPI doc — the ADR-0004 mandatory-describe rule pays for itself here.

## Carry-forwards for T5

- Expect benign peer-dependency warnings (adapter built against zod v4.x).
- `.openapi()` wrapping happens at route definition time — hide it inside `registerResource()` / the route-metadata consumer so feature code never sees it.
- Revisit trigger (low priority): `hono-openapi` documents its spec generation.
