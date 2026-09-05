import { WarehouseSuitabilityAnalysisService } from "../../src/modules/warehouse-intelligence/warehouse-risk-analysis.service";

function actor(overrides: Partial<{ id: string; role: string }> = {}) {
  return { id: "user-1", role: "FARMER", ...overrides } as any;
}

function warehouseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-1",
    publicId: "wh-1",
    ownerType: "USER",
    ownerUserId: "operator-1",
    ownerFpoId: null,
    name: "Test Warehouse",
    warehouseType: "AMBIENT",
    state: "MH",
    district: "Pune",
    address: null,
    latitude: null,
    longitude: null,
    verificationStatus: "VERIFIED",
    status: "ACTIVE",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    storageUnits: [] as any[],
    capabilities: [] as any[],
    ...overrides,
  };
}

class FakeWarehouseRepository {
  constructor(private readonly wh: any) {}
  findByPublicId = jest.fn(async (id: string) => (id === this.wh.publicId ? this.wh : null));
  findByPublicIdWithCapacity = jest.fn(async (id: string) => (id === this.wh.publicId ? this.wh : null));
}

function fakeReferenceData(crop = { id: "crop-1", name: "Onion" }) {
  return { getActiveCropOrThrow: jest.fn(async () => crop) } as any;
}

function fakeAvailability(dto: any) {
  return { getStorageAvailability: jest.fn(async () => dto) } as any;
}

function fakeSuitability(status: "SUITABLE" | "CONDITIONALLY_SUITABLE" | "UNSUITABLE" | "UNKNOWN") {
  return {
    getSuitability: jest.fn(async () => ({
      warehouse: {},
      crop: { id: "crop-1", name: "Onion" },
      suitability: { status, confidence: status === "UNKNOWN" ? null : 1, explanationCodes: [] },
    })),
  } as any;
}

function baseAvailabilityDto(overrides: Record<string, unknown> = {}) {
  return {
    warehouse: {},
    capacity: { status: "AVAILABLE", totalKg: 1000, availableKg: 1000, utilizationPercent: 0, storageUnitCount: 1 },
    requestedCrop: { id: "crop-1", name: "Onion" },
    compatibility: "SUPPORTED",
    requestedQuantity: null,
    canAccommodate: null,
    ...overrides,
  };
}

describe("WarehouseSuitabilityAnalysisService.analyzeSuitability", () => {
  it("is SUITABLE when every underlying part reports a clean result", async () => {
    const wh = warehouseRow();
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    const result = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor());
    expect(result.suitability).toBe("SUITABLE");
    expect(result.blockingIssues).toEqual([]);
  });

  it("is UNSUITABLE when Part 2 reports the crop as explicitly unsupported", async () => {
    const wh = warehouseRow();
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto({ compatibility: "UNSUPPORTED" })),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    const result = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor());
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.cropCompatibility).toBe("UNSUPPORTED");
  });

  it("is UNSUITABLE when the warehouse is operationally unavailable, even if everything else is fine", async () => {
    const wh = warehouseRow({ status: "SUSPENDED" });
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    // An ADMIN actor so visibility passes despite SUSPENDED status.
    const result = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor({ role: "ADMIN" }));
    expect(result.suitability).toBe("UNSUITABLE");
    expect(result.operationalStatus).toBe("UNAVAILABLE");
  });

  it("is UNKNOWN when Part 3's environmental suitability is UNKNOWN, never silently SUITABLE", async () => {
    const wh = warehouseRow();
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("UNKNOWN"),
      fakeReferenceData(),
    );

    const result = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor());
    expect(result.suitability).toBe("UNKNOWN");
    expect(result.suitabilityScore).toBeNull();
    expect(result.confidence).toBeNull();
  });

  it("rejects a non-positive requested duration before touching any repository", async () => {
    const wh = warehouseRow();
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    await expect(service.analyzeSuitability(wh.publicId, { cropId: "crop-1", durationDays: 0 }, actor())).rejects.toMatchObject({
      code: "INVALID_DURATION",
    });
  });

  it("computes duration compatibility from the resolved WarehouseCropCapability row and flags EXCEEDS_MAXIMUM", async () => {
    const wh = warehouseRow({
      capabilities: [{ storageUnitId: null, compatibility: "COMPATIBLE", maxStorageDurationDays: 10, crop: { id: "crop-1" } }],
    });
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    const result = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1", durationDays: 20 }, actor());
    expect(result.durationCompatibility).toBe("EXCEEDS_MAXIMUM");
    expect(result.suitability).toBe("UNSUITABLE");
  });

  it("is deterministic: repeated calls with unchanged inputs return the same suitability/score/confidence", async () => {
    const wh = warehouseRow();
    const service = new WarehouseSuitabilityAnalysisService(
      new FakeWarehouseRepository(wh) as any,
      fakeAvailability(baseAvailabilityDto()),
      fakeSuitability("SUITABLE"),
      fakeReferenceData(),
    );

    const r1 = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor());
    const r2 = await service.analyzeSuitability(wh.publicId, { cropId: "crop-1" }, actor());
    expect(r1.suitability).toBe(r2.suitability);
    expect(r1.suitabilityScore).toBe(r2.suitabilityScore);
    expect(r1.confidence).toBe(r2.confidence);
  });
});
