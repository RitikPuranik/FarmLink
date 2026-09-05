import {
  buildRecommendationExplanation,
  compareForRanking,
  computeRankingScore,
  estimateStorageCost,
  riskSeverityWeight,
  scoreCapacityHeadroom,
  scoreCostsRelatively,
  scoreDistance,
  TieBreakCandidate,
} from "../../src/modules/warehouse-intelligence/warehouse-recommendation.engine";

function candidate(overrides: Partial<TieBreakCandidate> = {}): TieBreakCandidate {
  return {
    rankingScore: 80,
    suitabilityScore: 90,
    risks: [],
    distanceKm: 10,
    availableCapacityKg: 1000,
    warehousePublicId: "wh-a",
    ...overrides,
  };
}

describe("scoreDistance", () => {
  it("scores 100 at zero distance and 0 at the radius edge", () => {
    expect(scoreDistance(0, 50)).toBe(100);
    expect(scoreDistance(50, 50)).toBe(0);
    expect(scoreDistance(25, 50)).toBe(50);
  });

  it("is omitted (null) when distance or radius is unknown", () => {
    expect(scoreDistance(null, 50)).toBeNull();
    expect(scoreDistance(10, null)).toBeNull();
  });
});

describe("scoreCapacityHeadroom", () => {
  it("scores exactly-enough capacity at 50 and saturates at 100 with full headroom", () => {
    expect(scoreCapacityHeadroom(1000, 1000, "AVAILABLE")).toBe(50);
    expect(scoreCapacityHeadroom(2000, 1000, "AVAILABLE")).toBe(100); // 100% headroom = saturation ratio 1
  });

  it("is null when a quantity was requested but availability is unknown", () => {
    expect(scoreCapacityHeadroom(null, 1000, "UNAVAILABLE")).toBeNull();
  });

  it("falls back to the reused capacity-status score when no quantity was requested", () => {
    expect(scoreCapacityHeadroom(500, null, "LIMITED")).toBe(70);
    expect(scoreCapacityHeadroom(null, null, "UNAVAILABLE")).toBeNull();
  });
});

describe("scoreCostsRelatively", () => {
  it("scores the cheapest candidate 100 and the most expensive 0", () => {
    const scores = scoreCostsRelatively([100, 200, 300]);
    expect(scores).toEqual([100, 50, 0]);
  });

  it("scores everyone 100 when all known costs are equal", () => {
    expect(scoreCostsRelatively([50, 50])).toEqual([100, 100]);
  });

  it("keeps null entries null and never lets them affect the min/max", () => {
    expect(scoreCostsRelatively([100, null, 300])).toEqual([100, null, 0]);
  });

  it("returns all-null when no cost is known at all", () => {
    expect(scoreCostsRelatively([null, null])).toEqual([null, null]);
  });
});

describe("computeRankingScore", () => {
  it("rebalances proportionally when a factor (commonly cost) is unavailable", () => {
    const withCost = computeRankingScore({ DISTANCE: 100, SUITABILITY_SCORE: 100, CAPACITY_HEADROOM: 100, STORAGE_COST: 0 });
    const withoutCost = computeRankingScore({ DISTANCE: 100, SUITABILITY_SCORE: 100, CAPACITY_HEADROOM: 100, STORAGE_COST: null });
    expect(withoutCost.omittedFactors).toEqual(["STORAGE_COST"]);
    expect(withoutCost.score).toBe(100); // the three remaining factors are all perfect
    expect(withCost.score).toBeLessThan(100); // a real 0-cost-score candidate scores worse
  });
});

describe("estimateStorageCost", () => {
  const toKg = (v: number, unit: "KG" | "QTL" | "TONNE") => (unit === "KG" ? v : unit === "QTL" ? v * 100 : v * 1000);

  it("is null when quantity or duration is missing", () => {
    expect(estimateStorageCost({ rateType: "PER_DAY", rateAmount: 10, currency: "INR", billingUnit: "KG" }, toKg, null, 5)).toBeNull();
    expect(estimateStorageCost({ rateType: "PER_DAY", rateAmount: 10, currency: "INR", billingUnit: "KG" }, toKg, 100, undefined as any)).toBeNull();
  });

  it("computes a flat PER_DAY cost independent of quantity", () => {
    const est = estimateStorageCost({ rateType: "PER_DAY", rateAmount: 10, currency: "INR", billingUnit: "KG" }, toKg, 5000, 10);
    expect(est?.amount).toBe(100);
    expect(est?.pricingBasis).toBe("PER_DAY");
  });

  it("computes PER_QUANTITY_PER_DAY scaled by quantity and converted to the billing unit", () => {
    // Rate is 1 INR per QTL per day; 500 kg = 5 QTL; 5 QTL * 1 * 10 days = 50
    const est = estimateStorageCost({ rateType: "PER_QUANTITY_PER_DAY", rateAmount: 1, currency: "INR", billingUnit: "QTL" }, toKg, 500, 10);
    expect(est?.amount).toBe(50);
  });

  it("rounds PER_WEEK/PER_MONTH up to whole billing periods", () => {
    const week = estimateStorageCost({ rateType: "PER_WEEK", rateAmount: 100, currency: "INR", billingUnit: "KG" }, toKg, 1000, 10);
    expect(week?.amount).toBe(200); // 10 days = 2 whole weeks
    const month = estimateStorageCost({ rateType: "PER_MONTH", rateAmount: 1000, currency: "INR", billingUnit: "KG" }, toKg, 1000, 35);
    expect(month?.amount).toBe(2000); // 35 days = 2 whole 30-day months
  });
});

