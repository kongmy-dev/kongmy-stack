import Decimal from "decimal.js";

/**
 * ADR-0009: Money value object
 *
 * Money is represented as integer minor units + currency code.
 * Pricing arithmetic uses exact `Decimal` internally; results are rounded to minor units
 * exactly once at capture via `fromMinorDecimal`.
 * Two amounts only combine if their currencies match (currency mismatch throws).
 */

export type RoundingMode = "half-up" | "half-even" | "down";

const DECIMAL_ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  "half-up": Decimal.ROUND_HALF_UP,
  "half-even": Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_DOWN,
};

export class Money {
  private constructor(
    readonly minor: number,
    readonly currency: string
  ) {
    if (!Number.isInteger(minor)) {
      throw new Error(`minor units must be an integer, got ${minor}`);
    }
  }

  /**
   * Construct Money from minor units (e.g., cents for USD, sen for MYR).
   * Input must be an integer; use fromMinorDecimal to round decimal amounts.
   */
  static ofMinor(minor: number, currency: string): Money {
    return new Money(minor, currency);
  }

  /**
   * Construct Money from a decimal amount (already in minor units).
   * Rounds to integer minor units using the specified rounding mode.
   *
   * @example
   * const rate = new Decimal('10.5');
   * const money = Money.fromMinorDecimal(rate, 'MYR', 'half-up');
   * // result: Money { minor: 11, currency: 'MYR' }
   */
  static fromMinorDecimal(
    minorDecimal: Decimal.Value,
    currency: string,
    rounding: RoundingMode
  ): Money {
    const rounded = new Decimal(minorDecimal)
      .toDecimalPlaces(0, DECIMAL_ROUNDING[rounding])
      .toNumber();
    return new Money(rounded, currency);
  }

  /**
   * Construct zero Money for the given currency.
   */
  static zero(currency: string): Money {
    return new Money(0, currency);
  }

  /**
   * Add two Money values.
   * Throws if currencies don't match.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  /**
   * Subtract another Money value from this one.
   * Throws if currencies don't match.
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /**
   * Multiply this Money by a scalar decimal value.
   * Result is rounded using the specified rounding mode.
   *
   * @example
   * const price = Money.ofMinor(1000, 'MYR');
   * const discounted = price.multiplyBy(new Decimal('0.9'), 'half-up');
   * // result: Money { minor: 900, currency: 'MYR' }
   */
  multiplyBy(scalar: Decimal.Value, rounding: RoundingMode): Money {
    const result = new Decimal(this.minor).times(new Decimal(scalar));
    return Money.fromMinorDecimal(result, this.currency, rounding);
  }

  /**
   * Compare two Money values for equality.
   * Returns true iff currencies and amounts match.
   */
  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  /**
   * Compare this Money to another.
   * Returns: -1 if less, 0 if equal, 1 if greater.
   * Throws if currencies don't match.
   */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.minor < other.minor) return -1;
    if (this.minor > other.minor) return 1;
    return 0;
  }

  /**
   * Check if this Money is positive (> 0).
   */
  isPositive(): boolean {
    return this.minor > 0;
  }

  /**
   * Check if this Money is negative (< 0).
   */
  isNegative(): boolean {
    return this.minor < 0;
  }

  /**
   * Check if this Money is zero.
   */
  isZero(): boolean {
    return this.minor === 0;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(
        `currency mismatch: ${this.currency} vs ${other.currency}`
      );
    }
  }
}
