import { z } from "zod";
import { Money } from "./money";

/**
 * ADR-0009: Zod codec for Money VO
 *
 * Mirrors the contract scalar shapes (packages/contract/src/scalars.ts)
 * and provides transformations between wire format (integer minor units) and Money VOs.
 *
 * These schemas are duplicated in consumer projects via `bun scripts/add.ts`:
 * they do NOT import from this module. Each consumer owns its copy so
 * the module can be vendored without dragging in the VO implementation.
 *
 * For the VO implementation (this file): we define the codec transformations here.
 * For consumer contracts: use the raw zod schemas and let the module's codec wire them up.
 */

// ============================================================================
// Currency Code (mirrors contract scalar)
// ============================================================================

export const currencyCode = z
  .enum(["MYR", "USD", "SGD", "THB", "IDR"])
  .describe("ISO 4217 currency code (MYR-first)");

export type CurrencyCode = z.infer<typeof currencyCode>;

// ============================================================================
// Wire format: Money as {amount: int, currency}
// ============================================================================

export const moneyWire = z
  .object({
    amount: z
      .number()
      .int()
      .describe("Amount in minor units (cents for USD, sen for MYR, etc.)"),
    currency: currencyCode.describe("ISO 4217 currency code"),
  })
  .describe("Money wire format: integer minor units + currency code");

export type MoneyWire = z.infer<typeof moneyWire>;

// ============================================================================
// VO codec: wire ↔ Money
// ============================================================================

/**
 * Zod schema that transforms wire format to Money VO.
 * Use this in API routes and services to parse incoming money values.
 */
export const money = moneyWire.transform((wire) =>
  Money.ofMinor(wire.amount, wire.currency)
);

export type MoneyInput = z.infer<typeof money>;

/**
 * Encode Money VO to wire format (for responses, serialization).
 * This is mechanical — not a zod schema, just a function for clarity.
 */
export function encodeMoneyToWire(m: Money): MoneyWire {
  return {
    amount: m.minor,
    currency: m.currency as CurrencyCode,
  };
}

/**
 * Zod schema for Money that appears in API responses.
 * Input validation uses the `money` schema above.
 * For responses: use encodeMoneyToWire + zod schema, or write a response schema that zod can verify.
 *
 * This schema accepts either a Money VO or wire format for flexibility in tests.
 */
export const moneyResponse = z.union([
  // Accept Money VO directly (via type guard)
  z.custom<Money>((val): val is Money => val instanceof Money),
  // Or transform from wire format
  moneyWire.transform((wire) => Money.ofMinor(wire.amount, wire.currency)),
]);

// ============================================================================
// Backwards-compatible: raw integer money scalar (contract-only usage)
// ============================================================================

/**
 * Raw money scalar from contract packages/contract/src/scalars.ts.
 * Use this ONLY in contract type definitions.
 * For VO usage, use the `money` schema above.
 */
export const moneyScalar = z
  .number()
  .int()
  .describe("Amount in minor units (cents for USD, sen for MYR, etc.)");

export type MoneyScalar = z.infer<typeof moneyScalar>;

// ============================================================================
// Exchange Rate (mirrors contract scalar)
// ============================================================================

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
