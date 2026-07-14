import { z } from "zod";

/**
 * ADR-0009: Scalar vocabulary & country modules
 *
 * Branded zod types, each with `.describe()`, generating cleanly to Kotlin.
 * Selection criterion: retrofit cost — anything whose later change touches every consumer is locked day 1.
 * Five surfaces from one definition: API validation, OpenAPI, generated clients, form inputs, MCP tool schemas.
 */

// ============================================================================
// Identifiers
// ============================================================================

/**
 * Prefixed ULID branded type
 * Usage: `id('inv')` → `z.string().brand<'inv'>()` with ULID validation
 */
export function id<T extends string>(prefix: T) {
  return z
    .string()
    .regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "Invalid ULID format")
    .describe(`Prefixed ULID (${prefix}–*): ${prefix}-based identifier`)
    .brand<`${T}-${string}`>();
}

// ============================================================================
// Money & Currency
// ============================================================================

/**
 * ISO 4217 currency code
 * MYR-first; subset of codes the org operates in
 */
export const currencyCode = z
  .enum(["MYR", "USD", "SGD", "THB", "IDR"])
  .describe("ISO 4217 currency code (MYR-first)");

export type CurrencyCode = z.infer<typeof currencyCode>;

/**
 * Money: integer minor units
 * Wire format: cents for USD, sen for MYR, etc. (ISO 4217 exponent rules)
 * Never float percentages; use basis points for rates.
 */
export const money = z
  .number()
  .int()
  .describe("Amount in minor units (cents for USD, sen for MYR, etc.)");

export type Money = z.infer<typeof money>;

/**
 * Exchange rate record
 * Multi-currency rule: transactions store doc-currency amount + base-currency amount + the rate used
 * Never a converted amount without its rate+date
 */
export const exchangeRate = z
  .object({
    from: currencyCode.describe("Source currency"),
    to: currencyCode.describe("Target currency"),
    rate: z.number().positive().describe("Exchange rate (e.g., 1 MYR = X USD)"),
    asOf: z.string().datetime().describe("Rate effective date (ISO 8601 UTC)"),
    source: z
      .enum(["bank", "market", "manual"])
      .describe("Rate source/authority"),
  })
  .describe("Exchange rate record with source and effective date");

export type ExchangeRate = z.infer<typeof exchangeRate>;

// ============================================================================
// Quantities & Units
// ============================================================================

/**
 * Unit of measure: value + unit pair (never bare numbers)
 * ERPNext UOM Conversion pattern; conversion table arrives with inventory needs
 */
export const unitOfMeasure = z
  .enum(["PCS", "KG", "L", "M", "H", "BOX", "PKG"])
  .describe("Unit of measure code (PCS, KG, L, M, H, BOX, PKG, ...)");

export type UnitOfMeasure = z.infer<typeof unitOfMeasure>;

export const quantity = z
  .object({
    value: z
      .number()
      .positive()
      .describe("Numeric quantity"),
    unit: unitOfMeasure.describe("Unit of measure"),
  })
  .describe("Value-unit pair for measured quantities");

export type Quantity = z.infer<typeof quantity>;

// ============================================================================
// Tax & Rates
// ============================================================================

/**
 * Rates as integer basis points (not float percentages)
 * 1 bps = 0.01%, 10000 bps = 100%
 */
export const basisPoints = z
  .number()
  .int()
  .min(0)
  .max(10000)
  .describe("Basis points (0–10000 where 100 bps = 1%)");

export type BasisPoints = z.infer<typeof basisPoints>;

/**
 * Tax code with rate
 * Country mapping (e.g. MyInvois tax types 01–06/E) lives in country module
 */
export const taxCode = z
  .object({
    code: z.string().describe("Tax code identifier (e.g., 'STD', '0%', 'E')"),
    name: z.string().describe("Tax code name"),
    rateBps: basisPoints.describe("Tax rate in basis points"),
    countryTaxType: z
      .string()
      .optional()
      .describe("Country-specific tax type (e.g., MyInvois 01–06/E for MY)"),
  })
  .describe("Tax code with rate and optional country mapping");

export type TaxCode = z.infer<typeof taxCode>;

// ============================================================================
// Dates & Time
// ============================================================================

/**
 * Calendar date (no timezone)
 * Used for: due dates, birthdays, fiscal year boundaries, day-boundary rules
 */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar date in YYYY-MM-DD format (no timezone)");

export type DateOnly = z.infer<typeof dateOnly>;

