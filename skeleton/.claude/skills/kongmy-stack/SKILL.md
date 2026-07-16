---
name: kongmy-stack
description: Build CRUD resources + action verbs + MCP tools from contracts; pull vendored modules (money/queue/events/agentic); wire realtime SSE, auth seams, and MCP registry; run CI gates in a kongmy-stack clone.
---

# kongmy-stack Consumer Skill

Contract-first zod SSOT, vendored source, CLI-only (Bun), 8 marriage seams. The laws live in `docs/adr/` (ADR-0001 through ADR-0010 + 0011–0013 for i18n, queue, OpenAPI adapter).

## Add a Resource (CRUD + form + API client)

1. **Contract**: `packages/contract/src/` — author zod schemas for list/get/create/update, then wrap with the `resource()` helper (in `packages/contract/src/helpers.ts`):
   ```typescript
   export const invoiceResource = resource({
     name: 'invoice',
     listSchema: invoiceListItem,
     getSchema: invoiceDetail,
     createSchema: invoiceCreate,
     updateSchema: invoiceUpdate,
   });
   ```
   The helper derives 4 CRUD routes + 4 permissions automatically. **Every field must have `.describe()`** (MCP tool descriptions); no `z.any()` (CI-enforced via `bun scripts/check-contracts.ts`).

2. **Backend service** — author 5 functions: `listInvoices(ctx)`, `getInvoice(ctx, id)`, etc. Signature: `(ctx: RequestContext, ...) => Promise<T>`. Repo layer touches the database.

3. **Routes**: `apps/api/src/routes/` — wire routes using the `registerResource()` helper from `apps/api/src/lib/registerResource.ts` (reads the contract and calls your service functions). See `docs/guides/register-resource.md` for complete walkthrough.

4. **Frontend queryOptions**: `apps/web/src/features/` — use `queryOptions()` factories over the generated API client (`apps/web/src/lib/api.ts` after running `bun scripts/gen-client.ts`).

5. **Frontend form**: use `zodResolver(invoiceResource.createRoute.inputSchema)` with react-hook-form. Error mapping is mechanical: `VALIDATION_ERROR.details.field → form.setError(field)`, else toast.

6. **Generated API client**: Run `bun scripts/gen-client.ts` after updating contracts. Emits `apps/web/src/lib/api.ts` (type-safe TypeScript, one-line per operation).

## Add an Action Verb (RPC + MCP tool + permission)

An action is a business verb (send, approve, archive) that maps 1:1 to an MCP tool.

1. **Contract**: `packages/contract/src/` — wrap with the `action()` helper from `packages/contract/src/helpers.ts`:
   ```typescript
   export const sendInvoice = action({
     name: 'send',
     resource: 'invoice',
     summary: 'Send invoice to customer',
     inputSchema: sendInvoiceInput,
     outputSchema: invoiceDetail,
     category: 'write',
   });
   ```
   Derives: route `POST /invoices/:id/send`, permission `invoice:send`, MCP tool. Tool outputs use the `ToolResult` shape (see `packages/contract/src/helpers.ts`).

2. **Service function** — implement the handler.

3. **Route** — wire it as a normal Hono route that calls your service.

4. **MCP registry** — the registry derives the tool descriptor from the contract. See `docs/guides/seams.md`.

5. **Frontend** — client can call via the generated API client or (if autonomous) via the agentic module.

## Pull a Module

Modules are copyable vendored source. From a local clone of the **kongmy-stack template repo**, run:

```bash
bun scripts/add.ts <module-name> --into /path/to/your/consumer/project
```

(Note: `kongmy-stack/scripts/add.ts` is the template repo tool, not available in consumer clones.)

The script copies the module into `<your-project>/packages/<module>`, adds the workspace entry to `package.json`, and merges dependencies. Then: `bun install && bun run test` to verify.

**Example:** From template repo clone, add queue module to consumer project at `~/Projects/my-app`:
```bash
bun scripts/add.ts queue --into ~/Projects/my-app
```
This creates `~/Projects/my-app/packages/queue` and patches `~/Projects/my-app/package.json` workspaces.

