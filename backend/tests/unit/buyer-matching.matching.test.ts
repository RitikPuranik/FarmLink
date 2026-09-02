import { qualityCompatible, scoreMatch } from "../../src/modules/buyer-matching/matching";
import { demandTransitions, offerTransitions, requireTransition } from "../../src/modules/buyer-matching/buyer-matching.types";

describe("buyer matching", () => {
  it("rebalance score when optional factors are unavailable", () => {
    const match = scoreMatch({ quantityKg: 100, requiredQuantityKg: 100, minimumQuantityKg: null, verification: "VERIFIED" });
    expect(match.factorsUsed).toEqual(expect.arrayContaining(["CROP", "QUANTITY", "VERIFICATION"]));
    expect(match.omittedFactors).toEqual(expect.arrayContaining(["DISTANCE", "PRICE", "QUALITY"]));
    expect(match.matchScore).toBe(100);
    expect(match.matchConfidence).toBeLessThan(100);
  });
  it("keeps demand and offer lifecycle transitions centralized", () => {
    expect(() => requireTransition(demandTransitions, "DRAFT", "ACTIVE", "INVALID_DEMAND_TRANSITION")).not.toThrow();
    expect(() => requireTransition(demandTransitions, "FULFILLED", "ACTIVE", "INVALID_DEMAND_TRANSITION")).toThrow("INVALID_DEMAND_TRANSITION");
    expect(() => requireTransition(offerTransitions, "SENT", "ACCEPTED", "INVALID_OFFER_TRANSITION")).not.toThrow();
    expect(() => requireTransition(offerTransitions, "ACCEPTED", "COUNTERED", "INVALID_OFFER_TRANSITION")).toThrow("INVALID_OFFER_TRANSITION");
  });

  // --- Missing-factor rebalancing (7.6), one factor at a time ---

  const fullInput = {
    quantityKg: 500,
    requiredQuantityKg: 1000,
    minimumQuantityKg: 200,
    lotGrade: "A" as const,
    grade: "B" as const,
    lotLat: 23.25, lotLon: 77.41,
    demandLat: 23.30, demandLon: 77.50,
    targetPrice: 2000, offerablePrice: 2200,
    deliveryCompatible: true,
    verification: "VERIFIED" as const,
  };

  it("uses every factor when all inputs are present", () => {
    const match = scoreMatch(fullInput);
    expect(match.factorsUsed.sort()).toEqual(["CROP", "DELIVERY_WINDOW", "DISTANCE", "PRICE", "QUALITY", "QUANTITY", "VERIFICATION"].sort());
    expect(match.omittedFactors).toEqual([]);
    expect(match.distanceKm).not.toBeNull();
  });

  it("omits QUALITY and rebalances when grade info is missing", () => {
    const match = scoreMatch({ ...fullInput, lotGrade: undefined, grade: undefined });
    expect(match.factorsUsed).not.toContain("QUALITY");
    expect(match.omittedFactors).toContain("QUALITY");
    expect(match.warnings.some((w) => /quality/i.test(w))).toBe(true);
  });

  it("omits DISTANCE and rebalances when either location is missing", () => {
    const match = scoreMatch({ ...fullInput, demandLat: null, demandLon: null });
    expect(match.factorsUsed).not.toContain("DISTANCE");
    expect(match.omittedFactors).toContain("DISTANCE");
    expect(match.distanceKm).toBeNull();
    expect(match.warnings.some((w) => /distance/i.test(w))).toBe(true);
  });

  it("omits PRICE and rebalances when either price is missing", () => {
    const match = scoreMatch({ ...fullInput, targetPrice: null });
    expect(match.factorsUsed).not.toContain("PRICE");
    expect(match.omittedFactors).toContain("PRICE");
    expect(match.warnings.some((w) => /price/i.test(w))).toBe(true);
  });

  it("omits DELIVERY_WINDOW and rebalances when delivery compatibility is unknown", () => {
    const match = scoreMatch({ ...fullInput, deliveryCompatible: undefined });
    expect(match.factorsUsed).not.toContain("DELIVERY_WINDOW");
    expect(match.omittedFactors).toContain("DELIVERY_WINDOW");
  });

  it("never fabricates a passing quality/price/delivery signal when omitted — omitting always caps score at what present factors support", () => {
    const partial = scoreMatch({ quantityKg: 100, requiredQuantityKg: 100, minimumQuantityKg: null, verification: "VERIFIED" });
    // Only CROP(1) + QUANTITY(1) + VERIFICATION(1) contribute — all perfect —
    // so the rebalanced score is 100, but confidence must reflect that only
    // 3 of 7 possible factors were actually available.
    expect(partial.matchScore).toBe(100);
    expect(partial.matchConfidence).toBeLessThan(100);
  });

  it("keeps match score and match confidence as genuinely separate numbers, not aliases of each other", () => {
    const perfectButIncomplete = scoreMatch({ quantityKg: 100, requiredQuantityKg: 100, minimumQuantityKg: null, verification: "VERIFIED" });
    const goodButComplete = scoreMatch({ ...fullInput, offerablePrice: 2000 }); // price meets target exactly, everything else present
    expect(perfectButIncomplete.matchScore).toBe(100);
    expect(perfectButIncomplete.matchConfidence).toBeLessThan(perfectButIncomplete.matchScore);
    // Confidence should be higher with more complete information even if
    // the resulting suitability score differs.
    expect(goodButComplete.matchConfidence).toBeGreaterThan(perfectButIncomplete.matchConfidence);
  });

  it("scores an unverified buyer's demand lower without disqualifying it outright", () => {
    const unverified = scoreMatch({ ...fullInput, verification: "PENDING" as any });
    const verified = scoreMatch(fullInput);
    expect(unverified.factorsUsed).toContain("VERIFICATION");
    expect(unverified.matchScore).toBeLessThan(verified.matchScore);
  });

  it("penalizes an offerable price below the buyer's target instead of disqualifying", () => {
    const belowTarget = scoreMatch({ ...fullInput, offerablePrice: 1000 }); // target is 2000
    expect(belowTarget.factorsUsed).toContain("PRICE");
    expect(belowTarget.matchScore).toBeLessThan(scoreMatch(fullInput).matchScore);
  });

  // --- qualityCompatible() edge cases ---

  it("qualityCompatible returns null (unknown) rather than guessing when either grade is missing", () => {
    expect(qualityCompatible(null, "B")).toBeNull();
    expect(qualityCompatible("A", null)).toBeNull();
    expect(qualityCompatible(undefined, undefined)).toBeNull();
  });

  it("qualityCompatible correctly orders grades A > B > C > D > REJECTED", () => {
    expect(qualityCompatible("A", "B")).toBe(true); // lot grade exceeds requirement
    expect(qualityCompatible("B", "B")).toBe(true); // exact match
    expect(qualityCompatible("C", "B")).toBe(false); // lot grade below requirement
    expect(qualityCompatible("REJECTED", "D")).toBe(false);
  });

  // --- State machine edge cases (7.3 / 7.9) ---

  it("allows COUNTERED -> COUNTERED (repeated negotiation rounds)", () => {
    expect(() => requireTransition(offerTransitions, "COUNTERED", "COUNTERED", "INVALID_OFFER_TRANSITION")).not.toThrow();
  });

  it("rejects any transition out of a terminal offer state", () => {
    for (const terminal of ["ACCEPTED", "REJECTED", "WITHDRAWN", "EXPIRED"]) {
      expect(() => requireTransition(offerTransitions, terminal, "ACCEPTED", "INVALID_OFFER_TRANSITION")).toThrow("INVALID_OFFER_TRANSITION");
    }
  });

  it("rejects any transition out of a terminal demand state", () => {
    for (const terminal of ["FULFILLED", "CANCELLED", "EXPIRED"]) {
      expect(() => requireTransition(demandTransitions, terminal, "ACTIVE", "INVALID_DEMAND_TRANSITION")).toThrow("INVALID_DEMAND_TRANSITION");
    }
  });

  it("allows PAUSED -> ACTIVE and PAUSED -> CANCELLED but nothing else", () => {
    expect(() => requireTransition(demandTransitions, "PAUSED", "ACTIVE", "INVALID_DEMAND_TRANSITION")).not.toThrow();
    expect(() => requireTransition(demandTransitions, "PAUSED", "CANCELLED", "INVALID_DEMAND_TRANSITION")).not.toThrow();
    expect(() => requireTransition(demandTransitions, "PAUSED", "FULFILLED", "INVALID_DEMAND_TRANSITION")).toThrow("INVALID_DEMAND_TRANSITION");
  });
});

