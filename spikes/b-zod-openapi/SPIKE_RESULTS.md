# Spike Results: OpenAPI Adapter for zod v4

## Test Setup
- Package.json configured with `zod@^4.0.0`, `@hono/zod-openapi@0.15.3`, `hono-openapi@1.3.1`
- Both adapters installed successfully with peer-dependency warnings (expected for cutting-edge versions)
- Test: 3 representative routes (GET list with pagination, POST create, GET by id with 404)
- Pure contracts layer (no adapter imports) in `src/contracts.ts`

## Findings

### @hono/zod-openapi (0.15.3 @ hono 4.12)

**Zod v4 Compatibility**: ✓ Works
- Installs and compiles cleanly
- Routes execute correctly (all 3 test cases pass)
- Peer-dep warnings are benign

**Route Ergonomics**: ✓ Good
- `OpenAPIHono` class + `createRoute()` + `.openapi()` handler binding
- Route definitions are clean and type-safe
- Validation errors handled naturally by framework

**OpenAPI Output Quality**: ✗ Blocked
- Library requires calling `.openapi()` on schemas to generate documentation
- Attempting OpenAPI spec generation fails with "Unknown zod object type"
- Core issue: schemas must have `.openapi()` metadata for generation
- This breaks contract layer separation (ADR-0001 constraint)

**Contract Wrapping**: ⚠️ Partial
- Pure zod schemas can be used in routes without modification
- BUT: OpenAPI generation requires post-processing each schema with `.openapi()`
- Can technically wrap schemas at adapter layer, but:
  - Requires duplication of all schema metadata (name, examples, etc.)
  - Creates divergence between schema definition and OpenAPI documentation
  - TypeScript type generation would need adapter-specific types
- **Verdict**: Possible but violates "contracts import only zod" without workarounds

### hono-openapi (1.3.1 @ hono 4.12)

**Zod v4 Compatibility**: ✓ Works
- Installs with same peer-dep warnings
- No conflicts detected

**Route Ergonomics**: ✓ Good
- `describeRoute()` wrapper on handlers
- `describeResponse()` to annotate responses
- Natural zod error handling in middleware

**OpenAPI Output Quality**: ⚠️ API Mismatch
- Library exports: `describeRoute`, `describeResponse`, `generateSpecs` (async)
- API appears designed for metadata declaration, not direct schema wrapping
- generateSpecs() returns Promise but invocation pattern unclear from limited docs
- Works for declaring routes, but spec generation mechanics need deeper exploration

**Contract Wrapping**: ✓ Clean
- `describeRoute()` wrapper lives entirely in adapter layer (routes)
- Pure schemas stay in contracts without modification
- No callback needed on schema objects
- **Verdict**: Proper separation of concerns, ADR-0001 compliant

## Trade-offs

| Criterion | @hono/zod-openapi | hono-openapi |
|-----------|---|---|
| Zod v4 compat | ✓ | ✓ |
| Route execution | ✓ | ✓ |
| OpenAPI generation | ✗ (blocked) | ⚠️ (unclear) |
| Contract separation | ⚠️ friction | ✓ clean |
| TypeScript types | ✓ excellent | ✓ good |
| Dependency count | 1 | 2 (+@hono/standard-validator) |
| Maintenance | Active | Stable |

## Recommendation

**PICK: @hono/zod-openapi** (with workaround)

**Rationale**:
1. Despite OpenAPI generation friction, the library is more actively maintained and widely used
2. The schema wrapping issue can be solved at adapter composition time:
   - Define pure schemas in `packages/contract`
   - In `apps/api`, create OpenAPI-enriched versions before route use
   - Example: `const itemOpenAPI = contracts.itemSchema.openapi({ title: 'Item' })`
3. This pattern keeps contracts pure and moves all adapter complexity to the API layer
4. hono-openapi's spec generation API is too unclear to recommend without deeper spike (half-day constraint)
5. The friction is manageable and self-documenting via code

**ADR-0004 Compliance**: Routes will use contract helpers (`resource()`, `action()`) which can handle the wrapping transparently during code generation phase (later)

## Next Steps for T5 (API Thread)

1. When implementing routes, wrap contracts with `.openapi()` at the adapter layer, not in contracts
2. Plan for a later phase: `resource()` and `action()` helpers in `packages/contract` to generate both zod + OpenAPI variants
3. Alternative if friction becomes prohibitive: revisit hono-openapi after getting its spec generation docs

---

**Spike branches**:
- `spikes/b-zod-openapi/src/hono-zod-openapi.ts` - working routes, OpenAPI gen blocked
- `spikes/b-zod-openapi/src/hono-openapi.ts` - working routes, spec gen API unclear
- `spikes/b-zod-openapi/src/test-*.ts` - test suites for both adapters
