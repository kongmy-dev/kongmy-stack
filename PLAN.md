# kongmy-stack — Build Plan

> Decided 2026-07-13. Full rationale: vault note `Resources/Dev & Infra/API Stack & Template Architecture — kongmy-stack.md`. Working summary in `CLAUDE.md`. This file: what to build, in what order, and why each piece earns its place.
> **Parallel kickoff: see `EXECUTION.md`** — frozen layout, wave/dependency graph, and per-thread briefs (T1–T8) with disjoint file ownership.

## Strategy

**Construction with a live customer, not extraction.** emas-pos (`~/Projects/emas-pos`) is greenfield WIP and the largest upcoming build; it consumes this template as it forms. Build order = whatever emas-pos needs next. This keeps every abstraction honest — nothing enters the template that a real product didn't pull — and avoids the historical failure mode where platform code is born inside a product (`@aurum/*`) and never extracted.

**Strengths this design banks on:**
- *One SSOT, five outputs* — a zod contract drives route validation, OpenAPI, MCP tools, generated clients, and form/URL validation. Boilerplate that was previously rebuilt per project (validation middleware, error handlers, hand-written API clients) is structurally impossible to rebuild wrong.
- *Vendored distribution* — consumers own their copy; no version treadmill; per-client divergence is editing a file, not forking a package. Survives a solo maintenance budget.
- *Runtime ladder preserved* — the same code moves Workers ↔ Bun ↔ Node, and PGlite ↔ Neon, because runtime/storage specifics sit behind two seams.
- *MCP surface nearly free* — the agentic module exposes the same audited service layer to REST and MCP; autonomy gating (suggest/assist/auto) is a sellable pattern for agentic B2B.

## Phase 1 (both halves, emas-pos-driven)

### 1a. Spikes first (half-day each — they de-risk locked-but-unverified choices)
- **Spike A: pg-boss on PGlite.** pg-boss was chosen for battle-tested retry/backoff/poison handling, but emas-pos runs embedded PGlite. If pg-boss runs on PGlite → the minimal-SQL fallback impl dies (less code). If not → fallback is confirmed as the PGlite lane. Either result is a win; not knowing is the only failure.
- **Spike B: `@hono/zod-openapi` with zod v4.** Contract-first is locked; the adapter is not. Validate route definition ergonomics + zod v4 compat. Fallback: `hono-openapi`. Guard: contracts import only zod, so swapping adapters later stays cheap.

### 1b. Skeleton
- `packages/contract`: zod schemas, error codes, pagination conventions (limit/offset/sort/filter — the names used everywhere downstream)
- `packages/db`: drizzle + `withScope(org, branch)` tenancy + adapter seam (postgres | pglite | in-memory)
- `apps/api`: Hono + OpenAPI adapter, ONE errorHandler + `AppError` map, routes as thin adapters (parse → service(ctx, input) → respond)
- Client generation: contract → OpenAPI → typed TS client
- Tooling baseline: bun workspaces, biome, dep-cruiser rules (layering as CI-enforced law), `bun run ci`, docs/adr seeded with the locked decisions

### 1c. Frontend skeleton (`apps/web`)
- TanStack Router (file-based) + Query wired to the generated client
- The 8 seams implemented once (see CLAUDE.md): queryOptions factories, DataTable↔pagination, zodResolver forms, search-param validation, error→form/toast mapping, auth guards
- UI vendored from the sapphire-ui registry (~15 components + admin blocks — sapphire side tracked in `~/Projects/sapphire-ui/REGISTRY-PLAN.md`)
- `features/` structure with one worked example feature (CRUD + list + form) as the copyable pattern

### 1d. First consumption
- emas-pos scaffolds from the skeleton; its parallel `theme.css` + `packages/ui` retire; its platform needs (money, events) get built HERE as modules and vendored back.

## Phase 2+ (pull-driven, in likely order)

1. `modules/money` — Money/Weight VOs (from Aurum, generalized), fast-check property tests. emas-pos pulls immediately.
2. `modules/queue` — the interface + pg-boss impl (+ PGlite impl per Spike A) + scheduler.
3. `modules/events` — canonical envelope + HLC + transactional outbox + in-proc bus (from Aurum, generalized).
4. `modules/agentic` — registry.execute() door, tool definitions derived from contract zod (`z.toJSONSchema`), autonomy gate, `/mcp` endpoint.
5. `modules/connector` — canonical model + real/fake gateway adapter pair + sync-job tables + verify-invariant scripts (from settlement-middleware, generalized).
6. Kotlin client pipeline (OpenAPI → KMP client) — when the first mobile-sharing project lands.
7. `registry/` — shadcn-format manifests for backend modules so `shadcn add` works uniformly (earn it after modules are proven; copy script is fine until then).
8. `bun create` polish: post-create archetype prompt.

## Acceptance criteria for "phase 1 done"

- [x] A new project scaffolds via `bun create kongmy-dev/kongmy-stack` and reaches a running CRUD feature (API + web) in under an hour without writing any platform code — *T8 2026-07-14: fresh copy → install → full CI green in seconds; live CRUD driven in the browser (create/list/edit/delete, 422→field, 401, EN↔MS locale switch, tenancy isolation observed)*
- [x] `bun run ci` green: typecheck (per-project) + dep-cruiser boundaries + tests — *52 tests / 5 files from clean install*
- [x] Zero hand-written fetch/client code anywhere; zero routes without contract schemas — *client = generated types + thin wrapper (seam 1); routes wired from contract schemas; boundaries CI-enforced*
- [ ] emas-pos consuming the skeleton for at least one real screen end-to-end — *scaffold signal issued; tracked in emas-pos*
- [x] Both spikes resolved and their outcomes recorded in docs/adr — *ADR-0011/0012/0013 + docs/spikes/ archive; conformance-hardened*

## Non-goals

- No published npm packages. No semver. No support commitments (public README states this).
- No speculative modules — a module is built when a consumer pulls it.
- No Next.js, no Turbo, no message broker. Escalation paths are documented in the vault note; they trigger on evidence, not anticipation.