describe("riskSeverityWeight", () => {
  it("sums severity weights across risks", () => {
    expect(
      riskSeverityWeight([
        { code: "LIMITED_CAPACITY", severity: "MEDIUM", blocking: false, explanation: "" },
        { code: "CROP_COMPATIBILITY_UNKNOWN", severity: "HIGH", blocking: false, explanation: "" },
      ]),
    ).toBe(5);
  });
});

describe("compareForRanking", () => {
  it("orders by rankingScore descending first", () => {
    const a = candidate({ rankingScore: 90 });
    const b = candidate({ rankingScore: 80 });
    expect(compareForRanking(a, b)).toBeLessThan(0);
  });

  it("falls back to suitabilityScore when rankingScore ties", () => {
    const a = candidate({ rankingScore: 80, suitabilityScore: 95 });
    const b = candidate({ rankingScore: 80, suitabilityScore: 85 });
    expect(compareForRanking(a, b)).toBeLessThan(0);
  });

  it("falls back to lower risk severity, then shorter distance, then greater capacity, then publicId", () => {
    const a = candidate({ risks: [{ code: "LIMITED_CAPACITY", severity: "LOW", blocking: false, explanation: "" }] });
    const b = candidate({ risks: [{ code: "LIMITED_CAPACITY", severity: "HIGH", blocking: false, explanation: "" }] });
    expect(compareForRanking(a, b)).toBeLessThan(0);

    const c = candidate({ distanceKm: 5 });
    const d = candidate({ distanceKm: 20 });
    expect(compareForRanking(c, d)).toBeLessThan(0);

    const e = candidate({ availableCapacityKg: 2000 });
    const f = candidate({ availableCapacityKg: 1000 });
    expect(compareForRanking(e, f)).toBeLessThan(0);

    const g = candidate({ warehousePublicId: "wh-a" });
    const h = candidate({ warehousePublicId: "wh-b" });
    expect(compareForRanking(g, h)).toBeLessThan(0);
  });

  it("never treats an unknown distance as the closest", () => {
    const known = candidate({ distanceKm: 100 });
    const unknown = candidate({ distanceKm: null });
    expect(compareForRanking(known, unknown)).toBeLessThan(0);
  });

  it("is a stable, fully deterministic total order (never relies on input order)", () => {
    const list = [candidate({ warehousePublicId: "wh-c" }), candidate({ warehousePublicId: "wh-a" }), candidate({ warehousePublicId: "wh-b" })];
    const sorted1 = [...list].sort(compareForRanking).map((c) => c.warehousePublicId);
    const sorted2 = [...list].reverse().sort(compareForRanking).map((c) => c.warehousePublicId);
    expect(sorted1).toEqual(sorted2);
    expect(sorted1).toEqual(["wh-a", "wh-b", "wh-c"]);
  });
});

describe("buildRecommendationExplanation", () => {
  it("only mentions factors actually used, never a claimed but omitted one", () => {
    const explanation = buildRecommendationExplanation({
      suitability: "SUITABLE",
      factorsUsed: ["CAPACITY_HEADROOM", "DISTANCE"],
      distanceKm: 12.3,
      hasCostEstimate: false,
    });
    expect(explanation).toContain("sufficient available capacity");
    expect(explanation).toContain("12.3 km");
    expect(explanation).not.toContain("priced");
  });

  it("reflects CONDITIONALLY_SUITABLE with softer language than SUITABLE", () => {
    const explanation = buildRecommendationExplanation({
      suitability: "CONDITIONALLY_SUITABLE",
      factorsUsed: [],
      distanceKm: null,
      hasCostEstimate: false,
    });
    expect(explanation).toContain("non-critical constraints");
  });
});
