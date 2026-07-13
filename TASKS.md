# kongmy-stack — Task List

> Working checklist for build threads. Context: `CLAUDE.md` (rules) + `PLAN.md` (plan + reasoning). Check items off here; record decisions as ADRs in `skeleton/docs/adr/`.

## Phase 1a — Spikes (do first)

- [ ] **Spike A: pg-boss on PGlite** — stand up pg-boss against a PGlite instance; enqueue, work, retry, fail-to-dead-letter. Outcome → ADR: either "PGlite lane uses pg-boss" (delete fallback plan) or "PGlite lane uses minimal SQL impl" (spec it: jobs table + SKIP LOCKED worker + backoff).
- [ ] **Spike B: `@hono/zod-openapi` × zod v4** — define 3 representative routes (list w/ pagination, create w/ body validation, get w/ params + error cases). Assess: zod v4 compat, route-definition ergonomics, OpenAPI output quality. Fallback candidate: `hono-openapi`. Outcome → ADR naming the adapter.

## Phase 1b — Skeleton: backend

- [ ] Repo scaffolding: bun workspaces, `biome.json`, `tsconfig.base.json`, `.dependency-cruiser.cjs` (layering rules: routes→services→repos, contract imports zod only), CI (`bun run ci`), BSD-3 LICENSE, public-stance README
- [ ] `packages/contract`: pagination schema (limit/offset/sort/filter names — final, they propagate everywhere), error codes enum, example resource schemas
- [ ] Error model: `AppError` subclasses + envelope + single `errorHandler` + HTTP status map
- [ ] `packages/db`: drizzle setup, `withScope(org, branch)` tenancy helper, adapter seam (postgres | pglite | in-memory), example schema + repo functions
- [ ] `apps/api`: Hono app factory (pure, injectable deps, testable via `app.request()`), OpenAPI adapter wiring, one worked resource (routes → service → repo) as the copyable pattern
- [ ] Client generation: OpenAPI → typed TS client, wired into `bun run` script; thin ApiError mapper
- [ ] `packages/core`: pure-TS domain placeholder + the KMP-variant seam documented
- [ ] Seed `docs/adr/` with the locked decisions (one ADR each, terse, linking vault note)

## Phase 1c — Skeleton: frontend (`apps/web`)

- [ ] Vite + React + TanStack Router (file-based) + Query; providers wired
- [ ] Vendor UI from sapphire registry (blocked on sapphire REGISTRY-PLAN phase A — coordinate; interim: vendor plain shadcn + `@import` sapphire `theme.css`)
- [ ] Seam 1–2: generated client + per-resource `queryOptions` factories pattern
- [ ] Seam 3: DataTable block wired to contract pagination (TanStack Table; server-side pagination/sort/filter; state in URL search params)
- [ ] Seam 4: form pattern with `zodResolver(contract.X)` + FormField composition
- [ ] Seam 5: route search-param validation from contract query schemas
- [ ] Seam 6: ApiError → `form.setError` / toast mapping utility
- [ ] Seam 7: auth — BetterAuth wiring server-side, session hook + `beforeLoad` guards client-side; Keycloak variant documented (not built)
- [ ] One worked `features/<example>/` slice: list (DataTable) + create/edit (form) + delete (confirm), end-to-end against `apps/api`
- [ ] `scripts/add.ts` module copier (workspace patch + dep merge)

## Phase 1d — First consumption

- [ ] emas-pos scaffolds from skeleton (its thread; coordinate — this repo only needs to be ready)
- [ ] Feedback loop: friction found in emas-pos → fix in skeleton while both are young

## Phase 2+ (pull-driven — do NOT build ahead of a consumer)

- [ ] `modules/money` (Aurum Money/Weight VOs generalized; decimal.js internal, integer minor units on wire; fast-check tests)
- [ ] `modules/queue` (interface + pg-boss impl + PGlite lane per Spike A + scheduler)
- [ ] `modules/events` (envelope + HLC + outbox + in-proc bus, from Aurum)
- [ ] `modules/agentic` (registry.execute(), zod-derived tool schemas, autonomy gate, /mcp)
- [ ] `modules/connector` (canonical model + real/fake gateways + sync jobs + verify scripts, from settlement-middleware)
- [ ] Kotlin client pipeline (OpenAPI → KMP)
- [ ] `registry/` shadcn-format manifests for modules
- [ ] GitHub repo public + `bun create` flow verified from a clean machine
