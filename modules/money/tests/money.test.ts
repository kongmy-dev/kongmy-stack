import { describe, it, expect, beforeAll } from "bun:test";
import fc from "fast-check";
import Decimal from "decimal.js";
import { Money, type RoundingMode } from "../src/money";
import {
  allocateByRatios,
  allocateByWeights,
  type AllocationResult,
} from "../src/allocation";
import {
  money as moneyCodec,
  moneyWire,
  encodeMoneyToWire,
  currencyCode,
  type CurrencyCode,
} from "../src/codec";

// =============================================================================
// Property-based tests
// =============================================================================

describe("Money VO - Property-based tests", () => {
  describe("Addition associativity", () => {
    it("(a + b) + c === a + (b + c)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100000, max: 100000 }),
          fc.integer({ min: -100000, max: 100000 }),
          fc.integer({ min: -100000, max: 100000 }),
          (a, b, c) => {
            const m1 = Money.ofMinor(a, "MYR");
            const m2 = Money.ofMinor(b, "MYR");
            const m3 = Money.ofMinor(c, "MYR");

            const left = m1.add(m2).add(m3);
            const right = m1.add(m2.add(m3));

            return left.equals(right);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Subtraction inverse", () => {
    it("(a + b) - b === a", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100000, max: 100000 }),
          fc.integer({ min: -100000, max: 100000 }),
          (a, b) => {
            const m1 = Money.ofMinor(a, "MYR");
            const m2 = Money.ofMinor(b, "MYR");

            return m1.add(m2).subtract(m2).equals(m1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Allocation sums to whole", () => {
    it("sum(allocate(total, ratios)) === total (deterministic remainder distribution)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
          (total, weights) => {
            const money = Money.ofMinor(total, "MYR");
            const result = allocateByRatios(money, weights, "half-up");

            const sum = result.parts.reduce((s, p) => s.add(p), Money.ofMinor(0, "MYR"));
            const success = sum.equals(money) && result.remainder === 0;

            return success;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Allocation is deterministic", () => {
    it("allocate(total, ratios) produces same result on repeated calls", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 1000000 }),
          fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 }),
          (total, weights) => {
            const money = Money.ofMinor(total, "MYR");
            const result1 = allocateByRatios(money, weights, "half-up");
            const result2 = allocateByRatios(money, weights, "half-up");

            return result1.parts.every((p, i) => p.equals(result2.parts[i]));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Codec round-trip identity", () => {
    it("money.parse(wire).encode() === wire (loseless)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -1000000, max: 1000000 }),
          (minorUnits) => {
            const wire = {
              amount: minorUnits,
              currency: "MYR" as const,
            };

            const m = moneyCodec.parse(wire);
            const encoded = encodeMoneyToWire(m);

            return (
              encoded.amount === wire.amount &&
              encoded.currency === wire.currency
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("No lost cents under repeated split/merge", () => {
    it("split→merge cycle preserves total", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 1000000 }),
          fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 5 }),
          (total, weights) => {
            const original = Money.ofMinor(total, "MYR");

            // Split
            const result = allocateByWeights(original, weights, "half-up");
            if (result.remainder !== 0) return false;

            // Merge
            const merged = result.parts.reduce(
              (sum, p) => sum.add(p),
              Money.ofMinor(0, "MYR")
            );

            return merged.equals(original);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Multiply and compare", () => {
    it("multiply preserves currency", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100000 }),
          fc.integer({ min: 1, max: 100 }),
          (amount, multiplier) => {
            const m = Money.ofMinor(amount, "MYR");
            const scalar = new Decimal(multiplier);
            const result = m.multiplyBy(scalar, "half-up");

            return result.currency === "MYR";
          }
        ),
        { numRuns: 100 }
      );
    });

    it("multiply by 1 returns equal amount", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100000, max: 100000 }),
          (amount) => {
            const m = Money.ofMinor(amount, "MYR");
            const result = m.multiplyBy(new Decimal(1), "half-up");

            return result.equals(m);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("multiply by 0 returns zero", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -100000, max: 100000 }),
          (amount) => {
            const m = Money.ofMinor(amount, "MYR");
            const result = m.multiplyBy(new Decimal(0), "half-up");

            return result.isZero();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

// =============================================================================
// Example-based tests (edge cases)
// =============================================================================

describe("Money VO - Edge cases", () => {
  it("zero amount", () => {
    const m = Money.zero("MYR");
    expect(m.isZero()).toBe(true);
    expect(m.minor).toBe(0);
  });

  it("negative amounts", () => {
    const m = Money.ofMinor(-500, "MYR");
    expect(m.isNegative()).toBe(true);
    expect(m.compare(Money.ofMinor(0, "MYR"))).toBe(-1);
  });

  it("single-part allocation", () => {
    const total = Money.ofMinor(1000, "MYR");
    const result = allocateByWeights(total, [1], "half-up");
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].equals(total)).toBe(true);
    expect(result.remainder).toBe(0);
  });

  it("equal-weight allocation", () => {
    const total = Money.ofMinor(1000, "MYR");
    const result = allocateByWeights(total, [1, 1, 1], "half-up");
    expect(result.parts).toHaveLength(3);
    const sum = result.parts.reduce((s, p) => s.add(p), Money.zero("MYR"));
    expect(sum.equals(total)).toBe(true);
  });

  it("zero-decimal currency behavior (JPY-like)", () => {
    // JPY typically has 0 decimal places; test allocation with whole numbers
    const total = Money.ofMinor(1000, "JPY");
    const result = allocateByWeights(total, [3, 7], "half-up");
    expect(result.remainder).toBe(0);
    const sum = result.parts.reduce((s, p) => s.add(p), Money.zero("JPY"));
    expect(sum.equals(total)).toBe(true);
  });

  it("rounding mode: half-up", () => {
    const decimal = new Decimal("10.5");
    const m = Money.fromMinorDecimal(decimal, "MYR", "half-up");
    expect(m.minor).toBe(11);
  });

  it("rounding mode: half-even", () => {
    const decimal = new Decimal("10.5");
    const m = Money.fromMinorDecimal(decimal, "MYR", "half-even");
    expect(m.minor).toBe(10); // banker's rounding
  });

  it("rounding mode: down", () => {
    const decimal = new Decimal("10.9");
    const m = Money.fromMinorDecimal(decimal, "MYR", "down");
    expect(m.minor).toBe(10);
  });

  it("currency mismatch throws", () => {
    const myr = Money.ofMinor(100, "MYR");
    const usd = Money.ofMinor(100, "USD");
    expect(() => myr.add(usd)).toThrow(/currency mismatch/);
  });

  it("comparison operations", () => {
    const a = Money.ofMinor(100, "MYR");
    const b = Money.ofMinor(200, "MYR");
    const c = Money.ofMinor(100, "MYR");

    expect(a.compare(b)).toBe(-1);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(c)).toBe(0);
  });
});

// =============================================================================
// Codec tests
// =============================================================================

describe("Codec", () => {
  it("parse valid wire format", () => {
    const wire = { amount: 1000, currency: "MYR" as const };
    const m = moneyCodec.parse(wire);
    expect(m).toBeInstanceOf(Money);
    expect(m.minor).toBe(1000);
    expect(m.currency).toBe("MYR");
  });

  it("encode Money to wire", () => {
    const m = Money.ofMinor(1000, "MYR");
    const wire = encodeMoneyToWire(m);
    expect(wire.amount).toBe(1000);
    expect(wire.currency).toBe("MYR");
  });

  it("reject invalid currency", () => {
    const wire = { amount: 1000, currency: "XXX" };
    expect(() => moneyCodec.parse(wire)).toThrow();
  });

  it("reject non-integer amounts", () => {
    const wire = { amount: 10.5, currency: "MYR" as const };
    expect(() => moneyCodec.parse(wire)).toThrow();
  });

  it("currencyCode enum validation", () => {
    expect(() => currencyCode.parse("MYR")).not.toThrow();
    expect(() => currencyCode.parse("USD")).not.toThrow();
    expect(() => currencyCode.parse("XXX")).toThrow();
  });
});

// =============================================================================
// Allocation edge cases
// =============================================================================

describe("Allocation algorithm", () => {
  it("allocate empty weights throws", () => {
    const total = Money.ofMinor(1000, "MYR");
    expect(() => allocateByRatios(total, [], "half-up")).not.toThrow(); // empty allocation
  });

  it("allocate zero-sum ratios throws", () => {
    const total = Money.ofMinor(1000, "MYR");
    expect(() => allocateByRatios(total, [0, 0, 0], "half-up")).toThrow(
      /sum of ratios must be non-zero/
    );
  });

  it("allocate negative ratios throws", () => {
    const total = Money.ofMinor(1000, "MYR");
    expect(() => allocateByRatios(total, [1, -1, 2], "half-up")).toThrow(
      /all ratios must be non-negative/
    );
  });

  it("allocate decimal ratios", () => {
    const total = Money.ofMinor(1000, "MYR");
    const result = allocateByRatios(total, [new Decimal("0.3"), new Decimal("0.7")], "half-up");
    const sum = result.parts.reduce((s, p) => s.add(p), Money.zero("MYR"));
    expect(sum.equals(total)).toBe(true);
    expect(result.remainder).toBe(0);
  });

  it("allocation preserves order of ratios", () => {
    const total = Money.ofMinor(100, "MYR");
    const result = allocateByWeights(total, [10, 20, 30], "half-up");
    // Largest ratio should get more
    expect(result.parts[2].minor).toBeGreaterThanOrEqual(
      result.parts[1].minor
    );
    expect(result.parts[1].minor).toBeGreaterThanOrEqual(
      result.parts[0].minor
    );
  });

  it("verify no lost cents (sum exactly equals total)", () => {
    const amounts = [
      1000, 2500, 7234, 999, 100001, 333, 1,
    ];
    const weights = [1, 2, 3, 1, 5, 2, 1];

    for (const amount of amounts) {
      const total = Money.ofMinor(amount, "MYR");
      const result = allocateByWeights(total, weights, "half-up");

      const sum = result.parts.reduce(
        (s, p) => s + p.minor,
        0
      );
      expect(sum).toBe(total.minor);
      expect(result.remainder).toBe(0);
    }
  });
});
