// Same rationale as price-forecasting.repository.test.ts: the generated
// Prisma client (in particular Prisma.Decimal) isn't available in this
// sandbox (see prisma/README-engines.md), so this stand-in lets the real
// Decimal-conversion code in warehouse.types.ts run under test without the
// live-generated engine.
jest.mock("@prisma/client", () => {
  const actual = jest.requireActual("@prisma/client");
  class FakeDecimal {
    private readonly value: number;
    constructor(v: number | string) {
      this.value = Number(v);
    }
    toString() {
      return String(this.value);
    }
    valueOf() {
      return this.value;
    }
  }
  return { ...actual, Prisma: { ...actual.Prisma, Decimal: FakeDecimal } };
});

import { PrismaClient } from "@prisma/client";
import { PrismaWarehouseRepository } from "../../src/modules/warehouse-intelligence/warehouse.repository";
import { PrismaWarehouseStorageRepository } from "../../src/modules/warehouse-intelligence/warehouse-storage.repository";
import { PrismaWarehouseCapabilityRepository } from "../../src/modules/warehouse-intelligence/warehouse-capability.repository";
import { PrismaStorageReservationRepository } from "../../src/modules/warehouse-intelligence/storage-reservation.repository";
import { PrismaStorageRateRepository } from "../../src/modules/warehouse-intelligence/storage-rate.repository";
import {
  toWarehouseDTO,
  toWarehouseStorageUnitDTO,
  toWarehouseCapability,
  toStorageReservationRecord,
  toStorageRateDefinition,
} from "../../src/modules/warehouse-intelligence/warehouse.types";

function makeWarehouseRow(overrides: Partial<Record<string, unknown>> = {}) {
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
    latitude: null,
    longitude: null,
    verificationStatus: "PENDING" as const,
    status: "ACTIVE" as const,
    isActive: true,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ...overrides,
  };
}

describe("PrismaWarehouseRepository (Module 9 Part 1)", () => {
  let prismaMock: any;
  let repository: PrismaWarehouseRepository;

  beforeEach(() => {
    prismaMock = {
      warehouse: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    repository = new PrismaWarehouseRepository(prismaMock as unknown as PrismaClient);
  });

  it("findByPublicId looks up by the public identifier, not the internal id", async () => {
    const row = makeWarehouseRow();
    prismaMock.warehouse.findUnique.mockResolvedValue(row);

    const result = await repository.findByPublicId("public-wh-1");

    expect(prismaMock.warehouse.findUnique).toHaveBeenCalledWith({ where: { publicId: "public-wh-1" } });
    expect(result).toEqual(row);
  });

  it("create seeds ownerUserId/ownerFpoId from the caller, never trusting a partial payload silently", async () => {
    const row = makeWarehouseRow();
    prismaMock.warehouse.create.mockResolvedValue(row);

    await repository.create({
      ownerType: "FPO",
      ownerFpoId: "fpo-1",
      name: "Nashik Cold Store",
      warehouseType: "COLD_STORAGE",
      state: "Maharashtra",
      district: "Nashik",
    });

    expect(prismaMock.warehouse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerType: "FPO",
          ownerUserId: null,
          ownerFpoId: "fpo-1",
        }),
      }),
    );
  });

  it("list clamps page/limit to sane bounds (bounded pagination)", async () => {
    prismaMock.warehouse.findMany.mockResolvedValue([]);
    prismaMock.warehouse.count.mockResolvedValue(0);

    await repository.list({}, 0, 10_000);

    expect(prismaMock.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 100 }),
    );
  });

  it("list applies filters as an AND-composed where clause", async () => {
    prismaMock.warehouse.findMany.mockResolvedValue([]);
    prismaMock.warehouse.count.mockResolvedValue(0);

    await repository.list({ state: "Maharashtra", status: "ACTIVE" }, 1, 20);

    expect(prismaMock.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { state: "Maharashtra", status: "ACTIVE" } }),
    );
  });

  it("toWarehouseDTO maps ownership and never leaks the raw Prisma row shape", () => {
    const dto = toWarehouseDTO(makeWarehouseRow() as any);
    expect(dto).toEqual(
      expect.objectContaining({
        publicId: "public-wh-1",
        ownerType: "FPO",
        owner: { userId: null, fpoId: "fpo-1" },
        status: "ACTIVE",
      }),
    );
    expect((dto as any).id).toBeUndefined();
  });
});

