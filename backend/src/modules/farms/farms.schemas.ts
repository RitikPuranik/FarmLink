import { z } from "zod";

export const areaUnitSchema = z.enum(["ACRE", "HECTARE"], {
  errorMap: () => ({ message: "Select acres or hectares." }),
});

export const irrigationTypeSchema = z.enum(
  ["RAINFED", "CANAL", "BOREWELL", "DRIP", "SPRINKLER", "MIXED", "OTHER", "NOT_SPECIFIED"],
  { errorMap: () => ({ message: "Select a valid irrigation type." }) },
);

const idSchema = z.string().uuid("This value is not valid.");

// Section 11: "Prevent: negative values, zero values, invalid numeric
// input, obviously invalid values." 100,000 acres/hectares is an
// intentionally generous ceiling that still catches fat-finger/garbage
// input (e.g. a stray extra digit) without guessing at a "real" max farm
// size.
const areaSchema = z
  .number({ invalid_type_error: "Enter a valid area." })
  .finite("Enter a valid area.")
  .gt(0, "Area must be greater than zero.")
  .lte(100_000, "Enter a realistic area.");

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter a valid 6-digit PIN code.")
  .optional()
  .or(z.literal("").transform(() => undefined));

const latitudeSchema = z.number().min(-90).max(90).optional();
const longitudeSchema = z.number().min(-180).max(180).optional();

export const createFarmSchema = z
  .object({
    name: z.string().trim().max(120, "Farm name is too long.").optional(),
    village: z.string().trim().min(1, "Village is required.").max(120, "Village name is too long."),
    pincode: pincodeSchema,
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    stateId: idSchema,
    districtId: idSchema,
    talukaId: idSchema,
    area: areaSchema,
    areaUnit: areaUnitSchema,
    irrigationType: irrigationTypeSchema.optional(),
  })
  .strict();

export const updateFarmSchema = z
  .object({
    name: z.string().trim().max(120, "Farm name is too long.").nullable().optional(),
    village: z.string().trim().min(1, "Village is required.").max(120, "Village name is too long.").optional(),
    pincode: pincodeSchema.or(z.null()),
    latitude: latitudeSchema.or(z.null()),
    longitude: longitudeSchema.or(z.null()),
    stateId: idSchema.optional(),
    districtId: idSchema.optional(),
    talukaId: idSchema.optional(),
    area: areaSchema.optional(),
    areaUnit: areaUnitSchema.optional(),
    irrigationType: irrigationTypeSchema.optional(),
  })
  .strict();

export type CreateFarmRequestBody = z.infer<typeof createFarmSchema>;
export type UpdateFarmRequestBody = z.infer<typeof updateFarmSchema>;
