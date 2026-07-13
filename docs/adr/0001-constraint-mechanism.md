# ADR-0001 — Constraint mechanism: types + codegen + CI, never inheritance

**Status:** accepted 2026-07-13

## Decision

The stack achieves Rails/Laravel-grade structural constraint WITHOUT framework base classes. Three mechanisms, all shipped in the skeleton as vendored source:

1. **Type-level contracts** (compile-time law): `defineContract()` accepts only zod; `Service<Ctx, In, Out>` is the sole service signature; `defineTool()` requires an autonomy actionType. Wrong wiring is a type error, not a review comment. The only route helper takes a contract as its first argument — an unvalidated route cannot be written.
2. **Wiring generators** (the `resources :x` / `rails g scaffold` equivalents): `registerResource(app, contract.x, services.x)` emits standard CRUD routes + OpenAPI + error mapping; `scripts/gen.ts feature <x>` generates the full slice (contract stub, service, routes, queries, form, columns, route file). Generation beats inheritance: output is vendored, readable, editable — no magic to fight when a feature outgrows the pattern.
3. **Boundary law** (dependency-cruiser in CI): dependency direction is enforced, which inheritance cannot do. See table.

## Why not base classes

- **Breaks the distribution model:** a shared `BaseService` becomes a versioned runtime dependency — the npm treadmill reintroduced through the object hierarchy. The constraint mechanism must itself be vendorable: types, generated code, and CI rules travel as source; base classes travel as coupling.
- **TS types out-constrain TS classes:** a typed builder constrains exactly at compile time; a base class constrains loosely at runtime.
- **Fragile base class + agent ergonomics:** base-class evolution breaks all consumers; AI-driven workflows do better with explicit local code than behavior hidden in superclasses.

## Allowed-imports table (the dep-cruiser ruleset)

| Layer | May import | May never import |
|---|---|---|
| `packages/contract` | zod only | anything else (incl. the OpenAPI adapter) |
| `packages/core` | contract | db, hono, any I/O, any runtime API |
| `packages/db` | contract, core, drizzle | hono, apps |
| `apps/api` routes | contract, services | db repos directly, core internals |
| services | core, db repos, contract | hono/`Context` (services never see HTTP) |
| `apps/web` `features/<x>` | contract, generated client, `components/ui`, own files | other features' internals, raw fetch |
| `components/ui` (vendored) | `@/lib/utils`, tokens | features, api, contract |

## Trade-off accepted

No central upgrades: a bug in generated wiring is fixed per-project. Same trade as vendored UI — per-project patching in exchange for zero ecosystem-wide coupling. Consistent with a solo maintenance budget.

**Rule of thumb:** every convention must be *executable* (compile error, CI failure, generated default). Documentation-plus-discipline decays; enforcement holds.
