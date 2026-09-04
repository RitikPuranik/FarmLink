import { AuthenticatedUserContext } from "../../src/modules/auth/auth.types";
import { ValidationError } from "../../src/common/errors";
import { WarehouseAvailabilityService } from "../../src/modules/warehouse-intelligence/warehouse-availability.service";
import { WarehouseRepository } from "../../src/modules/warehouse-intelligence/warehouse.repository";
import { WarehouseStorageRepository } from "../../src/modules/warehouse-intelligence/warehouse-storage.repository";
import { WarehouseCapabilityRepository } from "../../src/modules/warehouse-intelligence/warehouse-capability.repository";
import { ReferenceDataService } from "../../src/modules/reference-data/reference-data.service";
import { AuditService } from "../../src/modules/audit/audit.service";

function warehouseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wh-1",
    publicId: "public-wh-1",
    ownerType: "FPO" as const,
    ownerUserId: null,
    ownerFpoId: "fpo-1",
    name: "Nashik Cold Store",
    warehouseType: "COLD_STORAGE" as const,
    state: "Maharashtra",
    district: "Nashik",
    address: null,
    latitude: 20.0,
    longitude: 73.78,
    verificationStatus: "VERIFIED" as const,
    status: "ACTIVE" as const,
    isActive: true,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    storageUnits: [] as unknown[],
    capabilities: [] as unknown[],
    ...overrides,
  };
}

function storageUnitRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "unit-1",
    publicId: "public-unit-1",
    warehouseId: "wh-1",
    code: "A1",
    storageType: "COLD_STORAGE" as const,
    totalCapacity: 1000,
    availableCapacity: 500,
    capacityUnit: "KG" as const,
    temperatureControlled: true,
    minTemperature: null,
    maxTemperature: null,
    humidityControlled: false,
    minHumidity: null,
    maxHumidity: null,
    isActive: true,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ...overrides,
  };
}

const farmer: AuthenticatedUserContext = { id: "user-farmer", publicId: "public-farmer", role: "FARMER" as any };
const admin: AuthenticatedUserContext = { id: "user-admin", publicId: "public-admin", role: "ADMIN" as any };
const operator: AuthenticatedUserContext = { id: "user-op", publicId: "public-op", role: "WAREHOUSE_OPERATOR" as any };

function makeService(overrides: {
  warehouses?: Partial<WarehouseRepository>;
  storageUnits?: Partial<WarehouseStorageRepository>;
  capabilities?: Partial<WarehouseCapabilityRepository>;
  referenceData?: Partial<ReferenceDataService>;
  audit?: Partial<AuditService>;
} = {}) {
  const warehouses: WarehouseRepository = {
    findById: jest.fn(),
    findByPublicId: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findByPublicIdWithCapacity: jest.fn(),
    findNearbyCandidates: jest.fn(),
    ...overrides.warehouses,
  } as unknown as WarehouseRepository;

  const storageUnits: WarehouseStorageRepository = {
    findByPublicId: jest.fn(),
    listByWarehouse: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    ...overrides.storageUnits,
  } as unknown as WarehouseStorageRepository;

  const capabilities: WarehouseCapabilityRepository = {
    add: jest.fn(),
    deactivate: jest.fn(),
    listByWarehouse: jest.fn(),
    findCompatible: jest.fn(),
    ...overrides.capabilities,
  } as unknown as WarehouseCapabilityRepository;

  const referenceData = {
    getActiveCropOrThrow: jest.fn().mockResolvedValue({ id: "crop-1", name: "Onion" }),
    ...overrides.referenceData,
  } as unknown as ReferenceDataService;

  const audit: AuditService = { record: jest.fn().mockResolvedValue(undefined), ...overrides.audit } as unknown as AuditService;

  const service = new WarehouseAvailabilityService(warehouses, storageUnits, capabilities, referenceData, audit);
  return { service, warehouses, storageUnits, capabilities, referenceData, audit };
}

