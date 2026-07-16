import Decimal from "decimal.js";
import { Money, type RoundingMode } from "./money";

/**
 * ADR-0009: Money allocation algorithm
 *
 * Split a total Money amount by ratios/weights with **no lost cents**.
 * Invariant: sum of parts equals total exactly (to the minor unit).
 *
 * Algorithm:
 * 1. Calculate each part using Decimal arithmetic: part = total × (ratio / sum_of_ratios)
 * 2. Round each part down (always safe for money)
 * 3. Distribute remainder cents deterministically: add 1 minor unit to parts with highest fractional part
 */

export interface AllocationResult {
  /**
   * Allocated parts in the same order as input ratios.
   * Guaranteed sum(parts) === total (to the minor unit).
   */
  parts: Money[];

  /**
   * Total remainder in minor units (diagnostics; should be 0 after allocation).
   * If non-zero, allocation failed.
   */
  remainder: number;
}

/**
 * Allocate Money by ratios (weights).
 * Distributes remainder deterministically to ensure sum equals total exactly.
 *
 * @param total - Amount to allocate
 * @param ratios - Weights/ratios for each part (can be integers or decimals)
 * @param rounding - Rounding mode for intermediate calculations
 * @returns AllocationResult with parts and remainder
 *
 * @example
 * const total = Money.ofMinor(1000, 'MYR'); // RM 10.00
 * const result = allocateByRatios(total, [1, 2, 3], 'half-up');
 * // parts: [167, 333, 500] = 1000
 *
 * @throws if sum of ratios is zero or any ratio is negative
 */
export function allocateByRatios(
  total: Money,
  ratios: Decimal.Value[],
  rounding: RoundingMode
): AllocationResult {
  if (ratios.length === 0) {
    return { parts: [], remainder: total.minor };
  }

  // Validate ratios
  const decimalRatios = ratios.map((r) => new Decimal(r));
  const sumRatios = decimalRatios.reduce((sum, r) => sum.plus(r), new Decimal(0));

  if (sumRatios.isZero()) {
    throw new Error("sum of ratios must be non-zero");
  }

  if (decimalRatios.some((r) => r.isNegative())) {
    throw new Error("all ratios must be non-negative");
  }

  // Calculate each part using Decimal arithmetic
  const parts: number[] = [];
  let allocatedTotal = 0;

  for (const [, ratio] of decimalRatios.entries()) {
    const proportion = ratio.dividedBy(sumRatios);
    const exactAmount = new Decimal(total.minor).times(proportion);
    const roundedAmount = exactAmount
      .toDecimalPlaces(0, Decimal.ROUND_DOWN)
      .toNumber();
    parts.push(roundedAmount);
    allocatedTotal += roundedAmount;
  }

  // Distribute remainder deterministically
  let remainder = total.minor - allocatedTotal;
  if (remainder < 0) {
    throw new Error("allocation error: allocated more than total");
  }

  // Distribute remainder to parts with largest fractional parts
  // Recalculate fractional parts to determine distribution
  const fractional: Array<{ index: number; fraction: Decimal }> = [];
  for (const [i, ratio] of decimalRatios.entries()) {
    const proportion = ratio.dividedBy(sumRatios);
    const exactAmount = new Decimal(total.minor).times(proportion);
    const frac = exactAmount.minus(exactAmount.toDecimalPlaces(0, Decimal.ROUND_DOWN));
    if (!frac.isZero()) {
      fractional.push({ index: i, fraction: frac });
    }
  }

  // Sort by fractional part descending
  fractional.sort((a, b) => b.fraction.comparedTo(a.fraction));

  // Distribute remainder to indices with highest fractional parts
  for (const { index } of fractional.slice(0, remainder)) {
    parts[index] = (parts[index] ?? 0) + 1;
  }

  // Verify
  const finalTotal = parts.reduce((sum, p) => sum + p, 0);
  const finalRemainder = total.minor - finalTotal;

  return {
    parts: parts.map((p) => Money.ofMinor(p, total.currency)),
    remainder: finalRemainder,
  };
}

/**
 * Allocate Money by weights (integer counts).
 * Shorthand for allocateByRatios when you have counts/weights instead of decimal ratios.
 *
 * @example
 * const total = Money.ofMinor(1000, 'MYR');
 * const result = allocateByWeights(total, [1, 2, 3], 'half-up');
 * // Splits as: 1/(1+2+3), 2/(1+2+3), 3/(1+2+3) of total
 */
export function allocateByWeights(
  total: Money,
  weights: number[],
  rounding: RoundingMode
): AllocationResult {
  return allocateByRatios(total, weights, rounding);
}
