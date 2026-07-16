# ADR-0007 — i18n plumbing from day 1 (amends ADR-0004 error messages)

**Status:** accepted 2026-07-13

## Decision

i18n **plumbing** is skeleton content from day 1; translation **content** stays empty until a project needs a second locale. Rationale: retrofit cost is the tiering criterion used everywhere else in this stack, and i18n scores worst-in-class on retrofit — string extraction touches every file, and formatting assumptions calcify. The plumbing is cheap; only translations are expensive, and those are deferred by nature. Consumer projects requiring multi-locale support have proven this pattern in real retail POS systems.

## What "plumbing" means (all cheap, all day-1)

1. **Typed message catalog** — compile-time, tree-shakeable messages with typed keys (missing key = compile error, consistent with ADR-0001's executable-conventions rule). Candidate: Paraglide JS (codegen model fits the vendored/codegen philosophy); fallback: i18next. **Spike C (small): pick one** — criteria: typed keys, bundle cost, Vite + TanStack integration, plural/ICU support.
2. **Every template UI string goes through `t()`** from the first worked example — the discipline is the deliverable; a template with hardcoded strings teaches every consumer to hardcode.
3. **`Intl` for all formatting** — dates, numbers, currency display via `Intl.*` with explicit locale (zero deps, built into JS/Kotlin both). Wire stays canonical (UTC ISO-8601, minor units per ADR-0004); locale applies at render only.
4. **Locale in ctx** — user setting, falling back to tenant setting, falling back to `en`. Server knows locale for notifier templates (ADR-0006) and document generation (receipts, invoices).
5. **Errors: codes travel, text is rendered client-side** — see amendment below.

## Amendment to ADR-0004

`error.message` is **English debug text only** (logs, API explorers, agents). UIs derive display text from `error.code` + typed `details` params through the message catalog. This was already implicit in "codes are stable API surface — clients branch on them"; i18n makes it explicit. Consequence: adding a locale never touches the API.

## What stays English (deliberately)

- Contract `.describe()` — feeds OpenAPI + MCP `tools/list`; agents and generated docs consume English.
- `ToolResult.summary` — written for the LLM; a locale parameter can come later if an agent-facing product demands it.
- Logs, ADRs, code.

## Boundaries

- sapphire-ui: already i18n-correct by design — components take text via props/attributes, never embed copy (its web-components layer documents this). Nothing to change there; the catalog lives app-side.
- No locale routing (`/en/…`) in SPAs — locale is a user/tenant setting, not a URL concern. Next.js SEO surfaces (out of template scope) decide their own URL strategy.