describe("PrismaWarehouseStorageRepository (Module 9 Part 1)", () => {
  let prismaMock: any;
  let repository: PrismaWarehouseStorageRepository;

  beforeEach(() => {
    prismaMock = {
      warehouseStorageUnit: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    repository = new PrismaWarehouseStorageRepository(prismaMock as unknown as PrismaClient);
  });

  const baseRow = {
    id: "unit-1",
    publicId: "public-unit-1",
    warehouseId: "wh-1",
    code: "Chamber A",
    storageType: "COLD_STORAGE" as const,
    totalCapacity: 5000,
    availableCapacity: 5000,
    capacityUnit: "KG" as const,
    temperatureControlled: true,
    minTemperature: 2,
    maxTemperature: 6,
    humidityControlled: false,
    minHumidity: null,
    maxHumidity: null,
    isActive: true,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
  };

  it("create defaults availableCapacity to totalCapacity when not given", async () => {
    prismaMock.warehouseStorageUnit.create.mockResolvedValue(baseRow);

    await repository.create({
      warehouseId: "wh-1",
      code: "Chamber A",
      storageType: "COLD_STORAGE",
      totalCapacity: 5000,
    });

    expect(prismaMock.warehouseStorageUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalCapacity: 5000, availableCapacity: 5000 }),
      }),
    );
  });

  it("listByWarehouse scopes strictly to the given warehouse", async () => {
    prismaMock.warehouseStorageUnit.findMany.mockResolvedValue([baseRow]);

    await repository.listByWarehouse("wh-1");

    expect(prismaMock.warehouseStorageUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { warehouseId: "wh-1" } }),
    );
  });

  it("toWarehouseStorageUnitDTO converts Decimal capacity fields to numbers", () => {
    const dto = toWarehouseStorageUnitDTO(baseRow as any);
    expect(dto.capacity).toEqual({ total: 5000, available: 5000, unit: "KG" });
    expect(dto.conditions.minTemperature).toBe(2);
    expect(dto.conditions.maxHumidity).toBeNull();
  });
});

describe("PrismaWarehouseCapabilityRepository (Module 9 Part 1)", () => {
  let prismaMock: any;
  let repository: PrismaWarehouseCapabilityRepository;

  beforeEach(() => {
    prismaMock = {
      warehouseCropCapability: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repository = new PrismaWarehouseCapabilityRepository(prismaMock as unknown as PrismaClient);
  });

  const cropRow = { id: "crop-1", name: "Onion", category: null, active: true, createdAt: new Date(), updatedAt: new Date() };

  it("add defaults compatibility to COMPATIBLE and never fabricates storage conditions", async () => {
    prismaMock.warehouseCropCapability.create.mockResolvedValue({
      id: "cap-1",
      warehouseId: "wh-1",
      storageUnitId: null,
      cropId: "crop-1",
      compatibility: "COMPATIBLE",
      maxStorageDurationDays: null,
      storageConditions: null,
      estimatedSpoilageRatePercent: null,
      metadata: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      crop: cropRow,
    });

    await repository.add({ warehouseId: "wh-1", cropId: "crop-1" });

    expect(prismaMock.warehouseCropCapability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          compatibility: "COMPATIBLE",
          storageConditions: null,
          estimatedSpoilageRatePercent: null,
        }),
      }),
    );
  });

  it("deactivate flips isActive rather than deleting the row (append-only history)", async () => {
    prismaMock.warehouseCropCapability.update.mockResolvedValue({});

    await repository.deactivate("cap-1");

    expect(prismaMock.warehouseCropCapability.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cap-1" }, data: { isActive: false } }),
    );
  });

  it("findCompatible only matches active, COMPATIBLE rows for the given warehouse+crop", async () => {
    prismaMock.warehouseCropCapability.findMany.mockResolvedValue([]);

    await repository.findCompatible({ warehouseId: "wh-1", cropId: "crop-1" });

    expect(prismaMock.warehouseCropCapability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { warehouseId: "wh-1", cropId: "crop-1", isActive: true, compatibility: "COMPATIBLE" },
      }),
    );
  });

  it("toWarehouseCapability maps the included crop without leaking the raw row", () => {
    const dto = toWarehouseCapability({
      id: "cap-1",
      warehouseId: "wh-1",
      storageUnitId: null,
      cropId: "crop-1",
      compatibility: "COMPATIBLE",
      maxStorageDurationDays: 90,
      storageConditions: "Dry, ventilated",
      estimatedSpoilageRatePercent: 2.5,
      metadata: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      crop: cropRow,
    } as any);

    expect(dto).toEqual({
      crop: { id: "crop-1", name: "Onion" },
      compatibility: "COMPATIBLE",
      storageUnitId: null,
      maxStorageDurationDays: 90,
      storageConditions: "Dry, ventilated",
      estimatedSpoilageRatePercent: 2.5,
      isActive: true,
    });
  });
});

