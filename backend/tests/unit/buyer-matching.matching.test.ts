import { scoreMatch } from "../../src/modules/buyer-matching/matching";

describe("buyer matching", () => {
  it("rebalance score when optional factors are unavailable", () => {
    const match = scoreMatch({ quantityKg: 100, requiredQuantityKg: 100, minimumQuantityKg: null, verification: "VERIFIED" });
    expect(match.factorsUsed).toEqual(expect.arrayContaining(["CROP", "QUANTITY", "VERIFICATION"]));
    expect(match.omittedFactors).toEqual(expect.arrayContaining(["DISTANCE", "PRICE", "QUALITY"]));
    expect(match.matchScore).toBe(100);
    expect(match.matchConfidence).toBeLessThan(100);
  });
});