**Four modules available:**
- `money`: Money value objects (decimal.js internal), allocation logic, integer minor units on wire.
- `queue`: ONE enqueue/worker interface, three implementations for async job processing.
- `events`: Event backbone with zod envelope, HLC timestamps, transactional outbox, and in-proc pub/sub bus.
- `agentic`: Audited command door, autonomy gate (suggest/assist/auto), MCP JSON-RPC transport.

After pulling, consult the module's README for API details.

## Wire Realtime Updates (SSE + Query Invalidation)

Events published to SSE subscribers trigger Query invalidations (not payload-as-state).

1. **Backend**: See `docs/guides/realtime-sse.md`. Publish events via the realtime seam. Each event type drives which query keys to invalidate.

2. **Frontend**: The realtime seam (`apps/api/src/lib/realtime.ts` on backend) is paired with a frontend hook that subscribes to SSE and invalidates Query cache by prefix. Query prefix-matching invalidates all keys starting with that prefix (list + detail keys both covered by one prefix invalidation).

3. **Playwright waits**: Use `page.waitForURL()` or `page.waitForSelector()` (deterministic UI changes), not `networkidle` (SSE connections stay open; `networkidle` never settles).

## Wire Auth

Two halves, same contract:

- **Backend**: `apps/api/src/lib/session.ts` — `getSession(ctx)` returns `{userId, tenantId, ...}` or null. Seam interface (default: BetterAuth; OIDC/Keycloak variant documented in `docs/guides/seams.md`).
- **Frontend**: Session hook + TanStack Router beforeLoad guards. Query cache cleared on logout.

See `docs/guides/seams.md`.

## Run the Gates

`bun run ci` = typecheck + boundary-check + contract compliance check + skill reference check + tests. Individual gates:

- `bun run typecheck` — tsc across all packages/apps
- `bun run boundary-check` — dependency-cruiser enforces allowed imports from ADR-0001
- `bun scripts/check-contracts.ts` — every field `.describe()`'d, no `z.any()`
- `bun scripts/check-skill-refs.ts` — all paths in this skill exist
- `bun run test` — all test suites

All must exit 0 before commit. See `package.json` for the full chain.

## Conventions (Enforced)

| What | How It's Enforced |
|------|-------------------|
| Contracts import only zod | `bun run boundary-check` (dependency-cruiser, ADR-0001) exits 1 if violated |
| Every contract field has `.describe()` | CI gate `bun scripts/check-contracts.ts` exits 1 if missing |
| No `z.any()` or `z.unknown()` in contracts | CI gate `bun scripts/check-contracts.ts` exits 1 if found |
| routes → services → repos layering | `bun run boundary-check` (dependency-cruiser) enforces allowed imports |
| Errors are one envelope shape | type enforcement (see `packages/contract/src/errors.ts`) |
| Audit logged at the command door | enforcement point in route middleware |

## Gotchas (Verified)

1. **@hookform/resolvers must stay `^5` with zod v4** — v3 hangs on validation failure. Locked in `apps/web/package.json`.

2. **Bun.serve idleTimeout** — set `idleTimeout: 0` or SSE connections drop at 10 seconds. See `apps/api/src/main.ts`.

3. **TanStack Query invalidation is prefix-matching** — `invalidateQueries({queryKey: ["invoices"]})` covers both `["invoices"]` (list) and `["invoices", id]` (detail). One invalidation covers the whole resource.

4. **Stale Vite dep cache after lockfile changes** — run `rm -rf node_modules/.vite apps/web/node_modules/.vite` if builds break mysteriously. Bun's symlinks can get confused.

5. **Live SSE makes Playwright `networkidle` never settle** — use deterministic waits. See `acceptance/smoke.e2e.ts` for patterns with `page.waitForURL()`.

## Path Convention for SKILL.md Maintenance

When editing this skill, use the following convention to distinguish consumer-relative paths from template-repo paths:

- **Consumer paths** (checked by lint): reference the consumer's copy of the skeleton. Examples: `docs/guides/register-resource.md`, `apps/api/src/lib/registerResource.ts`, `package.json`. Lint exits 1 if these don't exist.
- **Template-repo paths** (skipped by lint): reference the original kongmy-stack template repo on disk. Prefix these with `kongmy-stack/` to mark them as external. Examples: `kongmy-stack/scripts/add.ts`, `kongmy-stack/modules/`. Lint ignores these.

This ensures the skill remains correct as consumers clone the skeleton and the template repo diverges.
