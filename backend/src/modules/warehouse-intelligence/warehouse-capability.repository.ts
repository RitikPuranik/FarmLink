import { CropStorageCompatibility, Prisma, PrismaClient } from "@prisma/client";
import { WarehouseCropCapabilityWithRelations } from "./warehouse.types";

const CAPABILITY_INCLUDE = { crop: true } as const;

export interface AddWarehouseCapabilityData {
  warehouseId: string;
  storageUnitId?: string | null;
  cropId: string;
  compatibility?: CropStorageCompatibility;
  maxStorageDurationDays?: number | null;
  storageConditions?: string | null;
  estimatedSpoilageRatePercent?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface WarehouseCompatibleStorageQuery {
  warehouseId: string;
  cropId: string;
}

/**
 * Data-access boundary for WarehouseCropCapability (Module 9 Part 1) — a
 * configured table, not an inference engine. "add" always creates a new
 * row; deactivation is a soft isActive flip, never a delete, so a future
 * audit trail of what a warehouse used to claim it could store stays
 * intact (same reasoning as QualityAssessment's append-only history).
 */
export interface WarehouseCapabilityRepository {
  add(data: AddWarehouseCapabilityData): Promise<WarehouseCropCapabilityWithRelations>;
  deactivate(id: string): Promise<WarehouseCropCapabilityWithRelations>;
  listByWarehouse(warehouseId: string, activeOnly?: boolean): Promise<WarehouseCropCapabilityWithRelations[]>;
  /** Compatible, active capability rows for a (warehouse, crop) pair —
   * warehouse-wide (storageUnitId null) and unit-scoped rows both
   * included; picking between them is future-part logic. */
  findCompatible(query: WarehouseCompatibleStorageQuery): Promise<WarehouseCropCapabilityWithRelations[]>;
}

export class PrismaWarehouseCapabilityRepository implements WarehouseCapabilityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  add(data: AddWarehouseCapabilityData) {
    return this.prisma.warehouseCropCapability.create({
      data: {
        warehouseId: data.warehouseId,
        storageUnitId: data.storageUnitId ?? null,
        cropId: data.cropId,
        compatibility: data.compatibility ?? "COMPATIBLE",
        maxStorageDurationDays: data.maxStorageDurationDays ?? null,
        storageConditions: data.storageConditions ?? null,
        estimatedSpoilageRatePercent: data.estimatedSpoilageRatePercent ?? null,
        metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      include: CAPABILITY_INCLUDE,
    });
  }

  deactivate(id: string) {
    return this.prisma.warehouseCropCapability.update({
      where: { id },
      data: { isActive: false },
      include: CAPABILITY_INCLUDE,
    });
  }

  listByWarehouse(warehouseId: string, activeOnly = true) {
    return this.prisma.warehouseCropCapability.findMany({
      where: { warehouseId, ...(activeOnly ? { isActive: true } : {}) },
      include: CAPABILITY_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
  }

  findCompatible(query: WarehouseCompatibleStorageQuery) {
    return this.prisma.warehouseCropCapability.findMany({
      where: {
        warehouseId: query.warehouseId,
        cropId: query.cropId,
        isActive: true,
        compatibility: "COMPATIBLE",
      },
      include: CAPABILITY_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
  }
}
