import { Money } from "../../src/modules/net-realization/net-realization-money";

describe("Money", () => {
  it("adds without floating-point drift (0.1 + 0.2 style cases)", () => {
    const a = Money.fromRupees(0.1);
    const b = Money.fromRupees(0.2);
    expect(a.add(b).toNumber()).toBe(0.3);
  });

  it("sums many small amounts without accumulating drift", () => {
    let total = Money.zero();
    for (let i = 0; i < 1000; i++) {
      total = total.add(Money.fromRupees(0.01));
    }
    expect(total.toNumber()).toBe(10);
  });

  it("subtracts correctly, including negative results", () => {
    const result = Money.fromRupees(50).subtract(Money.fromRupees(75));
    expect(result.toNumber()).toBe(-25);
    expect(result.isNegative()).toBe(true);
  });

  it("multiplies a per-unit price by a fractional quantity and rounds once", () => {
    const money = Money.multiplyRupeesByQuantity(2500, 12.345);
    // 2500 * 12.345 = 30862.5 exactly
    expect(money.toNumber()).toBe(30862.5);
  });

  it("rounds half-paisa away from zero consistently", () => {
    const money = Money.multiplyRupeesByQuantity(1, 0.005); // 0.005 rupees -> rounds to 0.01 (half up)
    expect(money.toNumber()).toBe(0.01);
  });

  it("zero() is a valid additive identity", () => {
    const amount = Money.fromRupees(42.5);
    expect(Money.zero().add(amount).toNumber()).toBe(42.5);
  });

  it("rejects non-finite input", () => {
    expect(() => Money.fromRupees(NaN)).toThrow();
    expect(() => Money.fromRupees(Infinity)).toThrow();
  });
});
