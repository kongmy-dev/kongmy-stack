# ADR-0002 — Pattern vocabulary: seams + data, no class taxonomies

**Status:** accepted 2026-07-13

GoF patterns were largely workarounds for languages without first-class functions, closures, and structural typing. In TS they compile down to two shapes: **seams** (interface + swappable implementations) and **data** (discriminated unions + exhaustive matching). If a design idea seems to need `class X extends Y`, look for the closure or union that replaces it.

## Embraced (as functions/unions, not class hierarchies)

| Pattern | Where | Form |
|---|---|---|
| Adapter | storage (pg/pglite/d1/in-memory), queue impls, auth seam, connector real/fake gateways | interface + implementations — the load-bearing pattern of the stack |
| Facade + Command | `registry.execute()` single audited door; MCP tools | plain functions behind one typed dispatch |
| Strategy | autonomy levels, pricing, error→HTTP mapping | discriminated unions + function maps |
| Repository | `packages/db` | function modules, not class-per-entity |
| Observer | events module (outbox + in-proc bus) | **bounded to domain facts** — never in-request control flow |
| Chain of Responsibility | Hono middleware | already idiomatic |
| Decider | platform-archetype state machines | `(state, command) → events` pure function; supersedes GoF State |

## Rejected

- **Singleton** — except immutable consts at the composition root. State is passed (ctx), never imported. Module-level lazy globals are untestable and break on Workers' per-request isolates.
- **Template Method** — inheritance (see ADR-0001).
- **Abstract Factory hierarchies** — factory ceremony deleted from the reference architecture; construction happens at composition roots only.
- **Visitor** — discriminated union + exhaustive `switch` gives compiler-checked completeness.
- **Builder (authored)** — object literals with optional fields cover it; consume builders (zod, drizzle, hono), author single-call typed definers (`defineResource({...})`) instead of stateful multi-step builders.
- **Proxy / magic getters** — hostile to grep and to agents.

## The Observer boundary (most important in practice)

Events are for *facts that happened* (audit, integrations, projections) — never for making the current request work. In-request event choreography produces systems nobody can trace; the outbox module encodes the correct boundary.
