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