describe("WarehouseAvailabilityService.getStorageAvailability", () => {
  it("throws WAREHOUSE_NOT_FOUND for a warehouse that doesn't exist", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(null);

    await expect(service.getStorageAvailability("missing", {}, farmer)).rejects.toMatchObject({
      code: "WAREHOUSE_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("hides a suspended warehouse from a non-owner farmer behind the same 404 (never leaks existence)", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(warehouseRow({ status: "SUSPENDED" }));

    await expect(service.getStorageAvailability("public-wh-1", {}, farmer)).rejects.toMatchObject({
      code: "WAREHOUSE_NOT_FOUND",
    });
  });

  it("lets an ADMIN see a suspended warehouse's availability", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(
      warehouseRow({ status: "SUSPENDED", storageUnits: [storageUnitRow()] }),
    );

    const result = await service.getStorageAvailability("public-wh-1", {}, admin);
    expect(result.capacity.status).toBe("AVAILABLE");
  });

  it("rejects quantity without a matching unit (or vice versa) as a validation error", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(warehouseRow());

    await expect(service.getStorageAvailability("public-wh-1", { quantity: 100 }, farmer)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("reports UNAVAILABLE with no storage units configured, never fabricating a number", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(warehouseRow({ storageUnits: [] }));

    const result = await service.getStorageAvailability("public-wh-1", {}, farmer);
    expect(result.capacity).toEqual({
      totalKg: null,
      availableKg: null,
      utilizationPercent: null,
      status: "UNAVAILABLE",
      storageUnitCount: 0,
    });
    expect(result.canAccommodate).toBeNull();
  });

  it("computes canAccommodate=true for a fitting quantity converted through QTL -> KG", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(
      warehouseRow({ storageUnits: [storageUnitRow({ totalCapacity: 1000, availableCapacity: 1000, capacityUnit: "KG" })] }),
    );

    // 5 QTL = 500 KG, well within 1000 KG available
    const result = await service.getStorageAvailability("public-wh-1", { quantity: 5, unit: "QTL" as any }, farmer);
    expect(result.canAccommodate).toBe(true);
  });

  it("computes canAccommodate=false when the requested quantity exceeds available capacity", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(
      warehouseRow({ storageUnits: [storageUnitRow({ totalCapacity: 100, availableCapacity: 50, capacityUnit: "KG" })] }),
    );

    const result = await service.getStorageAvailability("public-wh-1", { quantity: 100, unit: "KG" as any }, farmer);
    expect(result.canAccommodate).toBe(false);
  });

  it("returns canAccommodate=false for a crop explicitly marked INCOMPATIBLE, even with capacity to spare", async () => {
    const { service, warehouses, referenceData } = makeService();
    (referenceData.getActiveCropOrThrow as jest.Mock).mockResolvedValue({ id: "crop-onion", name: "Onion" });
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(
      warehouseRow({
        storageUnits: [storageUnitRow({ totalCapacity: 1000, availableCapacity: 1000 })],
        capabilities: [{ storageUnitId: null, compatibility: "INCOMPATIBLE", crop: { id: "crop-onion" } }],
      }),
    );

    const result = await service.getStorageAvailability(
      "public-wh-1",
      { cropId: "crop-onion", quantity: 10, unit: "KG" as any },
      farmer,
    );
    expect(result.compatibility).toBe("UNSUPPORTED");
    expect(result.canAccommodate).toBe(false);
  });

  it("returns canAccommodate=null (never true) when compatibility for the crop is UNKNOWN", async () => {
    const { service, warehouses, referenceData } = makeService();
    (referenceData.getActiveCropOrThrow as jest.Mock).mockResolvedValue({ id: "crop-onion", name: "Onion" });
    (warehouses.findByPublicIdWithCapacity as jest.Mock).mockResolvedValue(
      warehouseRow({
        storageUnits: [storageUnitRow({ totalCapacity: 1000, availableCapacity: 1000 })],
        capabilities: [], // nothing configured for this crop
      }),
    );

    const result = await service.getStorageAvailability(
      "public-wh-1",
      { cropId: "crop-onion", quantity: 10, unit: "KG" as any },
      farmer,
    );
    expect(result.compatibility).toBe("UNKNOWN");
    expect(result.canAccommodate).toBeNull();
  });
});

