import { PrismaClient, QuantityUnit, StorageRateType } from "@prisma/client";
import { StorageRateWithRelations } from "./warehouse.types";

const RATE_INCLUDE = { crop: true } as const;

export interface CreateStorageRateData {
  warehouseId: string;
  storageUnitId?: string | null;
  cropId?: string | null;
  rateType: StorageRateType;
  rateAmount: number;
  currency?: string;
  billingUnit?: QuantityUnit;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
}

/**
 * Data-access boundary for StorageRate (Module 9 Part 1). Stores
 * configured pricing rows only — no cost calculation happens here (that is
 * explicitly future-part logic, see the model's own schema comment).
 */
export interface StorageRateRepository {
  create(data: CreateStorageRateData): Promise<StorageRateWithRelations>;
  listActive(warehouseId: string): Promise<StorageRateWithRelations[]>;
  /** Active rate rows for a warehouse (optionally scoped to a storage
   * unit/crop) whose effective window covers `atDate`. Multiple rows can
   * match (e.g. a warehouse-wide rate and a crop-specific override) —
   * choosing between them is future-part resolution logic, not this
   * repository's job. */
  findApplicable(
    warehouseId: string,
    atDate: Date,
    filters?: { storageUnitId?: string | null; cropId?: string | null },
  ): Promise<StorageRateWithRelations[]>;
}

export class PrismaStorageRateRepository implements StorageRateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateStorageRateData) {
    return this.prisma.storageRate.create({
      data: {
        warehouseId: data.warehouseId,
        storageUnitId: data.storageUnitId ?? null,
        cropId: data.cropId ?? null,
        rateType: data.rateType,
        rateAmount: data.rateAmount,
        currency: data.currency ?? "INR",
        billingUnit: data.billingUnit ?? "KG",
        effectiveFrom: data.effectiveFrom,
        effectiveUntil: data.effectiveUntil ?? null,
      },
      include: RATE_INCLUDE,
    });
  }

  listActive(warehouseId: string) {
    return this.prisma.storageRate.findMany({
      where: { warehouseId, isActive: true },
      include: RATE_INCLUDE,
      orderBy: { effectiveFrom: "desc" },
    });
  }

  findApplicable(
    warehouseId: string,
    atDate: Date,
    filters?: { storageUnitId?: string | null; cropId?: string | null },
  ) {
    return this.prisma.storageRate.findMany({
      where: {
        warehouseId,
        isActive: true,
        effectiveFrom: { lte: atDate },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: atDate } }],
        ...(filters?.storageUnitId !== undefined ? { storageUnitId: filters.storageUnitId } : {}),
        ...(filters?.cropId !== undefined ? { cropId: filters.cropId } : {}),
      },
      include: RATE_INCLUDE,
      orderBy: { effectiveFrom: "desc" },
    });
  }
}
