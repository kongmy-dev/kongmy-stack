# ADR-0004 — API design: wire conventions & MCP-ready schema rules

**Status:** accepted 2026-07-13

Because `packages/contract` is the SSOT, these conventions propagate mechanically into routes, OpenAPI, MCP tools, generated clients, forms, and URL state. They are encoded as **contract helper functions** (authoring with the helpers IS compliance), with this ADR as reference.

## Resource style — REST for nouns, RPC for verbs (deliberate hybrid)

- CRUD = REST resources: `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/:id`. Plural kebab paths, camelCase JSON.
- Business operations = action posts: `POST /invoices/:id/send`. Never contort verbs into REST ("PATCH status to sent" hides a command, losing validation, audit, and the MCP mapping).
- Action endpoints map 1:1 to MCP tools (`invoice_send`) — both are renderings of the same registry command. No tRPC/oRPC/GraphQL (OpenAPI + Kotlin generation requirement); contract layer stays transport-neutral zod.

## Response schema — status codes are the signal

- **Single resource → the object itself.** No `{ success, data }` wrapper — `success` re-states the HTTP status and taxes every consumer.
- **Lists → `{ data: [], meta: { total, limit, offset } }`** — the one earned envelope (DataTable needs `total`). Offset pagination default; cursor pagination is a documented later-variant for proven large feeds.
- **Errors → `{ error: { code, message, details } }`**: 422 validation (details = typed field issues), 401/403/404/409 from `AppError` subclasses, 500 sanitized. Codes SCREAMING_SNAKE and **stable** (clients + agents branch on them). Request-id header echoed in error responses.
- **Scalars:** ISO-8601 UTC timestamps · money = integer minor units · **ids = type-prefixed ULIDs** (`inv_01J8…`) — sortable, greppable, and the prefix catches wrong-id bugs bare UUIDs never do.
- **Versioning: none.** `/api` unversioned + additive-only evolution (expand-contract). Generated clients redeploy with the API. `/v2` path is the documented escape hatch for a specific external consumer that cannot move.
- **Idempotency-Key** header accepted on action posts — convention now; enforcement lands with the money module (double-submit hurts exactly there).

## MCP-ready schema rules

1. **Descriptions mandatory, CI-enforced.** Every contract field + operation carries `.describe()` — it becomes OpenAPI docs, MCP `tools/list` descriptions, and the only thing an agent knows about the API. Undescribed = CI failure (describe-coverage script).
2. **No `z.any()` / `z.unknown()` in contracts** — unreasonable for agents, ungenerable for Kotlin. CI-checked.
3. **Bounded inputs:** enums over free strings for closed domains; flat-ish input objects; defaults declared in-schema so tools are callable with minimal args.
4. **Tool naming `domain_verb`**, derived from the action registry — never a second hand-maintained list (reference failure: hand-written tool JSON Schemas one directory from the zod truth).
5. **Tool outputs are summaries, not dumps:** `ToolResult { ok, summary, data }`, `summary` written for the LLM, `data` trimmed — raw row dumps burn agent context. Same `AppError` codes render as tool errors with actionable messages.

## Contract helpers (the enforcement surface, built in phase 1b)

- `listResponse(schema)` → data/meta envelope · `paginationQuery` → limit/offset/sort/filter names (final, propagate everywhere)
- `resource(name, {...})` → CRUD contract set · `action(name, input, output)` → RPC route + MCP tool registration
- `id('inv')` → prefixed-ULID branded type · CI: describe-coverage + no-any checks in `bun run ci`
