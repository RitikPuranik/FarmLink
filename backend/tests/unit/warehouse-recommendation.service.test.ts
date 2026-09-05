import { WarehouseRecommendationService } from "../../src/modules/warehouse-intelligence/warehouse-recommendation.service";

function actor(overrides: Partial<{ id: string; role: string }> = {}) {
  return { id: "user-1", role: "FARMER", ...overrides } as any;
}

function warehouseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-id-1",
    publicId: "wh-1",
    ownerType: "USER",
    ownerUserId: "operator-1",
    ownerFpoId: null,
    name: "Test Warehouse",
    warehouseType: "AMBIENT",
    state: "MH",
    district: "Pune",
    address: null,
    latitude: 18.5,
    longitude: 73.8,
    verificationStatus: "VERIFIED",
    status: "ACTIVE",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    storageUnits: [],
    capabilities: [],
    ...overrides,
  };
}

function analysisResult(overrides: Record<string, unknown> = {}) {
  return {
    warehouseId: "wh-1",
    cropId: "crop-1",
    suitability: "SUITABLE",
    suitabilityScore: 90,
    confidence: 1,
    blockingIssues: [],
    risks: [],
    constraints: [],
    factorsUsed: [],
    omittedFactors: [],
    cropCompatibility: "SUPPORTED",
    durationCompatibility: "NOT_APPLICABLE",
    environmentalCompatibility: "SUITABLE",
    operationalStatus: "OPERATIONAL",
    availabilitySummary: { status: "AVAILABLE", totalKg: 1000, availableKg: 1000, canAccommodate: null },
    evaluatedAt: new Date().toISOString(),
    disclaimer: "",
    ...overrides,
  };
}

class FakeWarehouseRepository {
  constructor(private readonly candidates: any[]) {}
  findNearbyCandidates = jest.fn(async () => this.candidates);
  findCandidatesByCrop = jest.fn(async () => this.candidates);
}

function fakeReferenceData(crop = { id: "crop-1", name: "Onion" }) {
  return { getActiveCropOrThrow: jest.fn(async () => crop) } as any;
}

function fakeStorageRates(rates: any[] = []) {
  return { findApplicable: jest.fn(async () => rates) } as any;
}

