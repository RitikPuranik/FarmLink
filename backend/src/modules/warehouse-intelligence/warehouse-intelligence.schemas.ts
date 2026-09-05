import { z } from "zod";
import { WAREHOUSE_INTELLIGENCE_CONFIG } from "./warehouse-intelligence.config";

const publicId = z.string().uuid("This value is not valid.");
const cropId = z.string().uuid("This value is not valid.");
const quantityUnit = z.enum(["KG", "QTL", "TONNE"]);

function requireQuantityUnitPair<T extends { quantity?: number; unit?: "KG" | "QTL" | "TONNE" }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if ((v.quantity === undefined) !== (v.unit === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["quantity"],
      message: "quantity and unit must be provided together",
    });
  }
}

export const warehouseIdParams = z.object({ warehouseId: publicId });

export const warehouseStorageUnitParams = z.object({
  warehouseId: publicId,
  storageUnitId: publicId,
});

export const nearbyWarehousesQuery = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce
      .number()
      .positive()
      .max(WAREHOUSE_INTELLIGENCE_CONFIG.MAX_RADIUS_KM)
      .default(WAREHOUSE_INTELLIGENCE_CONFIG.DEFAULT_RADIUS_KM),
    cropId: cropId.optional(),
    quantity: z.coerce.number().positive().optional(),
    unit: quantityUnit.optional(),
  })
  .superRefine(requireQuantityUnitPair);

export const warehouseAvailabilityQuery = z
  .object({
    cropId: cropId.optional(),
    quantity: z.coerce.number().positive().optional(),
    unit: quantityUnit.optional(),
  })
  .superRefine(requireQuantityUnitPair);

export const updateStorageCapacityBody = z
  .object({
    totalCapacity: z.coerce.number().nonnegative().optional(),
    availableCapacity: z.coerce.number().nonnegative().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.totalCapacity === undefined && v.availableCapacity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of totalCapacity or availableCapacity is required.",
      });
    }
  });

export type NearbyWarehousesQuery = z.infer<typeof nearbyWarehousesQuery>;
export type WarehouseAvailabilityQuery = z.infer<typeof warehouseAvailabilityQuery>;
export type UpdateStorageCapacityBody = z.infer<typeof updateStorageCapacityBody>;

// ---------------------------------------------------------------------------
// Module 9 Part 3 — Storage Conditions, Crop Suitability & Storage
// Constraints.
// ---------------------------------------------------------------------------

const storageTypeEnum = z.enum(["AMBIENT", "COLD_STORAGE", "CONTROLLED_ATMOSPHERE", "SILO", "WAREHOUSE_GODOWN", "OTHER"]);

export const cropIdParams = z.object({ cropId });

export const warehouseSuitabilityQuery = z.object({
  cropId,
});

export const storageEligibilityQuery = z
  .object({
    cropId,
    quantity: z.coerce.number().positive().optional(),
    unit: quantityUnit.optional(),
  })
  .superRefine(requireQuantityUnitPair);

/** Validates min <= max whenever both are present — never silently swaps
 * them (build spec: "no invalid contradictory condition configuration"). */
function requireOrderedRange(minKey: string, maxKey: string, issueCode: string) {
  return (v: Record<string, number | null | undefined>, ctx: z.RefinementCtx) => {
    const min = v[minKey];
    const max = v[maxKey];
    if (min !== undefined && min !== null && max !== undefined && max !== null && min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [minKey],
        message: issueCode,
      });
    }
  };
}

export const updateStorageConditionsBody = z
  .object({
    temperatureControlled: z.boolean().optional(),
    minTemperature: z.coerce.number().min(-50).max(60).nullable().optional(),
    maxTemperature: z.coerce.number().min(-50).max(60).nullable().optional(),
    humidityControlled: z.boolean().optional(),
    minHumidity: z.coerce.number().min(0).max(100).nullable().optional(),
    maxHumidity: z.coerce.number().min(0).max(100).nullable().optional(),
    ventilationAvailable: z.boolean().nullable().optional(),
    coldStorageAvailable: z.boolean().nullable().optional(),
    controlledAtmosphereAvailable: z.boolean().nullable().optional(),
    pestControlAvailable: z.boolean().nullable().optional(),
    moistureControlAvailable: z.boolean().nullable().optional(),
  })
  .strict()
  .superRefine((v: { minTemperature?: number | null; maxTemperature?: number | null; minHumidity?: number | null; maxHumidity?: number | null }, ctx: z.RefinementCtx) => {
    if (Object.keys(v).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one storage condition field is required." });
      return;
    }
    requireOrderedRange("minTemperature", "maxTemperature", "INVALID_TEMPERATURE_RANGE")(v, ctx);
    requireOrderedRange("minHumidity", "maxHumidity", "INVALID_HUMIDITY_RANGE")(v, ctx);
  });

