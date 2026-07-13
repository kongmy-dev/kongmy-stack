# CLAUDE.md — kongmy-stack

Public (BSD-3) full-stack **template system** for KONGMY Digital Solutions. This repo is the clone-point + module source for all new product/client projects. It is **not a framework and not a published package** — consumers clone the skeleton and vendor modules as owned source, then diverge freely.

**Full rationale lives in the vault:** `~/obsidian-knowledge/Resources/Dev & Infra/API Stack & Template Architecture — kongmy-stack.md` (decided 2026-07-13). This file is the working summary for this repo.

---

## Why this exists (summary)

Seven prior projects rebuilt the same platform code (validation, error envelopes, tenancy, queues, auth wiring, API clients) with different answers each time. This repo freezes those decisions **once**. Two principles carry everything:

1. **Contract-first zod SSOT** — every operation is a zod contract + a service function. From that one definition: Hono route, OpenAPI doc, MCP tool schema, generated TS/Kotlin clients, form validation, URL param validation.
2. **Nothing we maintain is a versioned dependency of anything we build.** All platform code (backend modules and UI components) moves as vendored source. No npm treadmill, per-project divergence is free. This is the only distribution model that survives a one-person maintenance budget.

First consumer and forcing function: **emas-pos** (`~/Projects/emas-pos`) — build order = whatever it needs next. Nothing enters this template that a real product didn't pull.

## Locked architecture (condensed — do not relitigate)

- **HTTP:** Hono. Runtime-neutral code only (WinterCG APIs) in core + API; runtime-specifics behind two seams: one config module, one storage adapter. Bun + Node home; Workers up-target.
- **Contracts:** `packages/contract` — **imports only `zod`, never the OpenAPI adapter** (keeps adapter swappable). Adapter: `@hono/zod-openapi`, pending spike vs zod v4; fallback `hono-openapi`. No route without a contract schema. Never hand-write an API client.
- **Errors:** one envelope + `AppError` subclasses → HTTP map, defined once in skeleton. Frontend maps `VALIDATION_ERROR.details.field → form.setError(field)`, else toast.
- **Layering:** routes → service functions → drizzle repo functions. `ctx = { db, tenant, user, env }`. No controller classes, no DI factories. Fakes behind the same interfaces for tests. Enforced by dependency-cruiser in CI.
- **DB:** Postgres at every altitude — PGlite (embedded/tests) → local → Neon. Drizzle constant. D1 only when Workers-native, same adapter seam. Tenancy: `withScope(org, branch)`, RLS-ready.
- **Queue:** ONE enqueue/worker interface, three impls: pg-boss (server PG) · minimal SQL (PGlite/embedded) · CF Queues (Workers).
- **MCP:** tool = route = same service, different transport. `registry.execute()` single audited command door; tools are business verbs, coarser than CRUD. Autonomy gate: suggest → assist → auto (outbound returns draft unless auto). `ToolResult {ok, summary, data}` — summary written for the LLM.
- **Core:** TypeScript, pure, zero I/O. KMP core is an optional variant for mobile-sharing projects only.
- **Frontend:** TanStack Router (file-based, typed search params) + TanStack Query. Forms: react-hook-form + `zodResolver(contract.X)`. State rule: server→Query, URL→search params, rest→zustand sparingly. `features/` folders (route pieces + queryOptions + forms + columns together).
- **UI:** vendored components pulled from the **sapphire-ui registry** (see Boundaries). Sapphire tokens (`theme.css`) are the default skin; reskin per client via token overrides, never by forking upstream.
- **Tooling:** Bun (pm/runtime/test/workspaces) · Biome · dependency-cruiser · fast-check (money/domain) · no Turbo. `bun run ci` = typecheck + boundaries + tests.
- **Money:** VO module (`decimal.js` internal), wire = integer minor units.
- **Next.js:** never in this repo — only for public SEO surfaces, which are out of template scope.

## The 8 marriage seams (frontend ↔ backend, all off `packages/contract`)

1. contract → OpenAPI → generated TS client (`apps/web/src/lib/api.ts` + thin ApiError mapper)
2. per-resource `queryOptions` factories consuming that client
3. DataTable ↔ contract pagination: one set of limit/offset/sort/filter names across API validation, table state, URL params
4. forms via `zodResolver(contract.X)`
5. Router search params validated by contract query schemas (a shareable URL is a valid API query)
6. error envelope → form/toast mapping, mechanical
7. auth seam both halves: server `getSession(ctx)` ↔ client session hook + `beforeLoad` guards (BetterAuth default; Keycloak/OIDC variant documented)
8. scaffold: `bun create` → archetype → modules copied → UI vendored from registry → seam-complete start

## Repo layout (target)

```
skeleton/            # the clone-point: apps/{api,web}, packages/{contract,core,db}
                     #   biome.json · tsconfig.base.json · .dependency-cruiser.cjs
                     #   bun workspaces · CI · docs/adr pre-seeded with the locked decisions
modules/             # copyable source: queue/ events/ agentic/ money/ connector/
scripts/add.ts       # `bun scripts/add.ts <module>` — copies module, patches workspace
registry/            # LATER: shadcn-format manifests for file items (earn it after modules proven)
```

**Archetypes** = module selection, not separate templates: `saas` (base+queue±agentic) · `platform` (base+queue+events+money+sync) · `middleware` (base−web+queue+connector).

## Source material (adapt, don't import)

| What | Where | Notes |
|---|---|---|
| events envelope + HLC + outbox · `withScope` RLS · `registry.execute()` · Money VOs | `~/Projects/emas-pos/packages/*` + `docs/` ADRs | Build the generic versions HERE; emas-pos then consumes them (never ship `@aurum/*`) |
| tenant repo · autonomy gate · tools/MCP shape | `~/Projects/nexus-command-centre` (`packages/`, `apps/api/ai/`) | Derive tool inputSchema from zod, not hand-written JSON Schema |
| connector pattern: canonical model, fake gateways, sync jobs, verify-invariant scripts | `~/Projects/IotCats/settlement-middleware` | For the `connector` module (later phase) |
| admin blocks reference | `~/Projects/references/shadcn-admin` | Blocks are imported via sapphire-ui, not directly here |

## Boundaries (hard rules)

- **Zero published packages.** Everything ships as copyable source. If you're about to `npm publish`, stop.
- **sapphire-ui never imports from this repo** and this repo never imports sapphire via npm for product UI — UI components are **vendored** from sapphire's registry (`shadcn add` / copy). Contract-aware UI blocks (DataTable wired to pagination schema, AppError form mapper) live HERE in `skeleton/apps/web`; styled primitives live in sapphire.
- **No product IP ever**: no Aurum licensing/crypto/control-plane code, no client domain logic, no secrets. This repo is public.
- **Contracts import only zod.** Adapter idioms must not leak into `packages/contract`.
- **Bun only** (never npm/npx/yarn). Biome for lint+format.
- **Public stance** (README): personal stack — no support, no roadmap, no semver; breaking changes without notice. Git tags as snapshots.

## Current status

Pre-phase-1. See `PLAN.md` (full plan + reasoning) and `TASKS.md` (actionable checklist). Start with the two spikes — they de-risk the two locked-but-unverified choices.