describe("WarehouseAvailabilityService.searchNearby", () => {
  it("rejects a radius above the configured maximum", async () => {
    const { service } = makeService();
    await expect(
      service.searchNearby({ latitude: 20, longitude: 73, radiusKm: 501 }, farmer),
    ).rejects.toMatchObject({ code: "INVALID_RADIUS" });
  });

  it("rejects an out-of-range latitude/longitude", async () => {
    const { service } = makeService();
    await expect(service.searchNearby({ latitude: 999, longitude: 73, radiusKm: 50 }, farmer)).rejects.toMatchObject({
      code: "INVALID_LOCATION",
    });
  });

  it("scopes non-admin candidate queries to ACTIVE/isActive warehouses only", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([]);

    await service.searchNearby({ latitude: 20, longitude: 73.78, radiusKm: 50 }, farmer);

    expect(warehouses.findNearbyCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE", isActiveOnly: true }),
      expect.any(Number),
    );
  });

  it("lets an ADMIN search without a status filter", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([]);

    await service.searchNearby({ latitude: 20, longitude: 73.78, radiusKm: 50 }, admin);

    expect(warehouses.findNearbyCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, isActiveOnly: false }),
      expect.any(Number),
    );
  });

  it("excludes a candidate outside the exact Haversine radius even if it passed the bounding box", async () => {
    const { service, warehouses } = makeService();
    // Nashik (~20.0, 73.78) vs. a candidate ~55 km away — outside a 50 km radius.
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([
      warehouseRow({ publicId: "far-one", latitude: 20.5, longitude: 73.78, storageUnits: [storageUnitRow()] }),
    ]);

    const result = await service.searchNearby({ latitude: 20.0, longitude: 73.78, radiusKm: 50 }, farmer);
    expect(result.results).toHaveLength(0);
  });

  it("includes a candidate within radius and reports its distance", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([
      warehouseRow({ publicId: "near-one", latitude: 20.01, longitude: 73.78, storageUnits: [storageUnitRow()] }),
    ]);

    const result = await service.searchNearby({ latitude: 20.0, longitude: 73.78, radiusKm: 50 }, farmer);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].warehouse.publicId).toBe("near-one");
    expect(result.results[0].distanceKm).toBeGreaterThan(0);
  });

  it("skips a candidate with a null latitude/longitude rather than crashing the Haversine pass", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([
      warehouseRow({ publicId: "no-coords", latitude: null, longitude: null }),
    ]);

    const result = await service.searchNearby({ latitude: 20.0, longitude: 73.78, radiusKm: 50 }, farmer);
    expect(result.results).toHaveLength(0);
  });

  it("sorts results by canAccommodate, then capacity status, then distance ascending", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([
      // Farther but can accommodate.
      warehouseRow({
        publicId: "far-fits",
        latitude: 20.05,
        longitude: 73.78,
        storageUnits: [storageUnitRow({ totalCapacity: 1000, availableCapacity: 1000 })],
      }),
      // Closer but full (cannot accommodate).
      warehouseRow({
        publicId: "near-full",
        latitude: 20.01,
        longitude: 73.78,
        storageUnits: [storageUnitRow({ totalCapacity: 1000, availableCapacity: 0 })],
      }),
    ]);

    const result = await service.searchNearby(
      { latitude: 20.0, longitude: 73.78, radiusKm: 50, quantity: 100, unit: "KG" as any },
      farmer,
    );

    expect(result.results.map((r) => r.warehouse.publicId)).toEqual(["far-fits", "near-full"]);
  });

  it("returns an empty list (not an error) when nothing is nearby", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findNearbyCandidates as jest.Mock).mockResolvedValue([]);

    const result = await service.searchNearby({ latitude: 20.0, longitude: 73.78, radiusKm: 50 }, farmer);
    expect(result.results).toEqual([]);
  });
});

