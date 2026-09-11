import { LogisticsOptimizationEngine, OptimizationCandidate } from "../../src/modules/logistics/logistics-optimization.engine";

const weights = { priceWeight: 0.4, distanceWeight: 0.1, timeWeight: 0.2, capacityWeight: 0.15, reliabilityWeight: 0.15 };

function candidate(overrides: Partial<OptimizationCandidate> & { quoteId: string }): OptimizationCandidate {
  return {
    quotedAmount: 1000,
    estimatedDistanceKm: 100,
    estimatedDurationMinutes: 120,
    vehicleCapacityKg: 5000,
    reliabilityScore: 50,
    reliabilitySource: "DEFAULT",
    ...overrides,
  };
}

describe("LogisticsOptimizationEngine", () => {
  const engine = new LogisticsOptimizationEngine();

  it("returns an empty ranking for zero candidates", () => {
    const result = engine.rank([], { requiredCapacityKg: 1000 }, weights);
    expect(result.rankings).toEqual([]);
    expect(result.recommendedQuoteId).toBeNull();
  });

  it("does not simply choose the cheapest quote — a much slower/less reliable cheap quote can lose to a well-rounded one", () => {
    const cheapButSlow = candidate({
      quoteId: "cheap",
      quotedAmount: 500,
      estimatedDurationMinutes: 1000,
      reliabilityScore: 10,
      reliabilitySource: "COMPUTED",
    });
    const balanced = candidate({
      quoteId: "balanced",
      quotedAmount: 650,
      estimatedDurationMinutes: 100,
      reliabilityScore: 95,
      reliabilitySource: "COMPUTED",
    });
    const pricey = candidate({
      quoteId: "pricey",
      quotedAmount: 1000,
      estimatedDurationMinutes: 110,
      reliabilityScore: 90,
      reliabilitySource: "COMPUTED",
    });
    const result = engine.rank([cheapButSlow, balanced, pricey], { requiredCapacityKg: 5000 }, weights);
    expect(result.recommendedQuoteId).toBe("balanced");
  });

  it("is deterministic — the same input in any order always produces the same ranking", () => {
    const a = candidate({ quoteId: "a", quotedAmount: 900 });
    const b = candidate({ quoteId: "b", quotedAmount: 700 });
    const c = candidate({ quoteId: "c", quotedAmount: 800 });

    const first = engine.rank([a, b, c], { requiredCapacityKg: 5000 }, weights);
    const second = engine.rank([c, a, b], { requiredCapacityKg: 5000 }, weights);

    expect(first.rankings.map((r) => r.quoteId)).toEqual(second.rankings.map((r) => r.quoteId));
    expect(first.rankings.map((r) => r.score)).toEqual(second.rankings.map((r) => r.score));
  });

  it("breaks exact score ties deterministically by lowest price, then by quoteId", () => {
    const a = candidate({ quoteId: "z-quote", quotedAmount: 1000 });
    const b = candidate({ quoteId: "a-quote", quotedAmount: 1000 });
    const result = engine.rank([a, b], { requiredCapacityKg: 5000 }, weights);
    // Identical everything except quoteId — tie-break falls through to quoteId ascending.
    expect(result.rankings[0].quoteId).toBe("a-quote");
  });

  it("every component score is normalized to 0-100", () => {
    const result = engine.rank(
      [candidate({ quoteId: "a", quotedAmount: 100 }), candidate({ quoteId: "b", quotedAmount: 900 })],
      { requiredCapacityKg: 5000 },
      weights,
    );
    for (const ranking of result.rankings) {
      for (const value of Object.values(ranking.componentScores)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it("assigns the best price score to the lowest quoted amount", () => {
    const cheap = candidate({ quoteId: "cheap", quotedAmount: 500 });
    const expensive = candidate({ quoteId: "expensive", quotedAmount: 1500 });
    const result = engine.rank([cheap, expensive], { requiredCapacityKg: 5000 }, weights);
    const cheapEntry = result.rankings.find((r) => r.quoteId === "cheap")!;
    const expensiveEntry = result.rankings.find((r) => r.quoteId === "expensive")!;
    expect(cheapEntry.componentScores.priceScore).toBeGreaterThan(expensiveEntry.componentScores.priceScore);
  });

  it("gives every candidate a perfect component score when all values in the set are equal (no meaningless penalty)", () => {
    const a = candidate({ quoteId: "a" });
    const b = candidate({ quoteId: "b" });
    const result = engine.rank([a, b], { requiredCapacityKg: 5000 }, weights);
    for (const ranking of result.rankings) {
      expect(ranking.componentScores.priceScore).toBe(100);
      expect(ranking.componentScores.distanceScore).toBe(100);
      expect(ranking.componentScores.timeScore).toBe(100);
    }
  });

  it("rewards a tighter capacity fit over an oversized vehicle for the same job", () => {
    const tightFit = candidate({ quoteId: "tight", vehicleCapacityKg: 5000 });
    const oversized = candidate({ quoteId: "oversized", vehicleCapacityKg: 20000 });
    const result = engine.rank([tightFit, oversized], { requiredCapacityKg: 5000 }, weights);
    const tightEntry = result.rankings.find((r) => r.quoteId === "tight")!;
    const oversizedEntry = result.rankings.find((r) => r.quoteId === "oversized")!;
    expect(tightEntry.componentScores.capacityFitScore).toBeGreaterThan(oversizedEntry.componentScores.capacityFitScore);
    expect(tightEntry.reasons).toContain("GOOD_CAPACITY_FIT");
  });

  it("flags a DEFAULT reliability score as unverified rather than presenting it as earned trust", () => {
    const result = engine.rank(
      [candidate({ quoteId: "a", reliabilityScore: 90, reliabilitySource: "DEFAULT" })],
      { requiredCapacityKg: 5000 },
      weights,
    );
    expect(result.rankings[0].reasons).toContain("RELIABILITY_UNVERIFIED");
    expect(result.rankings[0].reasons).not.toContain("HIGH_PROVIDER_RELIABILITY");
  });

  it("labels the algorithm version and ranks are 1-indexed and contiguous", () => {
    const result = engine.rank(
      [candidate({ quoteId: "a" }), candidate({ quoteId: "b" }), candidate({ quoteId: "c" })],
      { requiredCapacityKg: 5000 },
      weights,
    );
    expect(result.algorithmVersion).toBe("v1");
    expect(result.rankings.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
