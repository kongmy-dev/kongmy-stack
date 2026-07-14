# ADR-0011 — OpenAPI adapter: pick @hono/zod-openapi, wrap contracts at adapter layer

**Status:** accepted 2026-07-14

**Amends:** ADR-0004 (API design)

## Decision

**Adapter:** `@hono/zod-openapi` (v0.15+)

- Contracts import only zod (ADR-0001 compliant): pure schemas stay in `packages/contract`
- OpenAPI metadata added at **adapter layer** via `.openapi()` wrapping (not in contracts)
- Routes use `OpenAPIHono` + `createRoute()` + `.openapi()` handler binding
- Both zod v4 and earlier versions work; v4 confirmed in spike

## Why not hono-openapi

Spiked `hono-openapi` (v1.3.1) in parallel:
- Clean handler-level wrapping (also adapter-layer)
- But: `generateSpecs()` API undocumented and unclear; spec generation blocked during spike
- Without working OpenAPI generation, cannot verify core requirement
- **Decision**: defer until docs/examples clarify the pattern; @hono/zod-openapi is proven

## Trade-off accepted

**Friction point:** Schemas must call `.openapi()` to enable OpenAPI generation. This is **not** done in contracts; instead, wrapped at adapter composition:

```typescript
// contracts.ts (pure zod)
export const itemSchema = z.object({
  id: z.string().describe('Item ID'),
  name: z.string().describe('Item name'),
}).describe('Item');

// apps/api/routes.ts (adapter layer)
const itemOpenAPI = itemSchema.openapi({ title: 'Item', examples: [...] });
const route = createRoute({
  responses: {
    200: { schema: itemOpenAPI }
  }
});
```

This pattern:
- Keeps contracts pure ✓
- Moves adapter complexity to one place ✓
- Enables `.describe()` flow through to OpenAPI docs ✓
- Sets up for future contract helpers (`resource()`, `action()`) to auto-generate both variants

## Zod v4 notes for T5

- Peer-dependency warnings expected (`@hono/zod-openapi` was built against zod v4.x)
- Route execution, validation, and error handling all work without issues
- No zod v4 breaking changes hit in spike test (3 CRUD routes + pagination + error cases)

## Revisit trigger

If `hono-openapi` spec generation becomes documented and stable (clearer API), revisit: its handler-only wrapping is slightly cleaner than schema post-processing. Low priority.

---

**Spike repo**: `spikes/b-zod-openapi/` (working implementations of both adapters, test suite)

**Package selection**: `hono@^4.0.0 zod@^4.0.0 @hono/zod-openapi@^0.15.0`
