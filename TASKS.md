# kongmy-stack — Task List

> Working checklist for build threads. Context: `CLAUDE.md` (rules) + `PLAN.md` (plan + reasoning) + **`EXECUTION.md` (parallel thread briefs T1–T8 with file ownership — start there)**. Check items off here; record decisions as ADRs in `docs/adr/`.
> Thread mapping: Phase 1a → T1 · repo scaffolding/CI/deploy/CLAUDE-template/add.ts → T2 · contract+helpers+CI-checks → T3 · core/db/authz-tables/audit-table/sequences → T4 · api app/authz-enforcement/audit-write/otel/client-gen → T5 · web app/seams/i18n → T6 · modules/money → T7 · acceptance → T8.

## Phase 1a — Spikes (do first)

- [x] **Spike A: pg-boss on PGlite** — DONE (ADR-0012): pg-boss runs on PGlite via first-party `fromPglite()`; SQL-fallback plan dead. Hardened by a 3-lane conformance suite (PGlite mem/file + Postgres 16, 6 assertions incl. dead-letter + process-kill restart, all green) → seeds `modules/queue` contract tests. See `docs/spikes/queue-pgboss.md`.
- [x] **Spike B: `@hono/zod-openapi` × zod v4** — DONE (ADR-0011): `@hono/zod-openapi` picked; zod v4 proven on 3 routes; contracts stay pure, `.openapi()` wrapping confined to adapter layer. `hono-openapi` rejected (spec generation undocumented). See `docs/spikes/openapi-adapter.md`.
- [x] **Spike C (small): message catalog lib** — DONE (ADR-0013): Paraglide JS; compile-time key safety + 2.2 KB runtime; validated in a real Vite+React+TanStack app w/ live en→ms→zh switching (5/5 tests). T6 wiring reference: `spikes/c-i18n-catalog/app/`. See `docs/spikes/i18n-paraglide.md`.

## Phase 1b — Skeleton: backend (DONE — Waves 1+2 merged)

**Evidence:** `bun install && bun run ci` green from clean install; 29 tests (16 db + 13 api); seam 1 (client gen) reproducible; contract pure (zod only); 422/401/403 envelopes proven; audit write at command door; permission derivation live; scalars frozen; `modules/money` passing.

- [x] Repo scaffolding: bun workspaces, `biome.json`, `tsconfig.base.json`, `.dependency-cruiser.cjs` (routes→services→repos, contract imports zod only), CI (`bun run ci`), BSD-3 LICENSE, public-stance README
- [x] `packages/contract`: pagination schema (limit/offset/sort/filter frozen), error codes enum, Invoice example schemas
- [x] Contract helpers (ADR-0004): `resource()`, `action()` (RPC route + MCP tool), `listResponse()`, `paginationQuery`, `id('prefix')` branded ULID
- [x] Type-level constraints (ADR-0001): `defineContract()`, `Service<Ctx, In, Out>`, zod validation + type safety per route
- [x] CI checks (ADR-0004): no-`z.any()` in contracts — wired into `bun run ci`
- [x] Error model: `AppError` subclasses + envelope + single `errorHandler` + HTTP map (22/401/403/404 proven)
- [x] `packages/db`: drizzle, `withScope(org, branch)` tenancy, adapter seam (postgres | pglite), Invoice schema + repos
- [x] `apps/api`: Hono app factory (pure, injectable, testable via `app.request()`), OpenAPI wiring, Invoice resource (routes → service → repo)
- [x] Client generation: OpenAPI → typed TS via `bun gen:client`; reproducibility verified (regen = empty diff)
- [x] `packages/core`: pure TS placeholder, KMP-variant seam documented
- [x] Platform baseline (ADR-0005): zod env schema, ctx logger + request-id, `/health` + graceful shutdown
- [x] DB conventions (ADR-0005): prefixed ULID pk, createdAt/updatedAt repo-layer, drizzle-kit migrate
- [x] Test harness (ADR-0005): `app.request()` contract tests, 13 api tests (validation, auth, auditability)
- [x] Seam interfaces (ADR-0006): realtime SSE helper, notifier seam (email/telegram/lark), tenant lifecycle
- [x] Deploy recipes (ADR-0005): systemd, Dockerfile, GH Actions `bun run ci`
- [x] CLAUDE.md template (ADR-0005): stack rules pre-filled
- [x] AuthZ (ADR-0008): `roles`/`memberships` + seeded defaults, permission derivation in `resource()`/`action()`, `ctx.authz.assert()` at command door, 403 tests passing
- [x] Scalars (ADR-0009): contract/scalars.ts frozen (id, currency, quantity, tax, phone, email, address), document lifecycle (draft→posted→cancelled)
- [x] Audit + OTel (ADR-0010): audit_log table + command-door write (REST + MCP), traceparent + request spans + trace ids in logs
- [x] ADRs seeded: 0001, 0002, 0003 (constraints, patterns, DI), 0011–0013 (queue, openapi, i18n)

## Phase 1c — Skeleton: frontend (`apps/web`) (DONE — Wave 3 merged)

