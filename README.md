# kongmy-stack

Personal full-stack template system by [KONGMY Digital Solutions](https://kongmy.dev) — the frozen platform decisions behind my product and client work, published so cloning, vendoring, and AI-agent tooling work with zero credentials.

> **Public, not maintained-for-you.** No support, no roadmap, no semver — breaking changes land without notice. Fork freely (BSD-3).

## What's in it

- **Backend:** [Hono](https://hono.dev) + contract-first [zod](https://zod.dev) single source of truth → routes, OpenAPI, MCP tools, and generated clients from one definition. Postgres at every altitude ([PGlite](https://pglite.dev) → [Neon](https://neon.tech)) via [Drizzle](https://orm.drizzle.team). Runtime-neutral: the same code runs on Bun, Node, and Cloudflare Workers.
- **Frontend:** Vite + React + [TanStack Router/Query](https://tanstack.com), forms and URL state validated by the same contract schemas the API enforces. UI vendored from the [sapphire-ui](https://design.kongmy.dev) registry.
- **Modules** (copy what you need): queue, events/outbox, agentic (MCP tool server + autonomy gating), money, connector.

## Use

```bash
bun create kongmy-dev/kongmy-stack my-app
cd my-app && bun install
bun scripts/add.ts queue        # vendor a module
bun run ci                      # typecheck + boundary rules + tests
```

Everything is **vendored source** — there are no published packages to depend on and nothing to upgrade. Your copy is yours.

## Design principles

1. Contract-first: no route without a schema; never hand-write an API client.
2. Nothing here is a versioned dependency of anything built with it.
3. Runtime-specific code lives behind two seams (config, storage) — everything else is portable.
4. Modules exist because a real project pulled them, never speculatively.

## License

BSD-3-Clause © Kong My / KONGMY Digital Solutions
