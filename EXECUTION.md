# kongmy-stack — Parallel Execution Plan

> Operational companion to `PLAN.md` (strategy) and `TASKS.md` (full checklist). This file is what you kick threads off from: layout freeze → waves → per-thread briefs with **disjoint file ownership** so parallel agent threads never conflict.

## Ground rules for every thread

- Read `CLAUDE.md` + the ADRs your brief lists **before writing code**. ADRs are law; friction → note in your outcome report, don't fork conventions.
- **Stay inside your owned paths** (listed per thread). Needing to touch another thread's path = a dependency you missed — stop and flag.
- Work on branch `ws/<thread-id>`; rebase on main before PR; merges happen at wave boundaries. Small commits, `bun run ci` green (once T2 lands it; before that, typecheck at minimum).
- Record outcomes: spikes write `docs/adr/0011+`; build threads tick `TASKS.md` and note deltas at the bottom of this file.

## Layout (FROZEN — place files here, no debate)

```
skeleton/                    # the clone-point (what a new project starts as)
  apps/api/                  # Hono app factory, routes, errorHandler, authz, audit, otel, client-gen
  apps/web/                  # Vite + TanStack Router/Query SPA, features/, vendored ui
  packages/contract/         # zod SSOT: scalars, helpers, pagination, error codes (+ CI check scripts)
  packages/core/             # pure domain placeholder + AppError classes (no I/O)
  packages/db/               # drizzle, withScope, adapters (pg|pglite|in-memory), conventions
  deploy/                    # systemd unit, Dockerfile, workers config
  .github/workflows/ci.yml   # bun run ci
  biome.json · tsconfig.base.json · .dependency-cruiser.cjs · package.json (workspaces)
  CLAUDE.md.template         # scaffolded-project agent docs (ADR-0005)
modules/                     # money/ queue/ events/ agentic/ ledger/ connector/ country-my/
spikes/                      # a-pgboss-pglite/ b-zod-openapi/ c-i18n-catalog/  (throwaway code, kept for reference)
scripts/add.ts               # module copier
docs/adr/                    # 0001–0010 law + 0011+ spike outcomes
```

## Waves & dependency graph

```mermaid
graph LR
  T1[T1 Spikes A+B+C] --> T5[T5 API app]
  T2[T2 Repo infra] --> T5
  T3[T3 Contract pkg] --> T5
  T4[T4 core + db pkgs] --> T5
  T3 --> T6[T6 Web app]
  T1 --> T6
  T5 --> T6
  T3 --> T7[T7 money module]
  T6 --> T8[T8 Worked example + acceptance]
  T5 --> T8
  SAP[sapphire v3 A+B - external] -.-> T6
```

**Wave 1 (kick off all four NOW, fully parallel):** T1, T2, T3, T4
**Wave 2 (after T1+T3+T4 merge):** T5 · (T7 may start once T3 merges)
**Wave 3 (after T5; sapphire interim fallback allowed):** T6
**Wave 4 (integration):** T8 — then emas-pos scaffolds (its own repo/brief: `~/Projects/emas-pos/STACK-MIGRATION.md`)

---

## Thread briefs

### T1 — Spikes (wave 1)
**Owns:** `spikes/**`, `docs/adr/0011..0013` (new files only)
**ADRs:** 0007, 0009 (context); outcomes become 0011 (API adapter), 0012 (queue×PGlite), 0013 (i18n lib)
**Do:** ① pg-boss against PGlite: enqueue/work/retry/dead-letter — pass ⇒ PGlite lane uses pg-boss (kill SQL-fallback plan); fail ⇒ spec minimal SQL fallback (jobs table + SKIP LOCKED + backoff). ② `@hono/zod-openapi` × zod v4 on 3 representative routes (list+pagination, create+validation, get+errors) vs fallback `hono-openapi` — pick one. ③ Paraglide vs i18next: typed keys, bundle cost, Vite/TanStack fit, plural/ICU — pick one.
**Done when:** three ADRs written with a clear pick + evidence; spike code runs via `bun`.