**Evidence:** `bun install && bun run ci` 52 tests (23 web) from clean install; all 8 seams live; Playwright smoke green; live CRUD in browser (create/list/edit/delete, 422→field, 401, EN↔MS, tenancy isolation); form state race (v4 hang) fixed.

- [x] Vite + React + TanStack Router (file-based) + Query; providers wired
- [x] Vendor UI from sapphire registry (sapphire v3 live; true-CLI smoke green; interim shadcn fallback no longer needed)
- [x] Seam 1–2: generated client + per-resource `queryOptions` factories pattern
- [x] Seam 3: DataTable wired to contract pagination (TanStack Table; server-side pagination/sort/filter; state in URL params)
- [x] Seam 4: form pattern with `zodResolver(contract.X)` + FormField composition; `@hookform/resolvers@3` + zod-v4 race fixed
- [x] i18n plumbing (ADR-0007): Paraglide catalog, locale in ctx (user→tenant→en), `Intl` formatters, error code→message; ALL worked-example strings through `t()`; EN↔MS proven live
- [x] Seam 5: route search-param validation from contract query schemas (shareable URLs are valid API queries)
- [x] Seam 6: ApiError → `form.setError` / toast mapping utility
- [x] Seam 7: auth — BetterAuth + cookie-only (mock provider unreachable outside NODE_ENV=test), session hook + `beforeLoad` guards, Keycloak variant documented
- [x] Worked `features/invoices/` slice: list (DataTable) + create/edit (form) + delete (confirm), end-to-end tested
- [x] `scripts/add.ts` module copier (workspace patch, `--into` support for consumer projects)

## Phase 1d — First consumption + acceptance (DONE — Wave 4 passed)

**Evidence:** Fresh-scaffold test passed (2026-07-14). Skeleton copied to temp dir → `bun install` → `bun run ci` (52 tests) all green in seconds, zero platform code written. Live run: API + web both up, CRUD driven end-to-end through real proxy (201 prefixed ULID, `{data,meta}` shape, field errors, auth, i18n).

- [x] Scaffold proof: clone → install → CI green → add module → verify. Seam 8 end-to-end proven (`scripts/fresh-clone-check.ts`).
- [x] Module add.ts: `bun scripts/add.ts <name> --into <path>`, points to repo modules, patches consumer's workspace, merges deps
- [x] README.md refreshed: what works (Phase 1), quick start, design principles, no-support stance, BSD-3
- [x] CLAUDE.md status updated: Phase 1 complete, Waves A–C merged, Wave D (T8) passed
- [x] Acceptance documentation: `skeleton/docs/guides/scaffolding.md` (clone path, seam 8, gotchas, troubleshooting)
- [x] Consumer scaffolding from skeleton (signal: GO as of 2026-07-14)
- [ ] Feedback loop: friction found in consumers → fix in skeleton while both are young

## Phase 2+ (pull-driven — do NOT build ahead of a consumer)

- [ ] `scripts/gen.ts feature <x>` generator (ADR-0001): emits contract stub + service + routes + queries.ts + form + columns + route file from a resource definition — the `rails g scaffold` equivalent; generated code is vendored and editable
- [ ] `modules/money` (Money/Weight VOs generalized from private consumer references; decimal.js internal, integer minor units on wire; fast-check tests)
- [ ] `modules/queue` (interface + pg-boss impl + PGlite lane per Spike A + scheduler)
- [x] `modules/events` (envelope + HLC + outbox + in-proc bus, from private consumer references) — Wave E: 47 tests incl. cross-process SIGKILL crash-recovery on file-backed PGlite, per-event mark (poison isolation), payload round-trip
- [x] `modules/agentic` (registry.execute(), zod-derived tool schemas, autonomy gate, /mcp) — Wave E: 15 tests; MCP transport threads autonomy from caller ctx (default suggest), denials audited at the door
- [ ] `modules/connector` (canonical model + real/fake gateways + sync jobs + verify scripts, from private middleware reference; includes ERPNext permission importer per ADR-0008 when a project syncs with ERPNext)
- [ ] `modules/ledger` — **decided 2026-07-16: deferred until a second consumer wants double-entry** (ADR-0009 lifecycle + accounting core): account tree (code, ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE, parent), balanced JournalEntry/JournalLine, auto-GL-post pattern from documents, FiscalYear + period close, payment application against invoices, trial balance/P&L/BS queries, optional `dimensions` (cost center/project) on lines. Verify-invariant scripts: Σdebits=Σcredits per entry + per period, aging consistency. References: private accounting reference, ERPNext accounts doctypes
- [ ] `modules/country-my` (ADR-0009): states/postcode, TIN validation, SSM/SST ids, MSIC codes, SST tax types, MyInvois e-invoice (UBL 2.1 v1.1 mapper + PKCS#7 signing + OAuth2 + submit/poll/cancel; sandbox+prod). Sources: private accounting/einvoice modules and consumer packages
- [ ] Kotlin client pipeline (OpenAPI → KMP)
- [ ] `registry/` shadcn-format manifests for modules
- [ ] GitHub repo public + `bun create` flow verified from a clean machine