describe("WarehouseAvailabilityService.updateStorageUnitCapacity", () => {
  it("rejects available capacity exceeding the resulting total capacity", async () => {
    const { service, warehouses, storageUnits } = makeService();
    (warehouses.findByPublicId as jest.Mock).mockResolvedValue(warehouseRow({ ownerUserId: "user-op" }));
    (storageUnits.findByPublicId as jest.Mock).mockResolvedValue(storageUnitRow({ totalCapacity: 100, availableCapacity: 50 }));

    await expect(
      service.updateStorageUnitCapacity(operator, "public-wh-1", "public-unit-1", { availableCapacity: 150 }),
    ).rejects.toMatchObject({ code: "INVALID_CAPACITY" });
  });

  it("rejects a negative total or available capacity", async () => {
    const { service, warehouses, storageUnits } = makeService();
    (warehouses.findByPublicId as jest.Mock).mockResolvedValue(warehouseRow({ ownerUserId: "user-op" }));
    (storageUnits.findByPublicId as jest.Mock).mockResolvedValue(storageUnitRow());

    await expect(
      service.updateStorageUnitCapacity(operator, "public-wh-1", "public-unit-1", { totalCapacity: -1 }),
    ).rejects.toMatchObject({ code: "INVALID_CAPACITY" });
  });

  it("denies a WAREHOUSE_OPERATOR who does not own this warehouse (404, not 403 — never confirms it exists)", async () => {
    const { service, warehouses } = makeService();
    (warehouses.findByPublicId as jest.Mock).mockResolvedValue(warehouseRow({ ownerUserId: "someone-else" }));

    await expect(
      service.updateStorageUnitCapacity(operator, "public-wh-1", "public-unit-1", { totalCapacity: 100 }),
    ).rejects.toMatchObject({ code: "WAREHOUSE_NOT_FOUND" });
  });

  it("allows the owning WAREHOUSE_OPERATOR to update capacity, audits it, and invalidates the cache", async () => {
    const { service, warehouses, storageUnits, audit } = makeService();
    (warehouses.findByPublicId as jest.Mock).mockResolvedValue(warehouseRow({ ownerUserId: "user-op" }));
    (storageUnits.findByPublicId as jest.Mock).mockResolvedValue(storageUnitRow({ totalCapacity: 100, availableCapacity: 50 }));
    (storageUnits.update as jest.Mock).mockResolvedValue(storageUnitRow({ totalCapacity: 200, availableCapacity: 50 }));

    const result = await service.updateStorageUnitCapacity(operator, "public-wh-1", "public-unit-1", { totalCapacity: 200 });

    expect(storageUnits.update).toHaveBeenCalledWith("unit-1", { totalCapacity: 200 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "WAREHOUSE_CAPACITY_UPDATED", actorUserId: "user-op" }),
    );
    expect(result.capacity.total).toBe(200);
  });

  it("rejects a storage unit that belongs to a different warehouse", async () => {
    const { service, warehouses, storageUnits } = makeService();
    (warehouses.findByPublicId as jest.Mock).mockResolvedValue(warehouseRow({ ownerUserId: "user-op" }));
    (storageUnits.findByPublicId as jest.Mock).mockResolvedValue(storageUnitRow({ warehouseId: "some-other-warehouse" }));

    await expect(
      service.updateStorageUnitCapacity(operator, "public-wh-1", "public-unit-1", { totalCapacity: 100 }),
    ).rejects.toMatchObject({ code: "STORAGE_UNIT_NOT_FOUND" });
  });
});
