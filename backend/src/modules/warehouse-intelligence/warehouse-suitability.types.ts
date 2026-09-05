import { CropStorageRequirement } from "@prisma/client";
import { StorageSuitabilityResult } from "./storage-suitability.types";
import { WarehouseAvailabilityDTO, WarehouseDTO } from "./warehouse.types";

// ---------------------------------------------------------------------------
// Module 9 Part 3 — API response shapes composing the pure engine result
// (storage-suitability.types.ts) with warehouse/crop identity and, for the
// eligibility endpoint, Part 2's capacity result. Never a raw Prisma row.
// ---------------------------------------------------------------------------

export interface StorageSuitabilityDTO extends StorageSuitabilityResult {
  /** Which specific storage unit produced this result, or null when no
   * active storage unit exists (status is then always UNKNOWN with
   * INSUFFICIENT_WAREHOUSE_CONDITION_DATA — see the service). */
  evaluatedStorageUnit: { publicId: string; code: string } | null;
  /** How many of the warehouse's active storage units were actually
   * compared — transparency into whether this is "the only option" or
   * "the best of several", per this part's explicit "the API response
   * must clearly explain why" requirement. */
  evaluatedStorageUnitCount: number;
}

export interface WarehouseSuitabilityResponseDTO {
  warehouse: WarehouseDTO;
  crop: { id: string; name: string };
  suitability: StorageSuitabilityDTO;
}

export type OverallEligibility = "ELIGIBLE" | "INSUFFICIENT_CAPACITY" | "UNSUITABLE" | "UNKNOWN";

/**
 * Part 2 (capacity) + Part 3 (suitability), preserved independently — this
 * part's explicit "do not hide whether rejection came from capacity or
 * suitability" requirement. Never merges the two into a single opaque
 * boolean.
 */
export interface StorageEligibilityResponseDTO {
  warehouse: WarehouseDTO;
  capacity: WarehouseAvailabilityDTO["capacity"];
  requestedQuantity: WarehouseAvailabilityDTO["requestedQuantity"];
  canAccommodate: WarehouseAvailabilityDTO["canAccommodate"];
  suitability: StorageSuitabilityDTO;
  overallEligibility: OverallEligibility;
}

export function toCropStorageRequirementSummary(row: CropStorageRequirement) {
  return {
    crop: { id: row.cropId },
    preferredTemperatureMin: row.preferredTemperatureMin === null ? null : Number(row.preferredTemperatureMin),
    preferredTemperatureMax: row.preferredTemperatureMax === null ? null : Number(row.preferredTemperatureMax),
    preferredHumidityMin: row.preferredHumidityMin === null ? null : Number(row.preferredHumidityMin),
    preferredHumidityMax: row.preferredHumidityMax === null ? null : Number(row.preferredHumidityMax),
    requiresVentilation: row.requiresVentilation,
    requiresColdStorage: row.requiresColdStorage,
    requiresControlledAtmosphere: row.requiresControlledAtmosphere,
    requiresPestControl: row.requiresPestControl,
    requiresMoistureControl: row.requiresMoistureControl,
    compatibleStorageTypes: row.compatibleStorageTypes,
    maximumRecommendedStorageDays: row.maximumRecommendedStorageDays,
    notes: row.notes,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CropStorageRequirementSummaryDTO = ReturnType<typeof toCropStorageRequirementSummary>;
