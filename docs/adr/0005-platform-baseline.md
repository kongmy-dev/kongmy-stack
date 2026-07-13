# ADR-0005 — Platform baseline: day-1 bake-ins

**Status:** accepted 2026-07-13

These were rebuilt differently in every prior project; none are architecturally hard, all are frozen now. Skeleton content, not modules.

## Config & env
- zod-validated env schema at each composition root; **fail fast on boot** with the full list of missing/invalid vars.
- `.env.example` generated from the schema (never hand-maintained).
- Config is read in exactly one module per entrypoint; nothing else touches `process.env`/bindings.

## Observability
- One logger, injected via ctx (never imported). Structured (JSON in prod, pretty in dev).
- **Request-id**: generated (or honored from header) in the first middleware, on every log line, echoed in error responses (per ADR-0004).
- Standard request log line: method, path, status, duration, tenant, request-id.
- `/health` endpoint shape: `{ ok, version, checks: { db, queue? } }`. Graceful shutdown: drain server, close db/queue, exit — written once per runtime recipe.
- Error-reporting seam (Sentry-shaped interface), **off by default**; wiring documented, dep not installed.

## Testing strategy (the pyramid, enforced by example)
- **Contract-level tests are the workhorse**: `app.request()` against the in-memory adapters — no port, no mocks of your own code, full route→service→repo path.
- Unit tests only for `packages/core` (pure functions; fast-check where money/invariants).
- One Playwright smoke per web app (login → worked-feature CRUD), not a suite.
- Test-data factories derived from contract schemas (zod → fakes) — SSOT dividend; no hand-rolled fixture drift.

## DB column conventions
- pk: prefixed ULID (`inv_01J8…`) per ADR-0004; `createdAt`/`updatedAt` (UTC, set in repo layer) on every table.
- **No soft delete by default** — audit belongs to the events module; `deletedAt` only when the domain demands restore semantics.
- Migrations: drizzle-kit generate → commit SQL → migrate on deploy. Seeds: idempotent scripts per env (`seed:dev`, `seed:demo`); never seed prod implicitly.

## Deployment recipes + CI (files in skeleton)
- **Bun single-binary + systemd unit** (`EnvironmentFile=`, `User=`, `WorkingDirectory=` — systemd-native, no shell wrappers) — the default lane.
- Dockerfile (multi-stage, bun) and Workers config — the other two rungs of the runtime ladder.
- One GitHub Actions workflow: `bun run ci` on PR; deploy jobs per recipe, commented until a target exists.

## Agent-docs convention
- The scaffold ships a **CLAUDE.md template**: stack rules pre-filled (ADR summaries, allowed-imports table, commands), project-specifics section blank. Agents inherit the law on day 1 of every project.

## Explicit "no" list (with triggers)
- Feature flags: no — config booleans until a real rollout need.
- Product analytics: per-product decision, never template.
- Backup/restore: lands with the `platform` archetype (on-prem concern).
- Published API docs portal: only when an external consumer exists (OpenAPI is already generated regardless).
