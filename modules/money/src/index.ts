/**
 * ADR-0009: Money module
 *
 * Value object for Money with decimal.js internals, allocation algorithm,
 * and zod codec matching contract scalars.
 *
 * Usage:
 *   import { Money, allocateByWeights, money, encodeMoneyToWire } from 'money-module';
 *
 *   const price = Money.ofMinor(1000, 'MYR');
 *   const discounted = price.multiplyBy(new Decimal('0.9'), 'half-up');
 *   const [part1, part2, part3] = allocateByWeights(price, [1, 2, 3], 'half-up').parts;
 *
 *   // In API routes:
 *   const input = money.parse(req.body.amount);  // wire → VO
 *   const response = encodeMoneyToWire(input);    // VO → wire
 */

// Money VO
export { Money, type RoundingMode } from "./money";

// Allocation
export {
  allocateByRatios,
  allocateByWeights,
  type AllocationResult,
} from "./allocation";

// Codec (zod schemas + transforms)
export {
  money,
  moneyWire,
  moneyScalar,
  currencyCode,
  exchangeRate,
  encodeMoneyToWire,
  moneyResponse,
  type MoneyInput,
  type MoneyWire,
  type MoneyScalar,
  type CurrencyCode,
  type ExchangeRate,
} from "./codec";