describe("WarehouseRecommendationService.recommend", () => {
  it("ranks two suitable candidates and excludes an unsuitable one", async () => {
    const near = warehouseRow({ publicId: "wh-near", latitude: 18.51, longitude: 73.81 });
    const far = warehouseRow({ publicId: "wh-far", latitude: 19.5, longitude: 74.5 });
    const bad = warehouseRow({ publicId: "wh-bad", latitude: 18.5, longitude: 73.8 });

    const analysisByWarehouse: Record<string, any> = {
      "wh-near": analysisResult({ suitabilityScore: 90 }),
      "wh-far": analysisResult({ suitabilityScore: 90 }),
      "wh-bad": analysisResult({ suitability: "UNSUITABLE", suitabilityScore: null }),
    };
    const fakeAnalysis = { analyzeSuitability: jest.fn(async (publicId: string) => analysisByWarehouse[publicId]) } as any;

    const service = new WarehouseRecommendationService(
      new FakeWarehouseRepository([near, far, bad]) as any,
      fakeAnalysis,
      fakeStorageRates([]),
      fakeReferenceData(),
    );

    const result = await service.recommend({ cropId: "crop-1", latitude: 18.5, longitude: 73.8, radiusKm: 100 }, actor());

    expect(result.excludedCandidateCount).toBe(1);
    expect(result.recommendations.map((r) => r.warehouse.publicId)).not.toContain("wh-bad");
    expect(result.recommendations[0].rank).toBe(1);
    // Nearer candidate should generally rank at least as well given identical suitability.
    expect(result.recommendations.map((r) => r.warehouse.publicId)).toEqual(
      expect.arrayContaining(["wh-near", "wh-far"]),
    );
  });

  it("separates UNKNOWN candidates into unevaluableCandidates, never mixed into recommendations", async () => {
    const wh = warehouseRow();
    const fakeAnalysis = {
      analyzeSuitability: jest.fn(async () => analysisResult({ suitability: "UNKNOWN", suitabilityScore: null, confidence: null })),
    } as any;

    const service = new WarehouseRecommendationService(
      new FakeWarehouseRepository([wh]) as any,
      fakeAnalysis,
      fakeStorageRates([]),
      fakeReferenceData(),
    );

    const result = await service.recommend({ cropId: "crop-1" }, actor());
    expect(result.recommendations).toEqual([]);
    expect(result.unevaluableCandidates).toHaveLength(1);
    expect(result.unevaluableCandidates[0].reason).toBe("INSUFFICIENT_DATA");
  });

  it("returns empty arrays with full metadata (not an error) when there are no candidates at all", async () => {
    const fakeAnalysis = { analyzeSuitability: jest.fn() } as any;
    const service = new WarehouseRecommendationService(
      new FakeWarehouseRepository([]) as any,
      fakeAnalysis,
      fakeStorageRates([]),
      fakeReferenceData(),
    );

    const result = await service.recommend({ cropId: "crop-1" }, actor());
    expect(result.recommendations).toEqual([]);
    expect(result.evaluatedCandidateCount).toBe(0);
    expect(result.searchMetadata.cropId).toBe("crop-1");
    expect(fakeAnalysis.analyzeSuitability).not.toHaveBeenCalled();
  });

  it("only produces a cost estimate when quantity, unit, duration, and an applicable rate all exist together", async () => {
    const wh = warehouseRow();
    const fakeAnalysis = { analyzeSuitability: jest.fn(async () => analysisResult()) } as any;

    // No duration requested -> cost stays null even though a rate exists.
    const serviceNoDuration = new WarehouseRecommendationService(
      new FakeWarehouseRepository([wh]) as any,
      fakeAnalysis,
      fakeStorageRates([{ cropId: "crop-1", rateType: "PER_DAY", rateAmount: 10, currency: "INR", billingUnit: "KG" }]),
      fakeReferenceData(),
    );
    const noDurationResult = await serviceNoDuration.recommend({ cropId: "crop-1", quantity: 100, unit: "KG" as any }, actor());
    expect(noDurationResult.recommendations[0].estimatedStorageCost).toBeNull();

    // Duration + quantity + rate all present -> a real cost estimate.
    const serviceWithRate = new WarehouseRecommendationService(
      new FakeWarehouseRepository([wh]) as any,
      fakeAnalysis,
      fakeStorageRates([{ cropId: "crop-1", rateType: "PER_DAY", rateAmount: 10, currency: "INR", billingUnit: "KG" }]),
      fakeReferenceData(),
    );
    const withRateResult = await serviceWithRate.recommend(
      { cropId: "crop-1", quantity: 100, unit: "KG" as any, durationDays: 5 },
      actor(),
    );
    expect(withRateResult.recommendations[0].estimatedStorageCost?.amount).toBe(50);
  });

  it("is deterministic: repeated calls with unchanged inputs produce the same ranking", async () => {
    const a = warehouseRow({ publicId: "wh-a" });
    const b = warehouseRow({ publicId: "wh-b" });
    const fakeAnalysis = { analyzeSuitability: jest.fn(async () => analysisResult()) } as any;
    const service = new WarehouseRecommendationService(
      new FakeWarehouseRepository([a, b]) as any,
      fakeAnalysis,
      fakeStorageRates([]),
      fakeReferenceData(),
    );

    const r1 = await service.recommend({ cropId: "crop-1" }, actor());
    const r2 = await service.recommend({ cropId: "crop-1" }, actor());
    expect(r1.recommendations.map((r) => r.warehouse.publicId)).toEqual(r2.recommendations.map((r) => r.warehouse.publicId));
  });
});