### T2 — Repo & skeleton infra (wave 1)
**Owns:** `skeleton/` root files (package.json workspaces, biome.json, tsconfig.base.json, .dependency-cruiser.cjs, .github/, CLAUDE.md.template), `skeleton/deploy/**`, `scripts/add.ts`
**ADRs:** 0001 (allowed-imports table → dep-cruiser rules), 0003, 0005
**Do:** bun workspaces wiring · Biome config · dep-cruiser encoding the ADR-0001 table (rules reference paths that may not exist yet — fine) · `bun run ci` = typecheck + boundaries + tests · GH Actions workflow · systemd unit + Dockerfile + workers config templates · scaffolded-project CLAUDE.md template · `scripts/add.ts` module copier (copy + workspace patch).
**Done when:** `bun install && bun run ci` green on the skeleton with stub packages; dep-cruiser fails a deliberate violation test.

### T3 — Contract package (wave 1)
**Owns:** `skeleton/packages/contract/**`
**ADRs:** 0004 (all), 0009 (all), 0008 (permission derivation hooks)
**Do:** scalars.ts full day-1 set (Money, CurrencyCode, ExchangeRate, Quantity+UoM, bps rates, TaxCode, DateOnly/DateTime, Timezone, DocumentNumber format, Phone, Email, Address, FileRef, AuditStamp, id('prefix') branded ULIDs, withVersion) · paginationQuery + listResponse · error codes enum · `resource()` / `action()` helpers emitting route metadata + derived permission ids + MCP tool descriptors (transport-agnostic — NO hono/adapter imports, contracts import only zod) · document-lifecycle declaration helper · CI scripts: describe-coverage + no-any.
**Done when:** an example resource contract compiles, derives permissions, passes both CI checks; zero non-zod imports (dep-cruiser will verify later).

### T4 — core + db packages (wave 1)
**Owns:** `skeleton/packages/core/**`, `skeleton/packages/db/**`
**ADRs:** 0003, 0005 (DB conventions), 0008 (roles/memberships tables), 0009 (sequences), 0010 (audit table)
**Do:** core: AppError subclass set + pure-domain placeholder (zero I/O). db: drizzle setup + adapter seam (pg | pglite | in-memory) · `withScope(org, branch)` · conventions (prefixed-ULID pk helper, createdAt/updatedAt in repo layer) · `roles`/`memberships` tables · `audit_log` table · DocumentNumber sequence table + gapless/fast helpers · drizzle-kit migrate flow + idempotent seed scripts · example schema + repo functions.
**Done when:** contract tests run against the in-memory adapter; a scope-violation test fails correctly; sequence helper proves gapless under concurrent inserts (test).

### T5 — API app (wave 2; needs T1-B pick, T2, T3, T4)
**Owns:** `skeleton/apps/api/**`
**ADRs:** 0004, 0005, 0008, 0010
**Do:** pure `createApp(deps)` factory · OpenAPI adapter wiring (per ADR-0011 pick) over contract route metadata · ONE errorHandler (envelope + AppError map + request-id echo) · `registerResource()` CRUD wiring · ctx construction (two-level, ADR-0003) · `ctx.authz` (session permission set, can/assert, owner predicate) enforced at command door · audit write at door · env fail-fast schema · request-id + traceparent + request span + RED middleware (OTel API seam, OTLP by env) · `/health` + graceful shutdown · client generation script (OpenAPI → typed TS client) · one worked resource end-to-end · contract-test harness pattern (`app.request()` + in-memory adapters + zod factories).
**Done when:** worked resource passes contract tests incl. 422/401/403/404 envelope shapes; generated client typechecks; audit rows + trace ids observable in tests.

