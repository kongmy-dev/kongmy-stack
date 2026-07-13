# kongmy-stack — Task List

> Working checklist for build threads. Context: `CLAUDE.md` (rules) + `PLAN.md` (plan + reasoning). Check items off here; record decisions as ADRs in `skeleton/docs/adr/`.

## Phase 1a — Spikes (do first)

- [ ] **Spike A: pg-boss on PGlite** — stand up pg-boss against a PGlite instance; enqueue, work, retry, fail-to-dead-letter. Outcome → ADR: either "PGlite lane uses pg-boss" (delete fallback plan) or "PGlite lane uses minimal SQL impl" (spec it: jobs table + SKIP LOCKED worker + backoff).
- [ ] **Spike B: `@hono/zod-openapi` × zod v4** — define 3 representative routes (list w/ pagination, create w/ body validation, get w/ params + error cases). Assess: zod v4 compat, route-definition ergonomics, OpenAPI output quality. Fallback candidate: `hono-openapi`. Outcome → ADR naming the adapter.
- [ ] **Spike C (small): message catalog lib** — Paraglide JS vs i18next (ADR-0007). Criteria: typed keys (compile error on missing), bundle cost, Vite + TanStack integration, plural/ICU. Outcome → note in ADR-0007.

## Phase 1b — Skeleton: backend

- [ ] Repo scaffolding: bun workspaces, `biome.json`, `tsconfig.base.json`, `.dependency-cruiser.cjs` (layering rules: routes→services→repos, contract imports zod only), CI (`bun run ci`), BSD-3 LICENSE, public-stance README
- [ ] `packages/contract`: pagination schema (limit/offset/sort/filter names — final, they propagate everywhere), error codes enum, example resource schemas
- [ ] Contract helpers (ADR-0004): `resource()`, `action()` (RPC route + MCP tool registration), `listResponse()`, `paginationQuery`, `id('prefix')` branded ULID type
- [ ] Type-level constraint set (ADR-0001): `defineContract()`, `Service<Ctx, In, Out>`, `defineTool()` (requires actionType); `registerResource(app, contract.x, services.x)` CRUD wiring helper
- [ ] CI checks (ADR-0004): describe-coverage script + no-`z.any()`/`z.unknown()` in contracts — wired into `bun run ci`
- [ ] Error model: `AppError` subclasses + envelope + single `errorHandler` + HTTP status map
- [ ] `packages/db`: drizzle setup, `withScope(org, branch)` tenancy helper, adapter seam (postgres | pglite | in-memory), example schema + repo functions
- [ ] `apps/api`: Hono app factory (pure, injectable deps, testable via `app.request()`), OpenAPI adapter wiring, one worked resource (routes → service → repo) as the copyable pattern
- [ ] Client generation: OpenAPI → typed TS client, wired into `bun run` script; thin ApiError mapper
- [ ] `packages/core`: pure-TS domain placeholder + the KMP-variant seam documented
- [ ] Platform baseline (ADR-0005): zod env schema + fail-fast + generated `.env.example` · ctx logger + request-id middleware + standard request log line · `/health` + graceful shutdown per runtime · Sentry-shaped error-reporting seam (off)
- [ ] DB conventions in example schema (ADR-0005): prefixed-ULID pk helper, createdAt/updatedAt in repo layer, drizzle-kit migrate flow, idempotent `seed:dev`/`seed:demo`
- [ ] Test harness (ADR-0005): `app.request()` contract-test setup over in-memory adapters + zod-derived test factories; wired into `bun run ci`
- [ ] Seam interfaces + fakes (ADR-0006): storage, notifier, realtime SSE helper, cache-control route helper, tenant lifecycle script — interfaces + in-memory fakes only, no real impls
- [ ] Deploy recipes + CI (ADR-0005): systemd unit + Dockerfile + Workers config in skeleton; GH Actions workflow running `bun run ci`
- [ ] Scaffolded-project CLAUDE.md template (ADR-0005): stack rules pre-filled, project-specifics blank
- [ ] AuthZ (ADR-0008): `roles`/`memberships` tables + seeded defaults · permission derivation in `resource()`/`action()` · `ctx.authz` (session-load permission set, `can()`/`assert()`) · enforcement at command door + route early-reject · owner predicate · MCP `tools/list` filtering
- [ ] Scalars (ADR-0009): `packages/contract/scalars.ts` day-1 set + `DocumentNumber` sequence table/helper (gapless option) + document-lifecycle state helper (draft→posted→cancelled, posted immutable)
- [ ] Audit + OTel + metrics (ADR-0010): audit_log table + command-door write + Activity feed query · traceparent middleware + request span + trace ids in logs · RED metrics middleware + meter seam · OTLP env config
- [ ] Seed remaining `docs/adr/` from the vault-note locks not yet covered (terse, one each)

