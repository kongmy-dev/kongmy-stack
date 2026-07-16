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

## Architecture constraints (ADRs — binding, read before building)

- **`docs/adr/0001`** — constraint mechanism: types + codegen + CI, **never inheritance/base classes** (they'd reintroduce versioned coupling). Contains the allowed-imports table = the dep-cruiser ruleset. Every convention must be executable (compile error / CI failure / generated default).
- **`docs/adr/0002`** — pattern vocabulary: seams (interface + adapters) and data (unions + exhaustive switch), no class taxonomies. Singleton only as consts at composition roots; events bounded to domain facts, never in-request control flow.
- **`docs/adr/0003`** — DI = two-level ctx (app deps at `main.ts`, request ctx in one middleware; inject I/O, import purity) · no max-lines rules, one-concern-per-file · DDD strategic-only, one layer vocabulary (`contract/core/db/apps`) · **modular monolith with multiple entrypoints** (api/worker/cron mains over shared packages; split services only on demonstrated need) · packages only at 2+ consumers (skeleton ships exactly 3) · per-product monorepo, never umbrella.
- **`docs/adr/0004`** — API design: REST for nouns + RPC action posts for verbs (actions map 1:1 to MCP tools) · bare objects for single resources, `{data, meta}` for lists only, `{error:{code,message,details}}` errors · prefixed ULIDs, ISO-8601 UTC, minor-unit money · no versioning (additive-only evolution) · **mandatory `.describe()` + no `z.any()` in contracts, CI-enforced** · tool outputs are summaries, not dumps. Encoded as contract helpers (`resource()`, `action()`, `listResponse()`, `id()`) — authoring with helpers IS compliance.

- **`docs/adr/0005`** — platform baseline (day-1 bake-ins): zod-validated env fail-fast + generated `.env.example` · ctx-injected structured logger + request-id everywhere · `/health` + graceful shutdown · testing pyramid (contract tests via `app.request()` + in-memory adapters as workhorse; core-only unit tests; one Playwright smoke; zod-derived test factories) · DB conventions (prefixed ULID pk, createdAt/updatedAt, **no soft delete by default**) · deploy recipes (Bun+systemd default, Docker, Workers) + one GH Actions workflow · **scaffold ships a CLAUDE.md template** · explicit no-list (feature flags, analytics, backup, docs portal — with triggers).
- **`docs/adr/0006`** — seam interfaces, contract now / impl on first pull: storage (presigned direct upload), notifier (one seam for email+Telegram+Lark), realtime (SSE default, envelope types, Query-invalidation over payload-as-state), HTTP caching (`no-store` default, helper for cacheable reads), tenant lifecycle (new-tenant script, status, audited impersonation).
- **`docs/adr/0007`** — i18n plumbing day 1 (translations deferred): typed compile-time message catalog (Spike C: Paraglide vs i18next), all template UI strings through `t()`, `Intl` formatting with wire staying canonical, locale in ctx (user→tenant→en). **Amends ADR-0004:** `error.message` = English debug; UIs render from `code`+`details` via catalog. `.describe()` and `ToolResult.summary` stay English (agent-facing).

- **`docs/adr/0008`** — AuthZ: **contract-derived permission matrix** (`resource:action` ids generated from `resource()`/`action()`, never hand-authored) · roles as tenant-scoped data with seeded defaults · membership scope constraints (branch-level, enforced in `withScope`) · owner predicate · **one enforcement point at the command door** (`ctx.authz.assert`) — MCP tools and REST hit the same check; `tools/list` filtered by `can()` · permission=may, autonomy=how autonomously (orthogonal) · **no field masking — explicit contract variants instead** · ERPNext DocPerm/User-Permission/Role import mapping verified (importer lives in connector module).
- **`docs/adr/0009`** — scalar vocabulary in `packages/contract/scalars.ts`: CurrencyCode, ExchangeRate (+ multi-currency rule: never store converted amounts without rate+date), Quantity+UoM, rates as integer basis points, TaxCode, DateOnly≠DateTime, Timezone (tenant setting + day-boundary rule), **DocumentNumber + per-tenant gapless-option sequences**, Phone E.164, Email normalized, structured Address, FileRef, AuditStamp, enum casing (`lowercase_snake` domain / SCREAMING errors), opt-in `withVersion()`. **Document lifecycle: draft→posted→cancelled; posted is immutable, corrections are reversals** (transitions are `action()`s → permissions + MCP tools free). **Country modules** (`domain ⊥ country`): `country-my` = states/postcode, TIN validation, SSM/SST, MSIC, MyInvois UBL 2.1 + PKCS#7 e-invoice lifecycle.
- **`docs/adr/0010`** — logs ≠ audit ≠ events. Audit: append-only table **written at the command door** (covers REST + MCP + agents; autonomy level recorded), entity Activity-feed UI convention, ~100 lines not a lib. Tracing: W3C traceparent propagation (incl. queue jobs), request span, trace ids in log lines, **OTel API as the seam** with OTLP-via-env exporter (console default, Workers shim). Metrics: RED per route class free from middleware + `ctx.meter` domain counters + optional `/metrics` per deploy recipe.

## Current status

**Phase 1 complete** (2026-07-14). Waves A–C merged:
- **Wave A (T1):** Spikes—queue (pg-boss on PGlite) + OpenAPI adapter (@hono/zod-openapi) + i18n (Paraglide). All ADR'd (0011–0013).
- **Wave B (T5, T7):** API app (Hono + contract routes) + money module (decimal.js VO, allocation).
- **Wave C (T6):** Web app (Vite + React + TanStack Router/Query, all 8 seams live) + acceptance suite (10 Playwright smoke tests).
- **CI metrics:** 122 tests from clean install (db + api + web), `bun run ci` exit:0. Acceptance layer: 10 browser tests, all seams verified end-to-end.
- **Fresh scaffold proof:** `bun create` → running CRUD in <1h, zero platform code written. Live in browser: create/list/edit/delete, 422→field validation, 401 auth, EN↔MS i18n, tenancy isolation.

**Wave D (T8):** Scaffold path proved end-to-end: clone (excluding node_modules) → fresh install → CI → add module → test. See `scripts/fresh-clone-check.ts`.

**Wave E (2026-07-16):** `modules/events` (envelope + HLC + upcast + transactional outbox + in-proc bus; per-event marking with poison isolation; crash recovery proven by cross-process SIGKILL on file-backed PGlite; 47 tests) + `modules/agentic` (`registry.execute()` audited door, zod→JSON-Schema tool derivation, autonomy gate suggest/assist/auto, framework-free MCP JSON-RPC transport with `tools/list` filtered by `can()` and denials audited; 15 tests). Both extracted from emas-pos/nexus references, de-domained (IP grep gated). 4 modules total; `verify-all.ts` auto-discovers them in acceptance. `modules/ledger` decided OUT of template until a second consumer (lives in emas-pos).

**Acceptance layer in CI:** `bun run acceptance` = fresh-clone-check gate (proves zero repo-internal assumptions) + 10 Playwright smoke tests + per-module verify. Catches installation-shape bugs (symlink handling, workspace deps, tsconfig paths).

See `PLAN.md` (full plan + reasoning) and `TASKS.md` (actionable checklist). `EXECUTION.md` contains outcome notes per thread.
