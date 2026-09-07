import { WarehouseDuplicateDetectionService } from "../../src/modules/warehouse-intelligence/warehouse-duplicate-detection.service";
import { NormalizedWarehouseRecord } from "../../src/modules/warehouse-intelligence/warehouse-normalization.service";

function record(overrides: Partial<NormalizedWarehouseRecord> = {}): NormalizedWarehouseRecord {
  return {
    externalId: "ext-1",
    source: { providerId: "government-wdra", providerType: "GOVERNMENT" },
    name: "ABC Cold Storage",
    location: { address: null, village: null, district: "Nashik", state: "Maharashtra", pincode: "422001", latitude: 20, longitude: 73.7 },
    contact: { phone: null, email: null },
    capacity: null,
    storageType: null,
    temperatureControlled: null,
    minTemperatureC: null,
    maxTemperatureC: null,
    metadata: undefined,
    sourceUpdatedAt: null,
    warnings: [],
    ...overrides,
  };
}

function makePrisma(findFirstImpl: (args: unknown) => Promise<{ id: string } | null>) {
  return { warehouse: { findFirst: jest.fn(findFirstImpl) } } as any;
}

describe("WarehouseDuplicateDetectionService", () => {
  it("MATCHED on exact coordinates, checked before anything else", async () => {
    const prisma = makePrisma(async (args: any) => (args.where.latitude === 20 ? { id: "wh-coords" } : null));
    const result = await new WarehouseDuplicateDetectionService(prisma).detect(record());
    expect(result).toEqual({ state: "MATCHED", warehouseId: "wh-coords", reason: "EXACT_COORDINATES" });
  });

  it("MATCHED on exact name + state + district when coordinates don't match", async () => {
    const prisma = makePrisma(async (args: any) => {
      if (args.where.latitude !== undefined) return null;
      if (args.where.name) return { id: "wh-name-location" };
      return null;
    });
    const result = await new WarehouseDuplicateDetectionService(prisma).detect(record());
    expect(result).toEqual({ state: "MATCHED", warehouseId: "wh-name-location", reason: "NAME_STATE_DISTRICT" });
  });

  it("POSSIBLE_DUPLICATE (never MATCHED) when only the name matches but location differs", async () => {
    let call = 0;
    const prisma = makePrisma(async () => {
      call += 1;
      // 1st call: coordinates -> no match. 2nd call: name+state+district -> no
      // match. 3rd call: name only -> match.
      return call === 3 ? { id: "wh-name-only" } : null;
    });
    const result = await new WarehouseDuplicateDetectionService(prisma).detect(record());
    expect(result).toEqual({ state: "POSSIBLE_DUPLICATE", warehouseId: "wh-name-only", reason: "NAME_ONLY" });
  });

  it("POSSIBLE_DUPLICATE when only the pincode matches (name/coords don't)", async () => {
    let call = 0;
    const prisma = makePrisma(async () => {
      call += 1;
      return call === 4 ? { id: "wh-pincode" } : null;
    });
    const result = await new WarehouseDuplicateDetectionService(prisma).detect(record());
    expect(result).toEqual({ state: "POSSIBLE_DUPLICATE", warehouseId: "wh-pincode", reason: "PINCODE_ONLY" });
  });

  it("UNMATCHED when nothing lines up — never invents a match", async () => {
    const prisma = makePrisma(async () => null);
    const result = await new WarehouseDuplicateDetectionService(prisma).detect(record());
    expect(result).toEqual({ state: "UNMATCHED", warehouseId: null, reason: "NO_CANDIDATE" });
  });

  it("never queries by coordinates when they are null", async () => {
    const findFirst = jest.fn(async () => null);
    const prisma = { warehouse: { findFirst } } as any;
    await new WarehouseDuplicateDetectionService(prisma).detect(record({ location: { ...record().location, latitude: null, longitude: null } }));
    expect(findFirst.mock.calls.every((call) => call[0].where.latitude === undefined)).toBe(true);
  });
});
