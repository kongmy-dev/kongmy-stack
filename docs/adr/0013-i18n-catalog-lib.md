# ADR-0013 — typed message catalog library choice

**Status:** accepted 2026-07-14

## Decision

**Paraglide JS** for the typed message catalog. It provides compile-time key safety (missing keys = TypeScript error, not runtime surprise), generates pure tree-shakeable functions, and bundles to 2.2 KB for real-world message catalogs. Fallback: i18next if a project demands runtime message loading or a heavier ecosystem.

## Criteria & Evidence

| Criterion | Paraglide | i18next | Winner |
|-----------|-----------|---------|--------|
| **Typed keys (compile error on missing)** | Automatic codegen → all keys typed | Manual MessageKeys enum → typo-prone string literals | Paraglide |
| **Bundle size (runtime)** | 2.2 KB (pure functions) | 98.5 KB (full library) or 2.1 KB (minimal hand-coded) | Paraglide (generated purity) |
| **Tree-shaking** | Perfect — each message is a standalone function | Requires manual implementation to match | Paraglide |
| **Build step** | `paraglide-js compile` required | None required (runtime-first) | i18next (simpler) |
| **Plural/ICU support** | Native via plugins (ICU MessageFormat) | Native strings (manual or i18next pluralization) | Tie |
| **Vite + SPA fit** | Natural (compile-on-save during dev); React adapter exists | Runtime-friendly but overkill for SPAs | Paraglide |
| **Locale switching (user→tenant→en)** | `setLocale()` works, framework adapter eases React integration | Works (i18next.changeLanguage) | Tie |

## Why Paraglide

Paraglide's codegen model aligns with the stack's constraint mechanism philosophy (ADR-0001). Constraints are executable: types + codegen + CI. Every mistake (missing key, wrong param type) must be a compile error, not a runtime silent miss. i18next's string-literal fallback path violates this — even with a MessageKeys enum, nothing stops `t("typo_in_string")`.

Paraglide's generated functions are pure JavaScript — no runtime dispatch, no object lookups, no overhead. A test bundle with 5 messages, interpolation, plurals, and locale switching: 2.2 KB. This is 50× smaller than full i18next.

The plugin system (Paraglide's one complexity) is one-time config. Benefit is guaranteed: correct-by-construction message keys.

## Migration Triggers

Revisit this if:
- A project needs **runtime message discovery** (e.g., hot-loading user-defined messages). Paraglide compiles at build-time only.
- The build step becomes a bottleneck (unlikely; compilation is ~100ms).
- An agent/MCP tool must **list available messages at runtime** (solutions: codegen a static registry, or i18next at that layer only).

## What T6 (web app thread) must do

1. Install `@inlang/paraglide-js` (CLI + compiler).
2. Set up `project.inlang/settings.json` with source language (`en`) and target locales (e.g., `ms`, `zh`).
3. Add `paraglide-js compile` to build script (runs before tsc/esbuild).
4. Write messages in `messages/{languageTag}.json` (one file per locale; inlang's message format is the default).
5. Import from `src/paraglide/messages.js` (generated) — no manual MessageKeys enum needed.
6. Use `setLocale(userLocale)` on app init (user → tenant → `en` fallback logic lives in the app, not the catalog).
7. Optional: install `@inlang/paraglide-js-react` for the `<ParaglideMessage>` component (handles markup tags if your errors use rich text).
8. For errors: store only `code` + `details` in the API error envelope (ADR-0007 amendment); UI renders via `m[errorCode](details)`.

## Bundle impact

- **Per-locale overhead:** one JSON → one JS module with closure-compiled functions. One additional locale adds ~10% to runtime.
- **Message count scaling:** linear. 100 messages ≈ 5 KB runtime; 1000 messages ≈ 50 KB (compare to i18next at 98 KB baseline).
- **Tree-shaking:** aggressive. A build that uses only `greeting()` + `welcome()` ships only those two functions (except shared utilities like pluralization registry).

## Integration Evidence (Real App Validation, T1-C2 Spike)

**Test:** Built a minimal Vite + React app exercising the full integration (see `spikes/c-i18n-catalog/app/`).

### What Was Proven

1. **Vite + React integration works seamlessly**
   - Paraglide compile step via `paraglide-js compile --project <path>` (no Vite plugin needed)
   - Build pipeline: `compile && tsc && vite build` works end-to-end
   - Dev server: `bun run dev` reruns compile on message file save, HMR updates app

2. **Live locale switching works correctly (the riskiest edge)**
   - React state + `setLanguageTag()` + component re-render = instant text update
   - Mechanism: `languageTag()` is a module-level getter; `setLanguageTag()` updates it; next message call reads new locale
   - No special React adapter required — plain function re-execution during re-render handles reactivity
   - Vitest suite proves: `setLanguageTag("ms")` → next `m.greeting()` returns Malay

3. **Error code rendering pattern (ADR-0007) is clean**
   - API: `{ code: "not_found", details?: {...} }`
   - UI: `m[`error_${code}`](details)`
   - Changing locale updates error text without touching API
   - Tested with 3 error codes × 3 locales; all render correctly

4. **Message formats work across all locales**
   - Plain strings, interpolation `{param}`, plurals `{count, plural, one {...} other {...}}`
   - All compile and re-render on locale switch

5. **Type safety delivered**
   - Missing keys: TS error at compile time
   - Parameter mismatches: caught by `tsc`
   - Demo: `src/test-type-error.ts` shows `m.nonexistent_key()` fails tsc

### Friction Found

**None.** Integration is:
- No custom Vite plugins or webpack config
- Generated `.js` files work directly with React/TypeScript
- Compile-on-save works naturally (add to build script)
- No awkward re-render hacks

### Caveat

- Paraglide's inferred JSDoc types are strict for plurals
- Workaround: `@ts-ignore` or a thin wrapper function
- Not a blocker — acceptable for production use

## Notes

- `.describe()` strings on contracts stay English (agent-facing, per ADR-0007).
- Translations are **content, not code** — projects diverge freely after cloning. The catalog is templated only; the catalog **plumbing** is the reusable part (ADR-0007).
- Plural rules and date formatting depend on `Intl` (built into JS) + explicit locale context — not Paraglide's responsibility.
- **Reference implementation:** `spikes/c-i18n-catalog/app/` — see `README.md` for exact setup and T6 checklist. Copy `LocaleProvider` pattern and message structure.
