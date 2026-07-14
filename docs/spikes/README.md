# Spike results archive

> Consolidated outcomes of the Phase-1a spikes (T1, 2026-07-14), kept for future reference.
> Each entry: the pick, what was **actually verified by running code**, the key snippets, and what downstream threads must carry forward.
> The binding decisions live in `docs/adr/0011–0013`; full runnable evidence lives in `spikes/`.

| Spike | Pick | ADR | Evidence code |
|---|---|---|---|
| B — OpenAPI adapter | `@hono/zod-openapi` (zod v4 proven) | [0011](../adr/0011-openapi-adapter.md) | `spikes/b-zod-openapi/` |
| A — Queue on PGlite | pg-boss on **all** PG lanes; SQL fallback dead | [0012](../adr/0012-queue-pglite-lane.md) | `spikes/a-pgboss-pglite/conformance/` |
| C — i18n catalog | Paraglide JS (real-app proven) | [0013](../adr/0013-i18n-catalog-lib.md) | `spikes/c-i18n-catalog/app/` |

Details with snippets: [openapi-adapter.md](openapi-adapter.md) · [queue-pgboss.md](queue-pgboss.md) · [i18n-paraglide.md](i18n-paraglide.md)

## Method note (worth keeping)

Each spike ran twice, deliberately:

1. **Feasibility round** — "can we?" Fast, node-side, answers the compatibility question.
2. **Conformance round** — "does the promise hold?" The same assertions across every lane/altitude (queue), or the real integration environment (i18n).

The feasibility round alone produced two evidence gaps (dead-letter never asserted; restart durability "verified" on an in-memory store) and left the riskiest i18n edge (React re-render on locale switch) untested. Rule distilled: **a ✅ in a report tells you what was run, not what was asserted** — every claim that survives into an ADR must be backed by an executable assertion. The queue conformance suite is that rule made permanent: it gets lifted into `modules/queue` as its contract tests.