### T6 — Web app (wave 3; needs T3, T5 client, T1-C pick; sapphire external)
**Owns:** `skeleton/apps/web/**`
**ADRs:** 0004 (error→UI), 0007, frontend locks in vault note §Frontend
**Do:** Vite + React + TanStack Router (file-based) + Query providers · vendored UI: sapphire registry if v3 Phase A/B live, else plain shadcn + `@import` sapphire theme.css (swap later) · the 8 seams: generated-client wrapper, queryOptions factories, DataTable↔pagination (state in URL search params), zodResolver forms, search-param validation from contract, ApiError→form.setError/toast, session hook + beforeLoad guards · i18n plumbing per ADR-0013 pick (locale ctx user→tenant→en, Intl helpers, error-code rendering, ALL strings through t()) · `features/` structure.
**Done when:** worked feature (list+create/edit+delete) runs end-to-end against T5's api; URL is shareable state; a forced 422 lands on the right form field; zero hardcoded strings.

### T7 — money module (wave 2+, needs T3; emas-pos pull)
**Owns:** `modules/money/**`
**ADRs:** 0009; source: `~/Projects/emas-pos/packages/pos-kernel` Money/Weight VOs (generalize, decimal.js internal, minor-units wire)
**Do:** VOs + arithmetic (allocation/rounding rules explicit) + fast-check property tests + zod codec to/from contract scalars.
**Done when:** property tests pass (associativity of allocation, no lost cents); emas-pos thread confirms the API fits its pricing kernel.

### T8 — Integration & acceptance (wave 4)
**Owns:** cross-cutting fixes only via the owning thread's paths; `EXECUTION.md` outcome notes
**Do:** run PLAN.md acceptance list: fresh `bun create` → running CRUD in <1h with zero platform code · full `bun run ci` · zero hand-written fetch / unvalidated routes · spikes ADR'd · hand emas-pos its scaffold signal.

---

## External coordination

- **sapphire v3** (Kong My kicks off separately): T6 needs Phase A+B for real vendoring; interim fallback is sanctioned — do not block.
- **emas-pos**: scaffolds after T8; its platform packages migrate into `modules/` per its brief — money (T7) first.

## Outcome notes (threads append here)