export const upsertCropStorageRequirementBody = z
  .object({
    preferredTemperatureMin: z.coerce.number().min(-50).max(60).nullable().optional(),
    preferredTemperatureMax: z.coerce.number().min(-50).max(60).nullable().optional(),
    preferredHumidityMin: z.coerce.number().min(0).max(100).nullable().optional(),
    preferredHumidityMax: z.coerce.number().min(0).max(100).nullable().optional(),
    requiresVentilation: z.boolean().nullable().optional(),
    requiresColdStorage: z.boolean().nullable().optional(),
    requiresControlledAtmosphere: z.boolean().nullable().optional(),
    requiresPestControl: z.boolean().nullable().optional(),
    requiresMoistureControl: z.boolean().nullable().optional(),
    compatibleStorageTypes: z.array(storageTypeEnum).max(6).optional(),
    maximumRecommendedStorageDays: z.coerce.number().int().positive().max(3650).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict()
  .superRefine((v: {
    preferredTemperatureMin?: number | null;
    preferredTemperatureMax?: number | null;
    preferredHumidityMin?: number | null;
    preferredHumidityMax?: number | null;
  }, ctx: z.RefinementCtx) => {
    requireOrderedRange("preferredTemperatureMin", "preferredTemperatureMax", "INVALID_TEMPERATURE_RANGE")(v, ctx);
    requireOrderedRange("preferredHumidityMin", "preferredHumidityMax", "INVALID_HUMIDITY_RANGE")(v, ctx);
  });

export type WarehouseSuitabilityQuery = z.infer<typeof warehouseSuitabilityQuery>;
export type StorageEligibilityQuery = z.infer<typeof storageEligibilityQuery>;
export type UpdateStorageConditionsBody = z.infer<typeof updateStorageConditionsBody>;
export type UpsertCropStorageRequirementBody = z.infer<typeof upsertCropStorageRequirementBody>;

// ---------------------------------------------------------------------------
// Module 9 Part 4 — Warehouse Suitability & Risk Analysis.
// ---------------------------------------------------------------------------

export const suitabilityAnalysisQuery = z
  .object({
    cropId,
    quantity: z.coerce.number().positive().optional(),
    unit: quantityUnit.optional(),
    durationDays: z.coerce.number().int().positive().max(3650).optional(),
  })
  .superRefine(requireQuantityUnitPair);

export type SuitabilityAnalysisQuery = z.infer<typeof suitabilityAnalysisQuery>;

// ---------------------------------------------------------------------------
// Module 9 Part 5 — Warehouse Recommendation & Ranking Engine.
// ---------------------------------------------------------------------------

function requireLatitudeLongitudePair(v: { latitude?: number; longitude?: number }, ctx: z.RefinementCtx) {
  if ((v.latitude === undefined) !== (v.longitude === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["latitude"],
      message: "latitude and longitude must be provided together",
    });
  }
}

export const recommendWarehousesBody = z
  .object({
    cropId,
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(WAREHOUSE_INTELLIGENCE_CONFIG.MAX_RADIUS_KM).optional(),
    quantity: z.coerce.number().positive().optional(),
    unit: quantityUnit.optional(),
    durationDays: z.coerce.number().int().positive().max(3650).optional(),
  })
  .superRefine((v: {
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    quantity?: number;
    unit?: "KG" | "QTL" | "TONNE";
  }, ctx: z.RefinementCtx) => {
    requireLatitudeLongitudePair(v, ctx);
    requireQuantityUnitPair(v, ctx);
    if (v.radiusKm !== undefined && v.latitude === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["radiusKm"], message: "radiusKm requires latitude and longitude" });
    }
  });

export type RecommendWarehousesBody = z.infer<typeof recommendWarehousesBody>;
