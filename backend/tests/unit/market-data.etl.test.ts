import { normalizeName, toInrPerQuintal } from "../../src/modules/market-data/market-data.service";
import { MarketDomainError } from "../../src/common/errors";

describe("market data ETL — normalization", () => {
  it("normalizes commodity/mandi names: trims, lowercases, collapses whitespace", () => {
    expect(normalizeName("  Tomato   Hybrid  ")).toBe("tomato hybrid");
    expect(normalizeName("ONION")).toBe("onion");
    expect(normalizeName("Onion")).toBe(normalizeName("  onion  "));
  });
});

describe("market data ETL — unit validation (6.2 / 6.5)", () => {
  it("passes through quintal-denominated prices unchanged", () => {
    expect(toInrPerQuintal(2000, "Quintal")).toBe(2000);
    expect(toInrPerQuintal(2000, "QTL")).toBe(2000);
    expect(toInrPerQuintal(2000, "per quintal")).toBe(2000);
    expect(toInrPerQuintal(2000, "100kg")).toBe(2000);
  });

  it("converts per-kg prices to per-quintal (x100)", () => {
    expect(toInrPerQuintal(20, "kg")).toBe(2000);
    expect(toInrPerQuintal(20, "per kg")).toBe(2000);
  });

  it("strips currency symbols, slashes and periods but does not guess unrecognized units", () => {
    expect(toInrPerQuintal(2000, "₹/Quintal")).toBe(2000);
    expect(toInrPerQuintal(2000, "Rs./Qtl")).toBe(2000);
    expect(toInrPerQuintal(20, "₹/kg")).toBe(2000);
  });

  it("rejects an unsupported unit instead of silently converting it", () => {
    expect(() => toInrPerQuintal(2000, "tonne")).toThrow(MarketDomainError);
    try {
      toInrPerQuintal(2000, "tonne");
      fail("expected toInrPerQuintal to throw for an unsupported unit");
    } catch (err) {
      expect(err).toBeInstanceOf(MarketDomainError);
      expect((err as MarketDomainError).code).toBe("UNSUPPORTED_UNIT");
    }
  });

  it("rejects an empty/garbage unit string rather than defaulting to quintal", () => {
    expect(() => toInrPerQuintal(2000, "")).toThrow(MarketDomainError);
    expect(() => toInrPerQuintal(2000, "lbs")).toThrow(MarketDomainError);
  });

  it("rejects negative or non-finite prices before any unit conversion", () => {
    expect(() => toInrPerQuintal(-5, "kg")).toThrow(MarketDomainError);
    expect(() => toInrPerQuintal(NaN, "kg")).toThrow(MarketDomainError);
    expect(() => toInrPerQuintal(Infinity, "kg")).toThrow(MarketDomainError);
  });

  it("treats zero as a valid (if unusual) price rather than rejecting it outright", () => {
    // A price of exactly zero should convert cleanly — persist()'s separate
    // min<=modal<=max consistency check is what should catch nonsensical
    // all-zero rows, not the unit converter.
    expect(toInrPerQuintal(0, "kg")).toBe(0);
  });
});
