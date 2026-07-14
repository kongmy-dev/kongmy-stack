# Acceptance Layer

This directory contains acceptance-level gates: automated checks that prove the skeleton can integrate and deploy. These gates run **after** fast CI (unit/contract tests), catching integration bugs that unit tests miss by their nature.

## The Testing Pyramid (per ADR-0005)

```
        🎭 Browser smoke (1 spec)
       /        \
      /          \
     /    CI      \
    / (contract    \
   /    tests)      \
  /                  \
 /____________________\
Per-module verify scripts + unit tests (fast-check for Money)
```

- **Per-module verify**: `bun test` + any module-specific checks in its `verify` script
- **CI contract tests**: Full route→service→repo path via `app.request()` + in-memory adapters
- **Fresh-scaffold**: Skeleton copy → `bun install` → full CI → client-gen → vite build
- **Browser smoke**: Real app in a real browser, catching HTML/CSS/routing/form wiring bugs

## What Each Layer Catches

### Unit & Contract Tests (skeleton/\*\*/\*.test.ts + modules/\*/\*.test.ts)
- Pure domain logic (fast-check properties)
- API contract shape: 200/201/400/401/403/404/422 envelope structures
- DB schema and repo functions
- Client type generation from contracts
- **Do not:** test the browser, CSS, or UI routing

### Fresh-Scaffold Gate (skeleton/acceptance/fresh-scaffold.ts)
- `bun install` exits 0 with zero warnings (catches missing deps, broken hoisting)
- TypeScript compiles (`type-check`)
- Dependency boundaries enforced (`boundary-check` via dep-cruiser)
- All tests pass (`test`)
- Client can be generated (`gen:client`)
- Vite builds without errors (`web build`)
- **Catches:** tsconfig hoisting bugs, missing types, unresolvable imports, missing vite-env.d.ts

### Browser Smoke (skeleton/acceptance/smoke.spec.ts)
**ONE spec file, stable selectors via `data-testid` attributes.** Drives the full feature flow:

1. **App loads with styles** (catches missing CSS import in main.tsx)
   - Navigate to `/invoices`
   - Assert a button's `computed background-color` is NOT transparent
   - If CSS isn't loaded, background is `rgba(0,0,0,0)` or `transparent`

2. **Routes work** (catches TanStack route tree issues like missing Outlet)
   - Click "Create Invoice" button
   - Navigate to `/invoices/create` via UI
   - Form renders

3. **Full CRUD end-to-end**
   - Fill form, submit → 201 created
   - List shows new row with entered data
   - Edit: update customer name, save → list reflects update
   - Delete: row removed from list

4. **Validation surfaces correctly** (catches form.setError wiring)
   - Submit empty line items
   - Assert error message visible on the `lineItems` field (not generic toast)

5. **Locale switching works** (catches message catalog or context wiring)
   - Toggle locale EN → MS
   - Assert heading text changes (not hardcoded, using catalog)

### Per-Module Verify Scripts (modules/\*/package.json "verify")
Each module can define its own `verify` script (usually `bun test`). Discovered and run by `bun scripts/verify-all.ts`. Modules ship with:
- `"verify": "bun test"` in package.json
- Any module-specific checks (Money: fast-check properties for allocation correctness)

## Running Locally

```bash
# Run everything (unit + contract + fresh-scaffold + smoke):
bun acceptance/fresh-scaffold.ts && bunx playwright test -c acceptance

# Or separately:
bun run ci                                    # Unit + contract tests
bun acceptance/fresh-scaffold.ts              # Copy, install, build in temp dir
bunx playwright test -c acceptance           # Browser smoke (requires app running)

# Install Playwright (one-time):
bunx playwright install chromium
```

## Adding Data-Testid Attributes

The smoke spec relies on **stable selectors**. Add `data-testid` to key UI elements in `skeleton/apps/web`:

```tsx
// Button to create an invoice
<button data-testid="create-invoice-btn" onClick={goToCreate}>
  Create Invoice
</button>

// Form
<form data-testid="invoice-form">
  <input data-testid="customer-name-input" ... />
  <input data-testid="invoice-number-input" ... />
  {/* Line items */}
  <input data-testid="line-item-description-input" ... />
  <input data-testid="line-item-quantity-input" ... />
  <input data-testid="line-item-price-input" ... />
  <button data-testid="submit-invoice-btn" type="submit">Save</button>
</form>

// List table
<table data-testid="invoices-table">
  <tr data-testid={`invoice-row-${id}`}>...</tr>
</table>

// Error messages (per field, matching form field name)
<div data-testid="lineItems-error">{error}</div>

// Page title (for locale test)
<h1 data-testid="page-title">Invoices</h1>

// Locale toggle
<button data-testid="locale-toggle">EN / MS</button>

// Edit/Delete buttons
<button data-testid={`edit-invoice-${id}`}>Edit</button>
<button data-testid={`delete-invoice-${id}`}>Delete</button>

// Delete confirmation (if present)
<button data-testid="confirm-delete">Confirm</button>
```

## CI Integration

`.github/workflows/ci.yml` includes an `acceptance` job (runs after `ci` succeeds):

```yaml
acceptance:
  needs: ci
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v1
    - run: bun install --frozen-lockfile
    - run: bunx playwright install chromium
    - run: bun acceptance/fresh-scaffold.ts
    - run: bunx playwright test -c acceptance
```

## Module Author Checklist

When adding a new module to `modules/`:

1. Include `"verify": "bun test"` in your `package.json` (or custom script)
2. Write tests in `*.test.ts` files (bun:test format)
3. The module is automatically discovered and run by `bun scripts/verify-all.ts`
4. Keep module tests fast (< 1s per module); heavy integration tests belong in skeleton smoke

## Troubleshooting

**Fresh-scaffold fails at bun install:**
- Check `.gitignore`: ensure no `node_modules` is committed
- Run locally: `bun install` should succeed in skeleton/

**Browser smoke fails to connect:**
- Check `playwright.config.ts`: API_PORT and WEB_PORT match env
- Ensure `bun run --cwd apps/api dev` and `bun run --cwd apps/web dev` can start
- Check vite.config.ts: proxy target points to API_PORT

**Styles not loading in smoke:**
- Verify `main.tsx` imports `./styles/index.css` (line 3)
- Check Tailwind/CSS pipeline in Vite config

**Routes return 404 in smoke:**
- Verify TanStack route tree has `Outlet` as parent component (line 23 of main.tsx)
- Check route child registration: `invoicesRoute.addChildren([...])` includes all paths

**Form validation not surfacing:**
- Verify `errorMapper.ts` maps API 422 → `form.setError(field, {message})`
- Check smoke test is looking for `data-testid={fieldName}-error`
- Confirm field names in form match contract schema keys
