import {
  compareDuration,
  computeConfidence,
  computeWeightedScore,
  evaluateOperationalStatus,
  evaluateWarehouseSuitabilityRisk,
  scoreForFactor,
} from "../../src/modules/warehouse-intelligence/warehouse-risk-analysis.engine";
import { EvaluatedFactorsInput } from "../../src/modules/warehouse-intelligence/warehouse-risk-analysis.engine";

function factors(overrides: Partial<EvaluatedFactorsInput> = {}): EvaluatedFactorsInput {
  return {
    cropCompatibility: "SUPPORTED",
    capacityStatus: "AVAILABLE",
    canAccommodate: null,
    quantityRequested: false,
    durationCompatibility: "NOT_APPLICABLE",
    environmentalCompatibility: "SUITABLE",
    operationalStatus: "OPERATIONAL",
    ...overrides,
  };
}

describe("compareDuration", () => {
  it("is NOT_APPLICABLE when no duration was requested", () => {
    expect(compareDuration(undefined, 30)).toBe("NOT_APPLICABLE");
  });

  it("is NOT_APPLICABLE when the warehouse has no configured maximum (never invents a limit)", () => {
    expect(compareDuration(45, null)).toBe("NOT_APPLICABLE");
  });

  it("is SUPPORTED when the requested duration is within the configured maximum", () => {
    expect(compareDuration(20, 30)).toBe("SUPPORTED");
    expect(compareDuration(30, 30)).toBe("SUPPORTED");
  });

  it("is EXCEEDS_MAXIMUM when the requested duration exceeds the configured maximum", () => {
    expect(compareDuration(31, 30)).toBe("EXCEEDS_MAXIMUM");
  });
});

describe("evaluateOperationalStatus", () => {
  it("is OPERATIONAL only when status is ACTIVE and isActive is true", () => {
    expect(evaluateOperationalStatus("ACTIVE", true)).toBe("OPERATIONAL");
    expect(evaluateOperationalStatus("ACTIVE", false)).toBe("UNAVAILABLE");
    expect(evaluateOperationalStatus("SUSPENDED", true)).toBe("UNAVAILABLE");
  });
});

describe("scoreForFactor", () => {
  it("scores crop compatibility and omits UNKNOWN", () => {
    expect(scoreForFactor("CROP_COMPATIBILITY", "SUPPORTED")).toBe(100);
    expect(scoreForFactor("CROP_COMPATIBILITY", "UNSUPPORTED")).toBe(0);
    expect(scoreForFactor("CROP_COMPATIBILITY", "UNKNOWN")).toBeNull();
  });

  it("scores capacity feasibility using canAccommodate when a quantity was requested", () => {
    expect(scoreForFactor("CAPACITY_FEASIBILITY", { capacityStatus: "AVAILABLE", canAccommodate: true, quantityRequested: true })).toBe(100);
    expect(scoreForFactor("CAPACITY_FEASIBILITY", { capacityStatus: "AVAILABLE", canAccommodate: false, quantityRequested: true })).toBe(0);
    expect(scoreForFactor("CAPACITY_FEASIBILITY", { capacityStatus: "AVAILABLE", canAccommodate: null, quantityRequested: true })).toBeNull();
  });

  it("scores capacity feasibility using capacity status when no quantity was requested", () => {
    expect(scoreForFactor("CAPACITY_FEASIBILITY", { capacityStatus: "LIMITED", canAccommodate: null, quantityRequested: false })).toBe(70);
    expect(scoreForFactor("CAPACITY_FEASIBILITY", { capacityStatus: "UNAVAILABLE", canAccommodate: null, quantityRequested: false })).toBeNull();
  });
});

