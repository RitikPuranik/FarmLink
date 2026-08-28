import { z } from "zod";

// Mirrors backend/src/modules/farms/farms.schemas.ts — this is a UX
// convenience for instant feedback, never the security/validation
// boundary (the backend re-validates everything independently).
export const farmFormSchema = z.object({
  name: z.string().trim().max(120, "validation.tooLong").optional().or(z.literal("")),
  stateId: z.string().min(1, "validation.required"),
  districtId: z.string().min(1, "validation.required"),
  talukaId: z.string().min(1, "validation.required"),
  village: z.string().trim().min(1, "validation.required").max(120, "validation.tooLong"),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "validation.pincode")
    .optional()
    .or(z.literal("")),
  area: z.coerce
    .number({ invalid_type_error: "validation.area" })
    .gt(0, "validation.area")
    .lte(100_000, "validation.area"),
  areaUnit: z.enum(["ACRE", "HECTARE"]),
  irrigationType: z.enum(["RAINFED", "CANAL", "BOREWELL", "DRIP", "SPRINKLER", "MIXED", "OTHER", "NOT_SPECIFIED"]),
});

export type FarmFormValues = z.infer<typeof farmFormSchema>;

export const cropFormSchema = z.object({
  farmId: z.string().min(1, "validation.required"),
  cropId: z.string().min(1, "validation.required"),
  area: z.coerce.number({ invalid_type_error: "validation.area" }).gt(0, "validation.area").lte(100_000, "validation.area"),
  areaUnit: z.enum(["ACRE", "HECTARE"]),
  typicalYield: z
    .union([z.coerce.number({ invalid_type_error: "validation.yield" }).gt(0, "validation.yield"), z.nan()])
    .optional(),
  yieldUnit: z.string().trim().max(40, "validation.tooLong").optional().or(z.literal("")),
  isPrimary: z.boolean().optional(),
});

export type CropFormValues = z.infer<typeof cropFormSchema>;