## Phase 1c — Skeleton: frontend (`apps/web`)

- [ ] Vite + React + TanStack Router (file-based) + Query; providers wired
- [ ] Vendor UI from sapphire registry (blocked on sapphire REGISTRY-PLAN phase A — coordinate; interim: vendor plain shadcn + `@import` sapphire `theme.css`)
- [ ] Seam 1–2: generated client + per-resource `queryOptions` factories pattern
- [ ] Seam 3: DataTable block wired to contract pagination (TanStack Table; server-side pagination/sort/filter; state in URL search params)
- [ ] Seam 4: form pattern with `zodResolver(contract.X)` + FormField composition
- [ ] i18n plumbing (ADR-0007): message catalog per Spike C, locale in ctx (user→tenant→en), `Intl` format helpers, error code→message rendering; ALL worked-example strings through `t()`
- [ ] Seam 5: route search-param validation from contract query schemas
- [ ] Seam 6: ApiError → `form.setError` / toast mapping utility
- [ ] Seam 7: auth — BetterAuth wiring server-side, session hook + `beforeLoad` guards client-side; Keycloak variant documented (not built)
- [ ] One worked `features/<example>/` slice: list (DataTable) + create/edit (form) + delete (confirm), end-to-end against `apps/api`
- [ ] `scripts/add.ts` module copier (workspace patch + dep merge)

## Phase 1d — First consumption

- [ ] emas-pos scaffolds from skeleton (its thread; coordinate — this repo only needs to be ready)
- [ ] Feedback loop: friction found in emas-pos → fix in skeleton while both are young

## Phase 2+ (pull-driven — do NOT build ahead of a consumer)

- [ ] `scripts/gen.ts feature <x>` generator (ADR-0001): emits contract stub + service + routes + queries.ts + form + columns + route file from a resource definition — the `rails g scaffold` equivalent; generated code is vendored and editable
- [ ] `modules/money` (Aurum Money/Weight VOs generalized; decimal.js internal, integer minor units on wire; fast-check tests)
- [ ] `modules/queue` (interface + pg-boss impl + PGlite lane per Spike A + scheduler)
- [ ] `modules/events` (envelope + HLC + outbox + in-proc bus, from Aurum)
- [ ] `modules/agentic` (registry.execute(), zod-derived tool schemas, autonomy gate, /mcp)
- [ ] `modules/connector` (canonical model + real/fake gateways + sync jobs + verify scripts, from settlement-middleware; includes ERPNext permission importer per ADR-0008 when a project syncs with ERPNext)
- [ ] `modules/ledger` (ADR-0009 lifecycle + accounting core): account tree (code, ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, parent), balanced JournalEntry/JournalLine, auto-GL-post pattern from documents, FiscalYear + period close, payment application against invoices, trial balance/P&L/BS queries, optional `dimensions` (cost center/project) on lines. Verify-invariant scripts: Σdebits=Σcredits per entry + per period, aging consistency. References: `~/Projects/references/vibe_accounting_malaysia` (fullest), ERPNext accounts doctypes
- [ ] `modules/country-my` (ADR-0009): states/postcode, TIN validation (vibe tinUtils), SSM/SST ids, MSIC codes, SST tax types, MyInvois e-invoice (UBL 2.1 v1.1 mapper + PKCS#7 signing + OAuth2 + submit/poll/cancel; sandbox+prod). Sources: vibe einvoice module, `~/Projects/emas-pos/packages/country-my`
- [ ] Kotlin client pipeline (OpenAPI → KMP)
- [ ] `registry/` shadcn-format manifests for modules
- [ ] GitHub repo public + `bun create` flow verified from a clean machine