/**
 * ISO 8601 UTC datetime
 * Always UTC; timezone context in Timezone scalar or tenant setting
 */
export const dateTime = z
  .string()
  .datetime()
  .describe("ISO 8601 UTC datetime (always UTC)");

export type DateTime = z.infer<typeof dateTime>;

/**
 * IANA timezone
 * Tenant setting; used for day-boundary rules on reports
 */
export const timezone = z
  .string()
  .regex(/^[A-Z][a-z]+\/[A-Z][a-z_]+$/)
  .describe("IANA timezone identifier (e.g., Asia/Kuala_Lumpur)");

export type Timezone = z.infer<typeof timezone>;

// ============================================================================
// Document Numbering
// ============================================================================

/**
 * Document number format: {series}-{fiscalYear}-{seq}
 * Example: INV-2026-00042
 * Per-tenant, per-series sequence table with gapless option for accounting
 * Gapless = row-locked counter; non-gapless = fast path (PostgreSQL nextval)
 */
export const documentNumber = z
  .string()
  .regex(/^[A-Z]+(-\d{4})?-\d+$/)
  .describe(
    "Document number format: {series}-{fiscalYear}-{seq} (e.g., INV-2026-00042)"
  );

export type DocumentNumber = z.infer<typeof documentNumber>;

// ============================================================================
// Contact Information
// ============================================================================

/**
 * Phone in E.164 format
 * Wire: E.164 (+country code + number)
 * Render: formatting by locale (client-side)
 */
export const phone = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/)
  .describe("Phone number in E.164 format (e.g., +60160000000)");

export type Phone = z.infer<typeof phone>;

/**
 * Email address
 * Lowercase-normalized at boundary
 */
export const email = z
  .string()
  .email()
  .toLowerCase()
  .describe("Email address (lowercase-normalized)");

export type Email = z.infer<typeof email>;

/**
 * Structured address
 * Country specifics (e.g., MY states, postcode shape) in country modules
 */
export const address = z
  .object({
    line1: z.string().describe("Address line 1"),
    line2: z.string().optional().describe("Address line 2"),
    city: z.string().describe("City/town"),
    state: z.string().describe("State/province"),
    postcode: z.string().describe("Postcode/ZIP"),
    countryCode: z
      .string()
      .length(2)
      .describe("ISO 3166-1 alpha-2 country code (e.g., MY)"),
  })
  .describe("Structured address with country specifics in country modules");

export type Address = z.infer<typeof address>;

// ============================================================================
// Files
// ============================================================================

/**
 * File reference
 * Pairs with ADR-0006 storage seam (presigned direct upload)
 */
export const fileRef = z
  .object({
    key: z.string().describe("Storage key/path"),
    mime: z.string().describe("MIME type (e.g., application/pdf)"),
    size: z.number().int().positive().describe("File size in bytes"),
    name: z.string().describe("Original filename"),
  })
  .describe("File reference with storage key and metadata");

export type FileRef = z.infer<typeof fileRef>;

// ============================================================================
// Audit & Versioning
// ============================================================================

/**
 * Audit stamp: timestamps and optionally creator
 * Covers: createdAt/updatedAt columns (ADR-0005)
 */
export const auditStamp = z
  .object({
    createdAt: dateTime.describe("Created timestamp"),
    updatedAt: dateTime.describe("Last updated timestamp"),
    createdBy: z.string().optional().describe("Creator user ID or name"),
  })
  .describe("Audit timestamps covering record lifecycle");

export type AuditStamp = z.infer<typeof auditStamp>;

/**
 * Optimistic concurrency control
 * Opt-in `withVersion()` integer + If-Match header
 */
export const version = z
  .number()
  .int()
  .nonnegative()
  .describe("Version number for optimistic concurrency control");

export type Version = z.infer<typeof version>;

// ============================================================================
// Enums: Casing Conventions
// ============================================================================

/**
 * ADR-0009: Enum casing
 * - `lowercase_snake` for domain states (e.g., document_status, invoice_status)
 * - `SCREAMING_SNAKE` reserved for error codes only
 */

// Example domain enum (for documentation purposes; actual domain enums go in their own modules)
export const documentStatus = z
  .enum(["draft", "posted", "cancelled"])
  .describe("Document status: draft (editable) → posted (immutable) → cancelled (reversals)");

export type DocumentStatus = z.infer<typeof documentStatus>;

// Error codes: SCREAMING_SNAKE (defined in errors.ts)
// See: errors.ts
