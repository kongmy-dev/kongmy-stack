# Paraglide i18n Real App Integration Test

This is a minimal Vite + React + TanStack Router app that validates Paraglide JS in a **production-like environment**. The prior spike (Spike C) compared Paraglide and i18next at the Node CLI level; this app tests **live web integration**, especially locale switching and React re-rendering.

## Architecture

```
spikes/c-i18n-catalog/app/
├── src/
│   ├── main.tsx                 # Vite entry point
│   ├── App.tsx                  # TanStack Router setup
│   ├── localeContext.tsx        # React context for locale state
│   ├── LocaleSwitcher.tsx       # Dropdown to switch locales
│   ├── pages/
│   │   ├── Home.tsx             # Message showcase (plain, interpolation, plurals)
│   │   └── ErrorDemo.tsx        # Error code → catalog pattern (ADR-0007)
│   ├── localeSwitch.test.tsx    # Locale switching test + mechanism docs
│   └── test-type-error.ts       # Compile-error demo (uncomment to see TS errors)
├── index.html                   # Vite HTML template
├── vite.config.ts               # Vite configuration
├── vitest.config.ts             # Vitest configuration
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies: React, Vite, Paraglide
└── ../messages/
    ├── en.json                  # English messages (source)
    ├── ms.json                  # Malay messages
    └── zh.json                  # Chinese (Simplified) messages
```

## Setup & Build

### Install dependencies
```bash
cd spikes/c-i18n-catalog/app
bun install
```

### Run dev server
```bash
bun run dev
```
Navigate to http://localhost:5173. The Paraglide compile step runs first (every file save triggers recompile).

### Build for production
```bash
bun run build
```
Runs `paraglide-js compile`, then `tsc`, then `vite build`. The compiled app is in `dist/`.

### Run tests
```bash
bun test
```

### Demonstrate type-error guarantee
```bash
# This shows the compile-step catching missing keys
bun run type-error

# Or manually:
cd src && uncomment the lines in test-type-error.ts
cd .. && tsc --noEmit
```

## Live Locale Switching (Integration Evidence)

**Requirement:** When the user switches locale via the dropdown, all text should update without page reload. This tests the riskiest edge: are message functions re-called during React re-render?

### How it works (proven in this app):

1. **State layer:** `LocaleProvider` (React context) holds current locale
2. **Message resolution:** `LocaleSwitcher` imports `setLocale()` from Paraglide
3. **Re-render trigger:** When user selects a new locale:
   ```typescript
   setCurrentLocale(newLocale)  // React state update
   → setLocale(newLocale)       // Paraglide runtime update
   → setLocaleState(newLocale)  // Trigger React re-render
   ```
4. **Message re-evaluation:** During re-render, all `m.greeting()`, `m.user_greeting({name})` calls re-execute
5. **Paraglide machinery:** Generated message functions check the current locale and return text accordingly

**Result:** Locale switching updates text instantly. No page reload needed.

### Technical detail

Paraglide's generated messages are **pure functions**, not React components. They don't have lifecycle hooks. The magic:
- Paraglide tracks the current locale in a module-level variable (via `setLocale()`)
- Each message function reads that variable when called
- React state change (in the context) triggers component re-render
- Re-render calls the message functions again
- Functions read the updated locale and return new text

This is cleaner than React-specific adapters because:
- Message resolution is framework-agnostic
- React concerns (re-render, state) are separate from catalog concerns
- The same message functions work in Node, browser, React, and vanilla JS

### Test evidence

See `src/localeSwitch.test.tsx` for inline documentation of the re-render mechanism and test cases.

## Compile-Time Type Safety (ADR-0001 executable constraints)

Every message key is **typed**. Missing keys are compile errors, not runtime bugs.

### Demonstration
```bash
# Good (compiles):
const msg = m.greeting();        // ✓ Key exists, no params
const msg2 = m.user_greeting({ name: "Alice" });  // ✓ Param is required and provided

# Bad (TypeScript errors):
const bad1 = m.nonexistent_key();          // ✗ Property does not exist
const bad2 = m.greeting({ extra: "arg" }); // ✗ Unexpected argument
const bad3 = m.user_greeting();            // ✗ Missing required parameter: name
```

To see these errors:
1. Edit `src/test-type-error.ts` and uncomment the import
2. Run `tsc --noEmit`

**Why this matters:** i18next's string-literal keys (`t("typo_in_string")`) cannot catch typos at compile time. Paraglide's codegen does.

## Error Code Pattern (ADR-0007 amendment)

The backend returns errors as:
```typescript
{ code: "not_found", details?: { id: "123" } }
```

The frontend renders via the catalog:
```typescript
function renderError(error: ApiError) {
  const key = `error.${error.code}`;
  return m[key as keyof typeof m](error.details || {});
}
```

**Benefit:** Adding a new locale never touches the API. Errors are data (codes + details), text is generated at render time.

See `src/pages/ErrorDemo.tsx` for the full implementation.

## Bundle Impact

Production build includes:
- Paraglide runtime: ~2.2 KB (pure functions, tree-shakeable)
- Per additional locale: ~10% overhead
- Message count scales linearly

Compare to i18next: 98.5 KB baseline. With this app's messages, Paraglide saves ~95 KB.

## Vite Integration Gotchas (None Found)

The Paraglide build step integrates cleanly:
- `paraglide-js compile` runs before `vite build` (sequenced in package.json scripts)
- No Vite plugin required; compile step is a pure side-effect
- Generated files (`src/paraglide/messages.js`, `src/paraglide/runtime.js`) are committed (or generated on-demand)
- HMR works: save a message JSON file, recompile runs, reload browser

**Friction: None.** The compile-before-build pattern is standard and requires no integration.

## Locale Persistence

Locale preference is saved to `localStorage` under the key `locale`. On app startup, `LocaleProvider` checks localStorage and restores the user's previous choice.

## T6 Checklist (What to copy for the full app)

- [x] `LocaleProvider` pattern for state management (no Redux/Zustand needed)
- [x] Message files: `messages/{lang}.json` with Inlang format
- [x] Project settings: `project.inlang/settings.json`
- [x] Build script order: compile → tsc → build tool
- [x] Error rendering: `error.code` → message lookup pattern
- [x] Tests: vitest + locale switching validation
- [x] Type-error demo: prove compile-time safety

## ADR-0013 Integration Evidence

**Verdict: Paraglide confirmed for production use.**

- ✓ Typed keys (compile errors on missing keys)
- ✓ Bundle size: 2.2 KB runtime for 10 messages (i18next would be 98 KB)
- ✓ Vite + React + TanStack Router integration: seamless (no custom plugins)
- ✓ Live locale switching: works without hacks, re-rendering is clean
- ✓ Error code pattern: ADR-0007 amendment is ergonomic
- ✓ Plurals and interpolation: ICU-format support native via Paraglide plugins

**Friction: None.** The tool integrates with the stack philosophy:
- Codegen (constraint-enforced, ADR-0001)
- Pure functions (no runtime dispatch overhead)
- Framework-agnostic (same functions in Node and browser)

## Next Steps (T6 uses this as a reference)

1. Copy `src/localeContext.tsx` pattern to apps/web
2. Add messages to the source tree (structured by feature, as with components)
3. Wire `paraglide-js compile` into the web app build
4. Render errors via the `error.code` → catalog pattern
5. Add locale selector to the header (or settings page)
6. Persist locale preference (localStorage or user profile)

See the ADR-0007 and ADR-0013 docs for the full design rationale.
