import { WarehouseSuitabilityService } from "../../src/modules/warehouse-intelligence/warehouse-suitability.service";

// ---------------------------------------------------------------------------
// Minimal in-memory fakes — mirrors this codebase's existing convention of
// injecting fakes rather than a live Prisma client for unit tests (see
// AppDependencies' own comment in app.ts on why repositories are
// constructor-injected).
// ---------------------------------------------------------------------------

function actor(overrides: Partial<{ id: string; role: string }> = {}) {
  return { id: "user-1", role: "FARMER", ...overrides } as any;
}

function warehouse(overrides: Record<string, unknown> = {}) {
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

function unit(overrides: Record<string, unknown> = {}) {
  return {
    id: "unit-1",
    publicId: "unit-1",
    warehouseId: "wh-1",
    code: "A",
    storageType: "AMBIENT",
    totalCapacity: 1000 as any,
    availableCapacity: 1000 as any,
    capacityUnit: "KG",
    temperatureControlled: false,
    minTemperature: null,
    maxTemperature: null,
    humidityControlled: false,
    minHumidity: null,
    maxHumidity: null,
    ventilationAvailable: null,
    coldStorageAvailable: null,
    controlledAtmosphereAvailable: null,
    pestControlAvailable: null,
    moistureControlAvailable: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function requirementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    cropId: "crop-1",
    preferredTemperatureMin: null,
    preferredTemperatureMax: null,
    preferredHumidityMin: null,
    preferredHumidityMax: null,
    requiresVentilation: null,
    requiresColdStorage: null,
    requiresControlledAtmosphere: null,
    requiresPestControl: null,
    requiresMoistureControl: null,
    compatibleStorageTypes: [] as string[],
    maximumRecommendedStorageDays: null,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

class FakeWarehouseRepository {
  constructor(private readonly wh: any) {}
  findByPublicId = jest.fn(async (id: string) => (id === this.wh.publicId ? this.wh : null));
  findByPublicIdWithCapacity = jest.fn(async (id: string) => (id === this.wh.publicId ? this.wh : null));
  findNearbyCandidates = jest.fn(async () => []);
  list = jest.fn(async () => ({ items: [], total: 0 }));
  create = jest.fn();
  update = jest.fn();
}

class FakeStorageRepository {
  update = jest.fn(async (_id: string, patch: any) => ({ ...unit(), ...patch }));
  findByPublicId = jest.fn();
  listByWarehouse = jest.fn(async () => []);
  create = jest.fn();
}

class FakeCropRequirementRepository {
  constructor(private readonly row: any | null) {}
  findByCropId = jest.fn(async () => this.row);
  findByCropIds = jest.fn(async () => (this.row ? [this.row] : []));
  upsert = jest.fn(async (data: any) => ({ ...requirementRow(), ...data }));
}

function fakeReferenceData(crop = { id: "crop-1", name: "Onion" }) {
  return { getActiveCropOrThrow: jest.fn(async () => crop) } as any;
}

function fakeAudit() {
  return { record: jest.fn(async () => undefined) };
}

function fakeAvailabilityService(dto: any) {
  return { getStorageAvailability: jest.fn(async () => dto) } as any;
}

describe("WarehouseSuitabilityService.getSuitability", () => {
  it("returns UNKNOWN with INSUFFICIENT_CROP_STORAGE_REQUIREMENTS when the crop has no configured requirement row", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: true })] });
    const service = new WarehouseSuitabilityService(
      new FakeWarehouseRepository(wh) as any,
      new FakeStorageRepository() as any,
      new FakeCropRequirementRepository(null) as any,
      fakeReferenceData(),
      fakeAvailabilityService({}),
      fakeAudit() as any,
    );

    const result = await service.getSuitability(wh.publicId, "crop-1", actor());
    expect(result.suitability.status).toBe("UNKNOWN");
    expect(result.suitability.explanationCodes).toContain("INSUFFICIENT_CROP_STORAGE_REQUIREMENTS");
    expect(result.suitability.evaluatedStorageUnit).toBeNull();
  });

  it("returns UNKNOWN with INSUFFICIENT_WAREHOUSE_CONDITION_DATA when there are no active storage units", async () => {
    const wh = warehouse({ storageUnits: [] });
    const service = new WarehouseSuitabilityService(
      new FakeWarehouseRepository(wh) as any,
      new FakeStorageRepository() as any,
      new FakeCropRequirementRepository(requirementRow({ requiresColdStorage: true })) as any,
      fakeReferenceData(),
      fakeAvailabilityService({}),
      fakeAudit() as any,
    );

    const result = await service.getSuitability(wh.publicId, "crop-1", actor());
    expect(result.suitability.status).toBe("UNKNOWN");
    expect(result.suitability.explanationCodes).toContain("INSUFFICIENT_WAREHOUSE_CONDITION_DATA");
    expect(result.suitability.evaluatedStorageUnitCount).toBe(0);
  });

  it("picks the best (SUITABLE-ranked) storage unit across several, and reports how many were compared", async () => {
    const wh = warehouse({
      storageUnits: [
        unit({ publicId: "unit-bad", code: "BAD", coldStorageAvailable: false }),
        unit({ publicId: "unit-good", code: "GOOD", coldStorageAvailable: true }),
        unit({ publicId: "unit-inactive", code: "OFF", coldStorageAvailable: true, isActive: false }),
      ],
    });
    const service = new WarehouseSuitabilityService(
      new FakeWarehouseRepository(wh) as any,
      new FakeStorageRepository() as any,
      new FakeCropRequirementRepository(requirementRow({ requiresColdStorage: true })) as any,
      fakeReferenceData(),
      fakeAvailabilityService({}),
      fakeAudit() as any,
    );

    const result = await service.getSuitability(wh.publicId, "crop-1", actor());
    expect(result.suitability.status).toBe("SUITABLE");
    expect(result.suitability.evaluatedStorageUnit).toEqual({ publicId: "unit-good", code: "GOOD" });
    // Only the two active units were ever compared — the inactive one is excluded.
    expect(result.suitability.evaluatedStorageUnitCount).toBe(2);
  });

  it("404s for a warehouse the actor cannot see, matching Part 2's not-found-for-unauthorized convention", async () => {
    const wh = warehouse({ status: "SUSPENDED", isActive: false, ownerUserId: "someone-else" });
    const service = new WarehouseSuitabilityService(
      new FakeWarehouseRepository(wh) as any,
      new FakeStorageRepository() as any,
      new FakeCropRequirementRepository(requirementRow()) as any,
      fakeReferenceData(),
      fakeAvailabilityService({}),
      fakeAudit() as any,
    );

    await expect(service.getSuitability(wh.publicId, "crop-1", actor({ id: "outsider" }))).rejects.toMatchObject({
      code: "WAREHOUSE_NOT_FOUND",
    });
  });
});

