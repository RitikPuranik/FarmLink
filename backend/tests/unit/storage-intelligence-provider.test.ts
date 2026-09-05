import { UnavailableStorageIntelligenceProvider } from "../../src/modules/warehouse-intelligence/storage-intelligence-provider";
import { WarehouseStorageIntelligenceProvider } from "../../src/modules/warehouse-intelligence/storage-intelligence-provider.service";

function recommendationResult(overrides: Record<string, unknown> = {}) {
  return {
    recommendations: [],
    unevaluableCandidates: [],
    evaluatedCandidateCount: 0,
    suitableCandidateCount: 0,
    excludedCandidateCount: 0,
    searchMetadata: { cropId: "crop-1", quantity: null, unit: null, durationDays: null, latitude: null, longitude: null, radiusKm: null },
    disclaimer: "",
    ...overrides,
  };
}

function bestCandidate(overrides: Record<string, unknown> = {}) {
  return {
    warehouse: { publicId: "wh-1", name: "Best Warehouse" },
    rank: 1,
    rankingScore: 90,
    suitability: "SUITABLE",
    suitabilityScore: 95,
    confidence: 1,
    distanceKm: 12.5,
    availableCapacityKg: 1000,
    estimatedStorageCost: null,
    risks: [],
    constraints: [],
    factorsUsed: ["SUITABILITY_SCORE"],
    omittedFactors: [],
    explanation: "",
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakeRecommendationService(result: any) {
  return { recommend: jest.fn(async () => result) } as any;
}

describe("UnavailableStorageIntelligenceProvider", () => {
  it("always resolves availability to null, never false or true", async () => {
    const provider = new UnavailableStorageIntelligenceProvider();
    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.availability).toBeNull();
    expect(context.suitableWarehouseCount).toBe(0);
    expect(context.bestWarehouseAvailable).toBeNull();
    expect(context.risks).toEqual([]);
  });
});

describe("WarehouseStorageIntelligenceProvider", () => {
  it("reports availability: true and a bestWarehouseAvailable when a recommendation exists", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(recommendationResult({ recommendations: [bestCandidate()], suitableCandidateCount: 1 })),
    );

    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.availability).toBe(true);
    expect(context.bestWarehouseAvailable).toEqual({
      warehousePublicId: "wh-1",
      name: "Best Warehouse",
      distanceKm: 12.5,
      suitabilityScore: 95,
    });
    expect(context.suitableWarehouseCount).toBe(1);
  });

  it("reports availability: false when candidates were evaluated and all were confirmed unsuitable", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(recommendationResult({ evaluatedCandidateCount: 3, excludedCandidateCount: 3 })),
    );

    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.availability).toBe(false);
  });

  it("reports availability: false when no candidate warehouse exists for the crop at all", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(fakeRecommendationService(recommendationResult({ evaluatedCandidateCount: 0 })));

    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.availability).toBe(false);
  });

  it("reports availability: null (never false) when candidates existed but couldn't be confidently evaluated", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(
        recommendationResult({
          evaluatedCandidateCount: 2,
          unevaluableCandidates: [{ warehouse: { publicId: "wh-2" }, reason: "INSUFFICIENT_DATA", explanationCodes: ["ENVIRONMENTAL_DATA_UNKNOWN"] }],
        }),
      ),
    );

    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.availability).toBeNull();
    expect(context.risks).toEqual(["ENVIRONMENTAL_DATA_UNKNOWN"]);
  });

  it("computes costPerUnit from the best candidate's cost estimate", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(
        recommendationResult({
          recommendations: [
            bestCandidate({
              estimatedStorageCost: { amount: 500, currency: "INR", pricingBasis: "PER_DAY", quantityUsedKg: 1000, durationUsedDays: 10, assumptions: [] },
            }),
          ],
          suitableCandidateCount: 1,
        }),
      ),
    );

    const context = await provider.resolveStorageContext({ cropId: "crop-1", quantity: 1000, unit: "KG" as any, requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.estimatedCost).toBe(500);
    expect(context.costPerUnit).toBe(0.5);
    expect(context.currency).toBe("INR");
  });

  it("only reports feasibleDurationDays when a duration was requested and not exceeded", async () => {
    const providerExceeded = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(
        recommendationResult({
          recommendations: [bestCandidate({ constraints: [{ code: "MAXIMUM_STORAGE_DURATION_EXCEEDED", blocking: true, explanation: "" }] })],
          suitableCandidateCount: 1,
        }),
      ),
    );
    const exceededContext = await providerExceeded.resolveStorageContext({
      cropId: "crop-1",
      durationDays: 60,
      requestingUser: { id: "u1", role: "FARMER" },
    });
    expect(exceededContext.feasibleDurationDays).toBeNull();

    const providerOk = new WarehouseStorageIntelligenceProvider(
      fakeRecommendationService(recommendationResult({ recommendations: [bestCandidate()], suitableCandidateCount: 1 })),
    );
    const okContext = await providerOk.resolveStorageContext({ cropId: "crop-1", durationDays: 10, requestingUser: { id: "u1", role: "FARMER" } });
    expect(okContext.feasibleDurationDays).toBe(10);
  });

  it("never fabricates a value: every field on an empty result is null/empty/zero, never a guess", async () => {
    const provider = new WarehouseStorageIntelligenceProvider(fakeRecommendationService(recommendationResult()));
    const context = await provider.resolveStorageContext({ cropId: "crop-1", requestingUser: { id: "u1", role: "FARMER" } });
    expect(context.estimatedCost).toBeNull();
    expect(context.costPerUnit).toBeNull();
    expect(context.currency).toBeNull();
    expect(context.feasibleDurationDays).toBeNull();
    expect(context.bestWarehouseAvailable).toBeNull();
  });
});
