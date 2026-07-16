# kongmy-stack

Personal full-stack template system by [KONGMY Digital Solutions](https://kongmy.dev) — the frozen platform decisions behind my product and client work, published so cloning, vendoring, and AI-agent tooling work with zero credentials.

> **Public, not maintained-for-you.** No support, no roadmap, no semver — breaking changes land without notice. Fork freely (BSD-3).

## What works today

**Phase 1 complete** — skeleton + 4 core modules, all seams live (122 skeleton tests + 62 module tests + 10 Playwright smoke).

- **Backend:** [Hono](https://hono.dev) + contract-first [zod](https://zod.dev) single source of truth → routes, OpenAPI, and generated clients from one definition. Postgres at every altitude ([PGlite](https://pglite.dev) embedded for dev/test → [Neon](https://neon.tech)) via [Drizzle](https://orm.drizzle.team). Runtime-neutral core (Bun + Node + Workers).
- **Frontend:** Vite + React + [TanStack Router/Query](https://tanstack.com). Forms and URL params validated by the same contract schemas the API enforces. UI primitives from [sapphire-ui](https://design.kongmy.dev) registry.
- **Auth:** Session context (server) + session hook (client) + route guards. BetterAuth wired; Keycloak variant documented.
- **Realtime:** SSE server-sent events for resource updates and audit-feed subscriptions.
- **Observability:** Structured logging, request tracing (W3C traceparent), audit log written at the command door (REST + MCP).
- **i18n:** Compile-time message catalog ([Paraglide](https://inlang.com/m/gerre34r)) with live locale switching in the browser. EN/MS proven.
- **Vendored modules** (copy what you need):
  - **`money`** — Money value objects with decimal.js internals, allocation, multi-currency support
  - **`queue`** — Async job queues: pg-boss on Postgres/PGlite, CF Queues on Workers
  - **`events`** — Event envelope + HLC timestamps + transactional outbox (crash-recovery proven) + in-proc bus
  - **`agentic`** — `registry.execute()` audited command door, zod-derived MCP tool schemas, autonomy gate (suggest/assist/auto)
  - **Planned:** connectors, country-my (Malaysia compliance)

## Quick Start

```bash
# Clone the skeleton
git clone https://github.com/kongmy-dev/kongmy-stack.git my-app
cd my-app

# Install and verify
bun install
bun run ci                      # typecheck + boundaries + 122 tests

# Start the dev server (API on :3000, web on :5174)
bun run dev

# Try the app: create an invoice, list, edit, delete (live tenancy isolation + auth)
```

After cloning, the skeleton is a complete working project with:
- Worked example: Invoices CRUD (api + web, end-to-end)
- All 8 seams live (contract → client, form validation, auth, realtime SSE, audit log, etc.)
- Full CI gate: typecheck + dependency boundaries (22 modules) + test suite

**Add modules later** if you need them:

```bash
# From the original repo, pointing at your clone:
bun scripts/add.ts money --into /path/to/my-app
cd /path/to/my-app && bun install && bun run test
```

Everything is **vendored source** — there are no published npm packages to depend on and nothing to upgrade. Your copy is yours; diverge freely.

## Design principles

1. Contract-first: no route without a schema; never hand-write an API client.
2. Nothing here is a versioned dependency of anything built with it.
3. Runtime-specific code lives behind two seams (config, storage) — everything else is portable.
4. Modules exist because a real project pulled them, never speculatively.

## License

BSD-3-Clause © Kong My / KONGMY Digital Solutions
