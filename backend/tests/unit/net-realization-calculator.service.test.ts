import { NetRealizationCalculatorService } from "../../src/modules/net-realization/net-realization-calculator.service";
import { NetRealizationInput } from "../../src/modules/net-realization/net-realization.types";

function baseInput(overrides: Partial<NetRealizationInput> = {}): NetRealizationInput {
  return {
    lot: {
      lotId: "lot-1",
      lotPublicId: "lot-public-1",
      cropId: "crop-1",
      cropName: "Tomato",
      availableQuantityKg: 1000,
    },
    sale: {
      pricePerUnit: 2000,
      priceUnit: "QTL",
      quantity: 10,
      quantityUnit: "QTL",
      source: { type: "ACCEPTED_OFFER", referenceId: "offer-1", valueSource: "ACTUAL" },
    },
    costs: {
      resolved: [],
      unavailable: [],
    },
    ...overrides,
  };
}

describe("NetRealizationCalculatorService", () => {
  const engine = new NetRealizationCalculatorService();

  it("calculates gross revenue as price x quantity", () => {
    const result = engine.evaluate(baseInput());
    expect(result.grossRevenue).toBe(20000);
  });

  it("returns COMPLETE when every applicable cost category resolved", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "COMMISSION", amount: 500, source: "ACTUAL" }],
        unavailable: [],
      },
    });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.netRealization).toBe(19500);
    expect(result.totalKnownCosts).toBe(500);
  });

  it("returns PARTIAL when some costs are unavailable, and never treats them as zero", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "COMMISSION", amount: 500, source: "ACTUAL" }],
        unavailable: [
          { category: "TRANSPORT", reason: "TRANSPORT_COST_UNAVAILABLE" },
          { category: "LOADING", reason: "LOADING_COST_UNAVAILABLE" },
        ],
      },
    });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("PARTIAL");
    // Net realization only reflects the *known* commission deduction —
    // transport/loading are never silently assumed to be zero.
    expect(result.netRealization).toBe(19500);
    expect(result.omittedComponents).toHaveLength(2);
    expect(result.warnings).toEqual(
      expect.arrayContaining(["TRANSPORT_COST_UNAVAILABLE", "LOADING_COST_UNAVAILABLE", "PARTIAL_REALIZATION"]),
    );
  });

  it("returns INSUFFICIENT and a null netRealization when sale price is unavailable", () => {
    const input = baseInput({
      sale: {
        pricePerUnit: null,
        priceUnit: null,
        quantity: null,
        quantityUnit: null,
        source: { type: "UNAVAILABLE", referenceId: null, valueSource: "UNKNOWN" },
      },
    });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("INSUFFICIENT");
    expect(result.netRealization).toBeNull();
    expect(result.grossRevenue).toBeNull();
    expect(result.warnings).toContain("SALE_PRICE_UNAVAILABLE");
  });

  it("returns INSUFFICIENT when quantity is missing even if price is known", () => {
    const input = baseInput({
      sale: {
        pricePerUnit: 2000,
        priceUnit: "QTL",
        quantity: null,
        quantityUnit: null,
        source: { type: "MARKET_REFERENCE", referenceId: null, valueSource: "MARKET_REFERENCE" },
      },
    });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("INSUFFICIENT");
    expect(result.netRealization).toBeNull();
  });

  it("rejects a zero or negative quantity as insufficient, not a valid zero-revenue sale", () => {
    const input = baseInput({ sale: { ...baseInput().sale, quantity: 0 } });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("INSUFFICIENT");
  });

  it("separates known (ACTUAL/MARKET_REFERENCE), estimated, and user-provided cost totals", () => {
    const input = baseInput({
      costs: {
        resolved: [
          { category: "COMMISSION", amount: 200, source: "ACTUAL" },
          { category: "STORAGE", amount: 300, source: "ESTIMATED" },
          { category: "TRANSPORT", amount: 400, source: "USER_PROVIDED" },
        ],
        unavailable: [],
      },
    });
    const result = engine.evaluate(input);
    expect(result.totalKnownCosts).toBe(200);
    expect(result.totalEstimatedCosts).toBe(300);
    expect(result.totalUserProvidedCosts).toBe(400);
    expect(result.totalDeductions).toBe(900);
    expect(result.netRealization).toBe(20000 - 900);
  });

  it("never double-subtracts a cost already included in the sale price", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "COMMISSION", amount: 500, source: "ACTUAL", isIncludedInPrice: true }],
        unavailable: [],
      },
    });
    const result = engine.evaluate(input);
    // The commission is reported for transparency but not subtracted again.
    expect(result.netRealization).toBe(20000);
    expect(result.totalDeductions).toBe(0);
  });

  it("handles an empty cost list (no applicable categories) as COMPLETE with full completeness score", () => {
    const result = engine.evaluate(baseInput());
    expect(result.completeness).toBe("COMPLETE");
    expect(result.dataCompletenessScore).toBe(1);
  });

  it("computes dataCompletenessScore as resolved / (resolved + unavailable)", () => {
    const input = baseInput({
      costs: {
        resolved: [
          { category: "COMMISSION", amount: 200, source: "ACTUAL" },
          { category: "STORAGE", amount: 100, source: "ESTIMATED" },
        ],
        unavailable: [
          { category: "TRANSPORT", reason: "TRANSPORT_COST_UNAVAILABLE" },
          { category: "TAX", reason: "TAX_COST_UNAVAILABLE" },
        ],
      },
    });
    const result = engine.evaluate(input);
    expect(result.dataCompletenessScore).toBe(0.5);
  });

  it("supports multiple OTHER cost lines distinguished by name", () => {
    const input = baseInput({
      costs: {
        resolved: [
          { category: "OTHER", name: "Weighbridge fee", amount: 50, source: "USER_PROVIDED" },
          { category: "OTHER", name: "Cleaning fee", amount: 30, source: "USER_PROVIDED" },
        ],
        unavailable: [],
      },
    });
    const result = engine.evaluate(input);
    expect(result.totalUserProvidedCosts).toBe(80);
    expect(result.explanation.includedFactors).toEqual(
      expect.arrayContaining([expect.stringContaining("Weighbridge fee"), expect.stringContaining("Cleaning fee")]),
    );
  });

  it("accepts a zero-amount resolved cost as valid data, not the same as unavailable", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "INSURANCE", amount: 0, source: "USER_PROVIDED" }],
        unavailable: [],
      },
    });
    const result = engine.evaluate(input);
    expect(result.completeness).toBe("COMPLETE");
    expect(result.netRealization).toBe(20000);
  });

  it("uses Decimal-safe precision (no float drift) across many fractional costs", () => {
    const resolved = Array.from({ length: 20 }, (_, i) => ({
      category: "OTHER" as const,
      name: `Fee ${i}`,
      amount: 0.1,
      source: "USER_PROVIDED" as const,
    }));
    const input = baseInput({ costs: { resolved, unavailable: [] } });
    const result = engine.evaluate(input);
    expect(result.totalUserProvidedCosts).toBe(2);
    expect(result.netRealization).toBe(20000 - 2);
  });

  it("is deterministic: identical input always produces an identical result", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "COMMISSION", amount: 333.33, source: "ACTUAL" }],
        unavailable: [{ category: "TRANSPORT", reason: "TRANSPORT_COST_UNAVAILABLE" }],
      },
    });
    const first = engine.evaluate(input);
    const second = engine.evaluate(JSON.parse(JSON.stringify(input)));
    expect(second).toEqual(first);
  });

  it("includes the fixed disclaimer in every explanation, regardless of completeness", () => {
    const complete = engine.evaluate(baseInput());
    const insufficient = engine.evaluate(
      baseInput({
        sale: { pricePerUnit: null, priceUnit: null, quantity: null, quantityUnit: null, source: { type: "UNAVAILABLE", referenceId: null, valueSource: "UNKNOWN" } },
      }),
    );
    expect(complete.explanation.disclaimer).toContain("informational");
    expect(insufficient.explanation.disclaimer).toContain("informational");
  });

  it("records calculation metadata factors correctly for a mixed COMPLETE/PARTIAL case", () => {
    const input = baseInput({
      costs: {
        resolved: [{ category: "STORAGE", amount: 120, source: "ESTIMATED" }],
        unavailable: [{ category: "COMMISSION", reason: "COMMISSION_COST_UNAVAILABLE" }],
      },
    });
    const result = engine.evaluate(input);
    expect(result.explanation.includedFactors).toEqual(expect.arrayContaining([expect.stringContaining("storage")]));
    expect(result.explanation.omittedFactors).toEqual(
      expect.arrayContaining([expect.stringContaining("commission")]),
    );
  });
});