describe("WarehouseSuitabilityService.getStorageEligibility — overallEligibility composition", () => {
  function buildService(wh: any, reqRow: any, availabilityDto: any) {
    return new WarehouseSuitabilityService(
      new FakeWarehouseRepository(wh) as any,
      new FakeStorageRepository() as any,
      new FakeCropRequirementRepository(reqRow) as any,
      fakeReferenceData(),
      fakeAvailabilityService(availabilityDto),
      fakeAudit() as any,
    );
  }

  it("is UNSUITABLE when suitability is UNSUITABLE, even if capacity would otherwise be sufficient", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: false })] });
    const service = buildService(wh, requirementRow({ requiresColdStorage: true }), {
      warehouse: {},
      capacity: { status: "AVAILABLE", availableKg: 1000, totalKg: 1000, utilizationPercent: 0, storageUnitCount: 1 },
      requestedQuantity: { value: 100, unit: "KG" },
      canAccommodate: true,
    });

    const result = await service.getStorageEligibility(wh.publicId, { cropId: "crop-1", quantity: 100, unit: "KG" as any }, actor());
    expect(result.overallEligibility).toBe("UNSUITABLE");
  });

  it("is INSUFFICIENT_CAPACITY when suitability is fine but the requested quantity doesn't fit", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: true })] });
    const service = buildService(wh, requirementRow({ requiresColdStorage: true }), {
      warehouse: {},
      capacity: { status: "FULL", availableKg: 0, totalKg: 1000, utilizationPercent: 100, storageUnitCount: 1 },
      requestedQuantity: { value: 100, unit: "KG" },
      canAccommodate: false,
    });

    const result = await service.getStorageEligibility(wh.publicId, { cropId: "crop-1", quantity: 100, unit: "KG" as any }, actor());
    expect(result.overallEligibility).toBe("INSUFFICIENT_CAPACITY");
  });

  it("is UNKNOWN when suitability is UNKNOWN even though capacity is known-sufficient", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: null })] });
    const service = buildService(wh, requirementRow({ requiresColdStorage: true }), {
      warehouse: {},
      capacity: { status: "AVAILABLE", availableKg: 1000, totalKg: 1000, utilizationPercent: 0, storageUnitCount: 1 },
      requestedQuantity: { value: 100, unit: "KG" },
      canAccommodate: true,
    });

    const result = await service.getStorageEligibility(wh.publicId, { cropId: "crop-1", quantity: 100, unit: "KG" as any }, actor());
    expect(result.overallEligibility).toBe("UNKNOWN");
  });

  it("is ELIGIBLE when suitability is SUITABLE and capacity can accommodate the request", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: true })] });
    const service = buildService(wh, requirementRow({ requiresColdStorage: true }), {
      warehouse: {},
      capacity: { status: "AVAILABLE", availableKg: 1000, totalKg: 1000, utilizationPercent: 0, storageUnitCount: 1 },
      requestedQuantity: { value: 100, unit: "KG" },
      canAccommodate: true,
    });

    const result = await service.getStorageEligibility(wh.publicId, { cropId: "crop-1", quantity: 100, unit: "KG" as any }, actor());
    expect(result.overallEligibility).toBe("ELIGIBLE");
  });

  it("treats UNAVAILABLE capacity as blocking even with no explicit quantity requested", async () => {
    const wh = warehouse({ storageUnits: [unit({ coldStorageAvailable: true })] });
    const service = buildService(wh, requirementRow({ requiresColdStorage: true }), {
      warehouse: {},
      capacity: { status: "UNAVAILABLE", availableKg: null, totalKg: null, utilizationPercent: null, storageUnitCount: 0 },
      requestedQuantity: null,
      canAccommodate: null,
    });

    const result = await service.getStorageEligibility(wh.publicId, { cropId: "crop-1" }, actor());
    expect(result.overallEligibility).toBe("INSUFFICIENT_CAPACITY");
  });
});
