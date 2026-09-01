import { scoreMatch } from "../../src/modules/buyer-matching/matching";
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
});