describe("PrismaStorageReservationRepository (Module 9 Part 1)", () => {
  let prismaMock: any;
  let repository: PrismaStorageReservationRepository;

  beforeEach(() => {
    prismaMock = {
      storageReservation: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    repository = new PrismaStorageReservationRepository(prismaMock as unknown as PrismaClient);
  });

  it("create always writes a PENDING reservation — no capacity math attempted here", async () => {
    prismaMock.storageReservation.create.mockResolvedValue({});

    await repository.create({
      warehouseId: "wh-1",
      lotId: "lot-1",
      quantity: 500,
      reservedFrom: new Date("2026-09-10"),
    });

    expect(prismaMock.storageReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", quantity: 500, unit: "KG" }),
      }),
    );
  });

  it("updateStatus is a plain column write, not a guarded transition", async () => {
    prismaMock.storageReservation.update.mockResolvedValue({});

    await repository.updateStatus("res-1", "CONFIRMED");

    expect(prismaMock.storageReservation.update).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: { status: "CONFIRMED" },
    });
  });

  it("listByLot scopes strictly to the given lot", async () => {
    prismaMock.storageReservation.findMany.mockResolvedValue([]);

    await repository.listByLot("lot-1");

    expect(prismaMock.storageReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lotId: "lot-1" } }),
    );
  });

  it("toStorageReservationRecord converts Decimal quantity and dates", () => {
    const dto = toStorageReservationRecord({
      id: "res-1",
      publicId: "public-res-1",
      warehouseId: "wh-1",
      storageUnitId: null,
      lotId: "lot-1",
      quantity: 500,
      unit: "KG",
      status: "PENDING",
      reservedFrom: new Date("2026-09-10"),
      reservedUntil: null,
      createdAt: new Date("2026-09-01"),
      updatedAt: new Date("2026-09-01"),
    } as any);

    expect(dto.quantity).toBe(500);
    expect(dto.reservedFrom).toBe(new Date("2026-09-10").toISOString());
    expect(dto.reservedUntil).toBeNull();
  });
});

describe("PrismaStorageRateRepository (Module 9 Part 1)", () => {
  let prismaMock: any;
  let repository: PrismaStorageRateRepository;

  beforeEach(() => {
    prismaMock = {
      storageRate: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    repository = new PrismaStorageRateRepository(prismaMock as unknown as PrismaClient);
  });

  it("create defaults currency to INR and billingUnit to KG — no cost calculation attempted", async () => {
    prismaMock.storageRate.create.mockResolvedValue({});

    await repository.create({
      warehouseId: "wh-1",
      rateType: "PER_QUANTITY_PER_DAY",
      rateAmount: 2.5,
      effectiveFrom: new Date("2026-09-01"),
    });

    expect(prismaMock.storageRate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currency: "INR", billingUnit: "KG" }),
      }),
    );
  });

  it("findApplicable queries by an effective-date window that is queryable both ways", async () => {
    prismaMock.storageRate.findMany.mockResolvedValue([]);
    const atDate = new Date("2026-09-15");

    await repository.findApplicable("wh-1", atDate);

    expect(prismaMock.storageRate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: "wh-1",
          isActive: true,
          effectiveFrom: { lte: atDate },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: atDate } }],
        }),
      }),
    );
  });

  it("toStorageRateDefinition maps a null crop (warehouse-wide rate) to null, not a fabricated crop", () => {
    const dto = toStorageRateDefinition({
      id: "rate-1",
      publicId: "public-rate-1",
      warehouseId: "wh-1",
      storageUnitId: null,
      cropId: null,
      rateType: "PER_DAY",
      rateAmount: 10,
      currency: "INR",
      billingUnit: "KG",
      effectiveFrom: new Date("2026-09-01"),
      effectiveUntil: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      crop: null,
    } as any);

    expect(dto.crop).toBeNull();
    expect(dto.rateAmount).toBe(10);
  });
});