describe("computeWeightedScore", () => {
  it("rebalances proportionally when some factors are omitted, never assigning a fake neutral score", () => {
    const result = computeWeightedScore({
      CROP_COMPATIBILITY: 100,
      CAPACITY_FEASIBILITY: 100,
      DURATION_COMPATIBILITY: null,
      ENVIRONMENTAL_COMPATIBILITY: null,
      WAREHOUSE_OPERATIONAL_STATUS: 100,
    });
    expect(result.score).toBe(100);
    expect(result.factorsUsed.sort()).toEqual(["CAPACITY_FEASIBILITY", "CROP_COMPATIBILITY", "WAREHOUSE_OPERATIONAL_STATUS"].sort());
    expect(result.omittedFactors.sort()).toEqual(["DURATION_COMPATIBILITY", "ENVIRONMENTAL_COMPATIBILITY"].sort());
  });

  it("is null only when every factor is omitted", () => {
    const result = computeWeightedScore({
      CROP_COMPATIBILITY: null,
      CAPACITY_FEASIBILITY: null,
      DURATION_COMPATIBILITY: null,
      ENVIRONMENTAL_COMPATIBILITY: null,
      WAREHOUSE_OPERATIONAL_STATUS: null,
    });
    expect(result.score).toBeNull();
  });

  it("stays within 0-100 bounds for a mixed result", () => {
    const result = computeWeightedScore({
      CROP_COMPATIBILITY: 0,
      CAPACITY_FEASIBILITY: 70,
      DURATION_COMPATIBILITY: 100,
      ENVIRONMENTAL_COMPATIBILITY: 70,
      WAREHOUSE_OPERATIONAL_STATUS: 100,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("computeConfidence", () => {
  it("is null whenever a critical factor is unknown, regardless of how many other factors are known", () => {
    expect(computeConfidence(true, ["CAPACITY_FEASIBILITY", "DURATION_COMPATIBILITY", "WAREHOUSE_OPERATIONAL_STATUS"])).toBeNull();
  });

  it("is the fraction of total weight actually evaluated when nothing critical is unknown", () => {
    // CROP_COMPATIBILITY(25) + CAPACITY_FEASIBILITY(25) + WAREHOUSE_OPERATIONAL_STATUS(15) = 65 of 100
    expect(computeConfidence(false, ["CROP_COMPATIBILITY", "CAPACITY_FEASIBILITY", "WAREHOUSE_OPERATIONAL_STATUS"])).toBe(0.65);
  });

  it("is 1 when every factor was evaluated", () => {
    expect(
      computeConfidence(false, ["CROP_COMPATIBILITY", "CAPACITY_FEASIBILITY", "DURATION_COMPATIBILITY", "ENVIRONMENTAL_COMPATIBILITY", "WAREHOUSE_OPERATIONAL_STATUS"]),
    ).toBe(1);
  });
});

describe("evaluateWarehouseSuitabilityRisk", () => {
  it("is SUITABLE with a perfect score when every applicable factor is known and satisfied", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors());
    expect(result.suitability).toBe("SUITABLE");
    expect(result.suitabilityScore).toBe(100);
    // Duration wasn't requested, so it's legitimately omitted (NOT_APPLICABLE,
    // weight 10) — confidence reflects that only 90 of 100 weight was
    // actually evaluated, even though the result is still fully SUITABLE.
    expect(result.confidence).toBe(0.9);
    expect(result.blockingIssues).toEqual([]);
  });

  it("is UNSUITABLE (blocking) for an explicitly incompatible crop", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ cropCompatibility: "UNSUPPORTED" }));
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.risks.some((r) => r.code === "CROP_INCOMPATIBILITY" && r.blocking)).toBe(true);
    expect(result.constraints.some((c) => c.code === "CROP_EXPLICITLY_UNSUPPORTED" && c.blocking)).toBe(true);
  });

  it("is UNSUITABLE when the requested quantity exceeds available capacity", () => {
    const result = evaluateWarehouseSuitabilityRisk(
      factors({ quantityRequested: true, canAccommodate: false, capacityStatus: "LIMITED" }),
    );
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.risks.some((r) => r.code === "CAPACITY_CONSTRAINT" && r.blocking)).toBe(true);
  });

  it("is CONDITIONALLY_SUITABLE (not blocking) for limited-but-sufficient capacity", () => {
    const result = evaluateWarehouseSuitabilityRisk(
      factors({ quantityRequested: true, canAccommodate: true, capacityStatus: "LIMITED" }),
    );
    expect(result.suitability).toBe("CONDITIONALLY_SUITABLE");
    expect(result.risks.some((r) => r.code === "LIMITED_CAPACITY" && !r.blocking)).toBe(true);
  });

  it("is UNSUITABLE when the requested duration exceeds the configured maximum", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ durationCompatibility: "EXCEEDS_MAXIMUM" }));
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.constraints.some((c) => c.code === "MAXIMUM_STORAGE_DURATION_EXCEEDED" && c.blocking)).toBe(true);
  });

  it("is UNSUITABLE when the warehouse is operationally unavailable", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ operationalStatus: "UNAVAILABLE" }));
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.risks.some((r) => r.code === "WAREHOUSE_UNAVAILABLE" && r.blocking)).toBe(true);
  });

  it("is UNSUITABLE (blocking) for a known environmental incompatibility from Part 3", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ environmentalCompatibility: "UNSUITABLE" }));
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.risks.some((r) => r.code === "ENVIRONMENTAL_INCOMPATIBILITY" && r.blocking)).toBe(true);
  });

  it("is UNKNOWN (never UNSUITABLE) when environmental compatibility could not be determined", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ environmentalCompatibility: "UNKNOWN" }));
    expect(result.suitability).toBe("UNKNOWN");
    expect(result.suitabilityScore).toBeNull();
    expect(result.confidence).toBeNull();
    expect(result.blockingIssues).toEqual([]);
  });

  it("is UNKNOWN when crop compatibility is unknown, even though every other factor is fine", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ cropCompatibility: "UNKNOWN" }));
    expect(result.suitability).toBe("UNKNOWN");
    expect(result.confidence).toBeNull();
  });

  it("never treats an unrequested duration as a data gap serious enough to affect the outcome", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ durationCompatibility: "NOT_APPLICABLE" }));
    expect(result.suitability).toBe("SUITABLE");
    expect(result.omittedFactors).toContain("DURATION_COMPATIBILITY");
  });

  it("combines multiple simultaneous blocking and non-blocking issues without losing any of them", () => {
    const result = evaluateWarehouseSuitabilityRisk(
      factors({
        cropCompatibility: "UNSUPPORTED", // blocking
        environmentalCompatibility: "CONDITIONALLY_SUITABLE", // non-blocking
      }),
    );
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.risks.length).toBeGreaterThanOrEqual(2);
    expect(result.blockingIssues.length).toBe(2); // risk + mirrored constraint for crop incompatibility
  });

  it("reaches full confidence (1) when every factor, including duration, was actually evaluated", () => {
    const result = evaluateWarehouseSuitabilityRisk(factors({ durationCompatibility: "SUPPORTED" }));
    expect(result.confidence).toBe(1);
  });

  it("is deterministic: identical inputs always produce an identical result", () => {
    const input = factors({ quantityRequested: true, canAccommodate: true, capacityStatus: "LIMITED" });
    expect(evaluateWarehouseSuitabilityRisk(input)).toEqual(evaluateWarehouseSuitabilityRisk(input));
  });
});
