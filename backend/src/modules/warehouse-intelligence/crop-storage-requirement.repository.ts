import { CropStorageRequirement, PrismaClient, StorageType } from "@prisma/client";

export interface UpsertCropStorageRequirementData {
  cropId: string;
  preferredTemperatureMin?: number | null;
  preferredTemperatureMax?: number | null;
  preferredHumidityMin?: number | null;
  preferredHumidityMax?: number | null;
  requiresVentilation?: boolean | null;
  requiresColdStorage?: boolean | null;
  requiresControlledAtmosphere?: boolean | null;
  requiresPestControl?: boolean | null;
  requiresMoistureControl?: boolean | null;
  compatibleStorageTypes?: StorageType[];
  maximumRecommendedStorageDays?: number | null;
  notes?: string | null;
}

/**
 * Data-access boundary for CropStorageRequirement (Module 9 Part 3) — a
 * plain configured-data table, no inference, mirroring
 * WarehouseCapabilityRepository's own "add/deactivate/list, never a rules
 * engine" discipline. `findByCropId` returning null is a legitimate,
 * expected outcome (most crops will have no row) — callers must treat
 * that as "requirements not configured", never as an error to retry.
 */
export interface CropStorageRequirementRepository {
  findByCropId(cropId: string): Promise<CropStorageRequirement | null>;
  findByCropIds(cropIds: string[]): Promise<CropStorageRequirement[]>;
  /** Creates the row if none exists for this crop, otherwise updates the
   * existing one in place — this part deliberately keeps one row per
   * crop rather than a version history (see the model's own schema
   * comment), so "configure" is always an upsert, never an append. */
  upsert(data: UpsertCropStorageRequirementData): Promise<CropStorageRequirement>;
}

export class PrismaCropStorageRequirementRepository implements CropStorageRequirementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByCropId(cropId: string) {
    return this.prisma.cropStorageRequirement.findUnique({ where: { cropId } });
  }

  findByCropIds(cropIds: string[]) {
    if (cropIds.length === 0) return Promise.resolve([]);
    return this.prisma.cropStorageRequirement.findMany({ where: { cropId: { in: cropIds } } });
  }

  upsert(data: UpsertCropStorageRequirementData) {
    const shared = {
      preferredTemperatureMin: data.preferredTemperatureMin ?? null,
      preferredTemperatureMax: data.preferredTemperatureMax ?? null,
      preferredHumidityMin: data.preferredHumidityMin ?? null,
      preferredHumidityMax: data.preferredHumidityMax ?? null,
      requiresVentilation: data.requiresVentilation ?? null,
      requiresColdStorage: data.requiresColdStorage ?? null,
      requiresControlledAtmosphere: data.requiresControlledAtmosphere ?? null,
      requiresPestControl: data.requiresPestControl ?? null,
      requiresMoistureControl: data.requiresMoistureControl ?? null,
      compatibleStorageTypes: data.compatibleStorageTypes ?? [],
      maximumRecommendedStorageDays: data.maximumRecommendedStorageDays ?? null,
      notes: data.notes ?? null,
    };

    return this.prisma.cropStorageRequirement.upsert({
      where: { cropId: data.cropId },
      create: { cropId: data.cropId, ...shared },
      update: shared,
    });
  }
}
