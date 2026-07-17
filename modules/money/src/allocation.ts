import Decimal from "decimal.js";
import { Money } from "./money";

/**
 * ADR-0009: Money allocation algorithm
 *
 * Split a total Money amount by ratios/weights with **no lost cents**.
 * Invariant: sum of parts equals total exactly (to the minor unit).
 *
 * Algorithm (largest remainder):
 * 1. Calculate each part using Decimal arithmetic: part = |total| × (ratio / sum_of_ratios)
 * 2. Floor each part
 * 3. Distribute remainder cents deterministically: add 1 minor unit to parts with highest fractional part
 * 4. Re-apply the sign of the total
 *
 * There is deliberately no rounding-mode parameter. Flooring is structural, not a preference: any
 * mode that rounds a part *up* can allocate more than the total (three parts of exactly 0.5 round
 * to 2 units over), which would break the one invariant this function exists to hold. The remainder
 * step, not a rounding mode, is what decides where the odd cents land.
 *
 * Negative totals are supported: a reversal allocates like its positive counterpart, negated.
 * ADR-0009 makes corrections reversals, so credit notes and refunds arrive here as negative Money.
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
 * @param total - Amount to allocate. May be negative (a reversal); parts carry the total's sign.
 * @param ratios - Weights/ratios for each part (can be integers or decimals)
 * @returns AllocationResult with parts and remainder
 *
 * @example
 * const total = Money.ofMinor(1000, 'MYR'); // RM 10.00
 * const result = allocateByRatios(total, [1, 2, 3]);
 * // parts: [167, 333, 500] = 1000
 *
 * @example
 * // A credit note reverses its invoice line-for-line:
 * const refund = Money.ofMinor(-1000, 'MYR');
 * allocateByRatios(refund, [1, 2, 3]).parts; // [-167, -333, -500] = -1000
 *
 * @throws if sum of ratios is zero or any ratio is negative
 */
export function allocateByRatios(
  total: Money,
  ratios: Decimal.Value[]
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

  // Allocate the magnitude and re-apply the sign at the end. Working on |total| keeps flooring and
  // the largest-remainder step symmetric: ROUND_DOWN truncates toward zero, so flooring a negative
  // rounds *up* in value, the parts sum to more than the total, and the remainder goes negative.
  const sign = total.minor < 0 ? -1 : 1;
  const magnitude = Math.abs(total.minor);

  const parts: number[] = [];
  const fractional: Array<{ index: number; fraction: Decimal }> = [];
  let allocatedTotal = 0;

  for (const [i, ratio] of decimalRatios.entries()) {
    const proportion = ratio.dividedBy(sumRatios);
    const exactAmount = new Decimal(magnitude).times(proportion);
    const flooredAmount = exactAmount.toDecimalPlaces(0, Decimal.ROUND_DOWN);

    parts.push(flooredAmount.toNumber());
    allocatedTotal += flooredAmount.toNumber();

    const frac = exactAmount.minus(flooredAmount);
    if (!frac.isZero()) {
      fractional.push({ index: i, fraction: frac });
    }
  }

  const remainder = magnitude - allocatedTotal;
  if (remainder < 0) {
    // Unreachable: flooring non-negative parts cannot exceed a non-negative magnitude.
    throw new Error("allocation error: allocated more than total");
  }

  // Sort by fractional part descending, then give the odd units to the largest fractions.
  fractional.sort((a, b) => b.fraction.comparedTo(a.fraction));
  for (const { index } of fractional.slice(0, remainder)) {
    parts[index] = (parts[index] ?? 0) + 1;
  }

  // Verify
  const finalTotal = parts.reduce((sum, p) => sum + p, 0);
  const finalRemainder = magnitude - finalTotal;

  // `0 * -1` is `-0`, which compares equal to 0 with `===` but not under Object.is/toBe. Keep it
  // out of the public result rather than making every caller wonder.
  const signed = (n: number) => (n === 0 ? 0 : sign * n);

  return {
    parts: parts.map((p) => Money.ofMinor(signed(p), total.currency)),
    remainder: signed(finalRemainder),
  };
}

/**
 * Allocate Money by weights (integer counts).
 * Shorthand for allocateByRatios when you have counts/weights instead of decimal ratios.
 *
 * @example
 * const total = Money.ofMinor(1000, 'MYR');
 * const result = allocateByWeights(total, [1, 2, 3]);
 * // Splits as: 1/(1+2+3), 2/(1+2+3), 3/(1+2+3) of total
 */
export function allocateByWeights(
  total: Money,
  weights: number[]
): AllocationResult {
  return allocateByRatios(total, weights);
}