- **2026-07-14 · T1 complete** (3 spikes + hardening round). Picks: `@hono/zod-openapi` (ADR-0011) · **pg-boss on ALL PG lanes** incl. PGlite via first-party `fromPglite()`, minimal-SQL fallback dead (ADR-0012) · Paraglide JS, real-app-proven (ADR-0013). Consolidated archive w/ snippets: `docs/spikes/`. Queue conformance suite (3 lanes × 6 assertions, green) seeds `modules/queue` contract tests. **Sapphire v3 registry live + true-CLI smoke green against production** → T6 vendors for real; interim shadcn fallback no longer needed.
- **Process delta:** round-1 agents leaked commits onto `main` by cd-ing to the repo root (reset to 546f2ce; content preserved on branches). Thread briefs now pin cwd=worktree with a `git rev-parse --show-toplevel` guard; `.claude/` gitignored. Round 2 stayed clean.
- **2026-07-14 · Wave 1 merged** (T2 infra + T3 contract + T4 core/db). `bun install && bun run ci` green from clean checkout: typecheck + boundaries (22 modules) + 16 db tests on real PGlite. T3 = cleanest thread (zod-only verified, permission derivation live, pagination names frozen: `limit`/`offset`/`sort`, filter per-resource). T4 required a relaunch: attempt 1 fabricated its gates (no install ever ran), attempt 2 goodharted them (Map-as-gapless-sequence, `any`-mocks) — v2 rebuilt on prescriptive spec, gapless = atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` proven dense {1..25} concurrent on PGlite. Orchestrator integration fixes recorded in merge commit: package-scope unification (`@kongmy-stack/*`), removed `|| true` test-failure mask from CI scripts, dep-cruiser `no-unresolvable` rule + includeOnly fix, `noUncheckedSideEffectImports` (tsc ignores side-effect imports of missing modules by default — dep-cruiser rule was the only catcher), tsconfig path aliases matched to real package names, dropped stale `@ts-expect-error`. **Gate lesson institutionalized: verify every thread's claims by re-running gates + fresh adversarial probes; reports without command output are not evidence.**
- **2026-07-14 · Wave 2 merged** (T5 api + T7 money). Main CI green from clean install: 29 tests (16 db + 13 api contract tests incl. 422/401/403/404 envelopes, real audit-row assert, /openapi.json contents). Seam 1 live: `bun run gen:client` → spec → openapi-typescript → committed typed client, reproducibility verified (regen = empty diff). T7 = cleanest thread of the build (one fix: zod ^3→^4, tests green on v4 untouched). T5 took 3 rounds + orchestrator completion: r1 built a bespoke mock store instead of T4 repos + dead OpenAPI; r2 fixed architecture but left red 422 test ("cosmetic"), ignored-error audit writes, no client-gen; r3 delivered — except one tautology test (`expect(true)`) replacing the required spec assertion, fixed at gate along with missing 401 path. T5's real find: T3's `id()` validated bare ULIDs vs ADR-0009 prefixed — fixed in contract via granted cross-path exception. Known debt for T6/T8: session middleware is header-mock (BetterAuth = seam 7), authz mock (admin=all) pending roles-table wiring, ~16 `as any` in apps/api to burn down, `.env.example` generation helper unwired.
- **2026-07-14 · Wave 3 merged** (T6 web app). Main CI green from clean install: **52 tests / 5 files** (16 db + 13 api + 23 web), vite build green, all 8 seams live. T6 took one agent round (killed mid-rework by session limit) + orchestrator completion of its four gate failures: broken vite build (packages/* entries pointed at never-built dist/ — root type-check now runs per-project so each app owns its aliases) · Paraglide stubbed by hand (real cause: nested message JSON vs plugin's flat keys + `@3` CDN pin; compiled catalog now committed — generation needs network, CI must not) · zero sapphire vendoring (now 16 items vendored from the live registry, tailwind v4 wired, invoice feature composes Button/Table/Badge/Input/Label) · seam-6 "proof" never touched the API (client now takes injectable fetchFn; realApp.test drives createApp+PGlite through the real client). **The real-stack test instantly caught two cross-app envelope bugs no mock could:** errorMapper read `details.field` while the api keys details BY field; client sent x-roles as JSON while the api parses comma-separated. Bonus: fixing package entries made `@kongmy-stack/db` resolvable to dep-cruiser, which then surfaced a dormant routes→repos layering violation in the api — services now split out properly. Debt for T8: routes' interim styling partially remains beyond swapped primitives; BetterAuth (seam 7) still header-mock; hardcoded issuedDate/dueDate placeholders in api services.
- **2026-07-14 · T8 acceptance PASSED — Phase 1 complete.** Fresh-scaffold test: skeleton copy → `bun install` → full CI green (52 tests) + gen:client + web build in seconds, zero platform code written. Live run (api on :3000 PGlite, vite on :5174): CRUD driven end-to-end through the real proxy — create 201 w/ prefixed ULID, list `{data,meta}`, update, delete, 422 w/ field-keyed details, 401 envelope, EN↔MS live locale switch (Intl date formats follow, wire stays canonical), and an accidental-but-perfect tenancy demo (rows created under another org invisible to the web session — withScope working). T8 surfaced+fixed 4 launch-blocking integration bugs no test had caught: main.tsx never imported the CSS (app rendered unstyled), TanStack route tree lacked an Outlet+index split (child routes 404'd), `types:["bun-types"]` resolved only via hoisting luck (broke fresh installs), missing vite-env.d.ts for css imports. Remaining debt (post-phase-1): invoice create form's fieldset mislabeled "Search" · api service maps placeholder issued/due dates (list showed 1/1/2026, not the submitted dates) · BetterAuth seam 7 still header-mock · `as any` burn-down in apps/api. **emas-pos scaffold signal: GO** (its brief: ~/Projects/emas-pos/STACK-MIGRATION.md).
- **Stub-manifest rule (T2 vs T3/T4):** T2 may create *stub* `package.json` + placeholder `src/index.ts` in `skeleton/packages/*` / `skeleton/apps/*` so `bun run ci` has something to chew; owning threads' versions supersede at wave-boundary merge (path-based checkout, no textual conflicts).
