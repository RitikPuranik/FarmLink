import { z } from "zod";
import { areaUnitSchema } from "../farms/farms.schemas";

const idSchema = z.string().uuid("This value is not valid.");

const areaSchema = z
  .number({ invalid_type_error: "Enter a valid area." })
  .finite("Enter a valid area.")
  .gt(0, "Area must be greater than zero.")
  .lte(100_000, "Enter a realistic area.");

const typicalYieldSchema = z
  .number({ invalid_type_error: "Enter a valid yield." })
  .finite("Enter a valid yield.")
  .gt(0, "Yield must be greater than zero.");

export const addFarmerCropSchema = z
  .object({
    farmId: idSchema,
    cropId: idSchema,
    area: areaSchema,
    areaUnit: areaUnitSchema,
    isPrimary: z.boolean().optional(),
    // MVP-optional (build spec section 18).
    typicalYield: typicalYieldSchema.optional(),
    yieldUnit: z.string().trim().max(40, "Yield unit is too long.").optional(),
  })
  .strict();

export const updateFarmerCropSchema = z
  .object({
    area: areaSchema.optional(),
    areaUnit: areaUnitSchema.optional(),
    isPrimary: z.boolean().optional(),
    typicalYield: typicalYieldSchema.nullable().optional(),
    yieldUnit: z.string().trim().max(40, "Yield unit is too long.").nullable().optional(),
  })
  .strict();

export type AddFarmerCropRequestBody = z.infer<typeof addFarmerCropSchema>;
export type UpdateFarmerCropRequestBody = z.infer<typeof updateFarmerCropSchema>;
