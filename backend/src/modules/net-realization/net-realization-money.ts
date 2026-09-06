/**
 * Decimal-safe money arithmetic for the Net Realization engine.
 *
 * Part E requires the calculation engine to be pure (no DB/HTTP calls) and
 * Part 3 ("Use Decimal arithmetic") requires every financial calculation
 * to avoid native floating-point math. The rest of this codebase does
 * money math using Prisma's `Prisma.Decimal` (see buyer-matching.service.ts),
 * which is the right choice wherever a live PrismaClient is already in
 * scope — but the calculation engine deliberately has no Prisma
 * dependency at all (mirroring sell-store-decision-engine.service.ts,
 * which imports nothing from "@prisma/client" either), so it can be
 * unit-tested and reasoned about with zero infrastructure.
 *
 * `Money` represents an amount as a `bigint` of paise (1/100 INR,
 * matching every `@db.Decimal(_, 2)` monetary column in the schema).
 * All arithmetic (add/subtract/multiply) happens on that integer, so
 * summing many cost components can never accumulate the rounding drift
 * native IEEE-754 floats would. Amounts only leave `Money` (via `toNumber`)
 * at the engine's output boundary, matching the project's own "Decimal
 * internally, plain number above the boundary" convention (see
 * PROJECT_CONTEXT.md's Module 4 quantity-normalization note).
 */

const PAISE_PER_RUPEE = 100n;
// Quantities (KG) can carry fractional precision beyond 2 decimal places
// (e.g. 12.345 KG); prices are always whole paise per unit. Multiplying a
// paise integer by a quantity therefore happens in a higher, temporary
// scale (4 decimal places) and is rounded back down to paise once, at the
// end of the multiplication — never repeatedly, so error cannot compound
// across a chain of operations.
const QUANTITY_SCALE = 10000n;

function toScaledBigInt(value: number, scale: bigint): bigint {
  if (!Number.isFinite(value)) {
    throw new Error("Cannot convert a non-finite number to Money.");
  }
  // Round to the target scale using string formatting rather than
  // floating-point multiplication, so e.g. 0.1 + 0.2 style drift never
  // enters the integer representation in the first place.
  const scaleDigits = scale.toString().length - 1;
  const fixed = value.toFixed(scaleDigits);
  const negative = fixed.startsWith("-");
  const digits = (negative ? fixed.slice(1) : fixed).replace(".", "");
  const result = BigInt(digits);
  return negative ? -result : result;
}

export class Money {
  private constructor(private readonly paise: bigint) {}

  static fromRupees(value: number): Money {
    return new Money(toScaledBigInt(value, PAISE_PER_RUPEE));
  }

  static zero(): Money {
    return new Money(0n);
  }

  add(other: Money): Money {
    return new Money(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return new Money(this.paise - other.paise);
  }

  /** Multiplies a per-unit rupee amount by a (possibly fractional)
   * quantity, e.g. pricePerUnit x quantity. Rounds to the nearest paisa
   * exactly once, at the end. */
  static multiplyRupeesByQuantity(pricePerUnitRupees: number, quantity: number): Money {
    const priceScaled = toScaledBigInt(pricePerUnitRupees, PAISE_PER_RUPEE); // paise
    const quantityScaled = toScaledBigInt(quantity, QUANTITY_SCALE); // quantity x 10^4
    const productScaled = priceScaled * quantityScaled; // paise x 10^4
    const rounded = roundDiv(productScaled, QUANTITY_SCALE);
    return new Money(rounded);
  }

  isNegative(): boolean {
    return this.paise < 0n;
  }

  toNumber(): number {
    const rupees = this.paise / PAISE_PER_RUPEE;
    const remainder = this.paise % PAISE_PER_RUPEE;
    return Number(rupees) + Number(remainder) / 100;
  }
}

/** Rounds a bigint division to the nearest integer (half away from zero),
 * so a single rounding step is applied consistently regardless of sign. */
function roundDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const doubledRemainder = remainder * 2n;
  const shouldRoundUp =
    doubledRemainder >= denominator || doubledRemainder <= -denominator;
  if (!shouldRoundUp) return quotient;
  return quotient + (numerator < 0n ? -1n : 1n);
}
