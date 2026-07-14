# Spike C — i18n catalog: Paraglide JS, proven in a real app

**Pick:** Paraglide JS (ADR-0013). Two rounds: node-side comparison vs i18next (typed keys, bundle, tree-shaking), then a **real Vite + React + TanStack app** with live en→ms→zh switching — 5/5 component tests green (`spikes/c-i18n-catalog/app/`).

## Why it won

- **Missing/misspelled key = compile error** — codegen-enforced, no discipline required (i18next can't stop `t("typo")` even with a hand-maintained enum). This is ADR-0001's "constraints must be executable" applied to strings.
- Generated messages are pure tree-shakeable functions: 2.2 KB runtime vs ~98 KB full i18next.
- Vendored-source-safe: the compiled catalog in `src/paraglide/` keeps working even if upstream dies.

## Live locale switching — no adapter, no hacks

Messages are pure functions reading the current tag at call time; a tiny context triggers the re-render:

```tsx
// localeContext.tsx (full version in spikes/c-i18n-catalog/app/src/)
import { setLanguageTag, languageTag, onSetLanguageTag } from './paraglide/runtime';

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(() => languageTag());
  const setCurrentLocale = (l: string) => { setLanguageTag(l); setLocaleState(l); };
  useEffect(() => { onSetLanguageTag((tag) => setLocaleState(tag)); }, []);
  return <LocaleContext.Provider value={{ locale, setCurrentLocale }}>{children}</LocaleContext.Provider>;
}

// any component — re-renders on switch, m.* re-read the tag
const { setCurrentLocale } = useLocale();
<p>{m.user_greeting({ name: 'Kong' })}</p>
```

## Error-code rendering (ADR-0007 pattern)

API sends `{code, details}`; UI renders from the catalog — `error.message` stays English debug:

```tsx
// pages/ErrorDemo.tsx pattern
const msg = m[`error_${err.code.toLowerCase()}`]?.(err.details) ?? err.code;
```

## Build order (T6 copies this)

```bash
paraglide-js compile --project ./project.inlang   # before tsc — generates src/paraglide/
tsc && vite build
```

Messages live in `messages/{en,ms,zh}.json`; config in `project.inlang/settings.json`. Locale resolution (user→tenant→en) lives in the app, not the catalog.

## Known caveats

- Paraglide's inferred JSDoc types for **plural** messages are overly strict → thin wrapper or `@ts-ignore` at the call site. Contain it in ONE wrapper module, don't scatter ignores.
- Compile-time only: no runtime/tenant-defined messages (migration trigger in ADR-0013).
- `test-type-error.ts` demonstrates the compile-error guarantee — keep the pattern in T6's skeleton as a living check.
