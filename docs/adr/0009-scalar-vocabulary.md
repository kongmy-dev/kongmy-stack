# ADR-0009 — Scalar vocabulary & country modules

**Status:** accepted 2026-07-13

Branded zod types in `packages/contract/scalars.ts`, each with `.describe()`, each generating cleanly to Kotlin. Selection criterion: **retrofit cost** — anything whose later change touches every consumer is locked day 1. Five surfaces from one definition: API validation, OpenAPI, generated clients, form inputs, MCP tool schemas.

## Day-1 scalars

| Scalar | Lock |
|---|---|
| `Money` | integer minor units + `CurrencyCode` (already ADR-0004) |
| `CurrencyCode` | ISO 4217 enum subset, MYR-first; standalone type |
| `ExchangeRate` | `{ from, to, rate, asOf, source }`. **Multi-currency rule:** transactions store doc-currency amount + base-currency amount + the rate used — never a converted amount without its rate+date |
| `Quantity` + `UnitOfMeasure` | value+unit pairs, never bare numbers (generalized from private consumer references); UOM conversion table arrives with inventory needs (ERPNext UOM Conversion pattern) |
| Rates | **integer basis points** for tax/discount/margin — never float percentages |
| `TaxCode` | `{ code, name, rateBps, countryTaxType? }` — country mapping (e.g. MyInvois tax types 01–06/E) lives in the country module |
| `DateOnly` vs `DateTime` | two distinct branded types; due dates/birthdays are calendar dates, no TZ |
| `Timezone` | IANA string, tenant setting; written "day boundary" rule for reports |
| `DocumentNumber` + sequences | `{series}-{fiscalYear}-{seq}` (e.g. `INV-2026-00042`); per-tenant, per-series sequence table with **gapless option** for accounting documents (gapless = row-locked counter; non-gapless = fast path). ERPNext Naming Series equivalent — retrofit-expensive, skeleton-level |
| `Phone` | E.164 wire, render-side formatting |
| `Email` | lowercase-normalized at boundary |
| `Address` | structured `line1/line2/city/state/postcode/countryCode`; country specifics in country modules |
| Tax/registration ids | country-module types (MY: TIN, SSM, SST no.) with validators |
| `FileRef` | storage key + mime + size + name (pairs with ADR-0006 storage seam) |
| `AuditStamp` | createdAt/updatedAt(/createdBy) composite (ADR-0005 columns) |
| Enum casing | `lowercase_snake` for domain states; SCREAMING_SNAKE reserved for error codes |
| `version` | opt-in `withVersion()` integer + If-Match for optimistic concurrency |

**Defer-cheap:** GeoPoint, Duration, Slug, DateRange query helper (may get pulled into phase 1 by DataTable date filters).

## Document lifecycle convention (accounting-grade immutability)

For financial documents: `draft → posted → cancelled` state machine via the command door. **Posted documents are immutable** — corrections are reversal entries / credit & debit notes, never edits (ERPNext submit/cancel/amend pattern). Non-financial resources stay plain CRUD. Declared per resource in the contract; lifecycle transitions are `action()`s, so they get permissions (ADR-0008) and MCP tools for free.

## Country modules (`domain ⊥ country`, dep-cruiser enforced)

Common scalars are universal; jurisdiction facts live in country packs so adding a market never touches domain code. **`country-my` scope** (converging need across consumer products): MY states + postcode shape · TIN validation · SSM/SST identifiers · MSIC codes · SST tax types · **MyInvois e-invoice**: UBL 2.1 JSON v1.1 mapper, X.509 PKCS#7 signing, OAuth2, submit/poll/cancel lifecycle (sandbox + prod). Reference implementations sourced from private consumer projects with accounting/e-invoice needs.
