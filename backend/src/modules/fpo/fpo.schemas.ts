import { z } from "zod";

export const idSchema = z.string().uuid("This value is not valid.");
// Every Module 3 URL segment (:fpoId, :membershipId, :aggregationId) is the
// resource's publicId, never its internal database id — see fpo.types.ts.
export const publicIdSchema = z.string().uuid("This value is not valid.");

export const fpoOrganizationTypeSchema = z.enum(["FPO", "FPC", "COOPERATIVE", "OTHER"], {
  errorMap: () => ({ message: "Select a valid organization type." }),
});

export const fpoVerificationStatusSchema = z.enum(
  ["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED", "SUSPENDED", "EXPIRED"],
  { errorMap: () => ({ message: "Invalid verification status." }) },
);

export const quantityUnitSchema = z.enum(["KG", "QTL", "TONNE"], {
  errorMap: () => ({ message: "Select a valid quantity unit." }),
});

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter a valid 6-digit PIN code.")
  .optional()
  .or(z.literal("").transform(() => undefined));

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{6,20}$/, "Enter a valid phone number.")
  .optional()
  .or(z.literal("").transform(() => undefined));

const latitudeSchema = z.number().min(-90).max(90).optional();
const longitudeSchema = z.number().min(-180).max(180).optional();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  // Build spec section 56: default 20, hard ceiling 100 — never allow
  // unlimited extraction from a list endpoint.
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const createFpoSchema = z
  .object({
    name: z.string().trim().min(2, "FPO name is required.").max(160, "FPO name is too long."),
    legalName: z.string().trim().max(200, "Legal name is too long.").optional(),
    registrationNumber: z.string().trim().max(64, "Registration number is too long.").optional(),
    organizationType: fpoOrganizationTypeSchema,
    phone: phoneSchema,
    email: z.string().trim().email("Enter a valid email address.").optional().or(z.literal("").transform(() => undefined)),
    village: z.string().trim().max(120, "Village name is too long.").optional(),
    pincode: pincodeSchema,
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    stateId: idSchema,
    districtId: idSchema,
    talukaId: idSchema.optional(),
  })
  .strict();

export const searchFposQuerySchema = z
  .object({
    name: z.string().trim().max(160).optional(),
    state: z.string().trim().max(120).optional(),
    district: z.string().trim().max(120).optional(),
    stateId: idSchema.optional(),
    districtId: idSchema.optional(),
    verificationStatus: fpoVerificationStatusSchema.optional(),
  })
  .merge(paginationQuerySchema);

export const fpoIdParamSchema = z.object({ fpoId: publicIdSchema });

export const fpoAdminIdParamSchema = z.object({ fpoId: publicIdSchema, adminId: idSchema });

export const verifyFpoSchema = z
  .object({ verificationNote: z.string().trim().max(1000, "Note is too long.").optional() })
  .strict();

export const rejectFpoSchema = z
  .object({ verificationNote: z.string().trim().max(1000, "Note is too long.").optional() })
  .strict();

export const assignFpoAdminSchema = z
  .object({
    userId: idSchema,
    role: z.enum(["PRIMARY_ADMIN", "ADMIN"], { errorMap: () => ({ message: "Select a valid admin role." }) }),
  })
  .strict();

export type CreateFpoInput = z.infer<typeof createFpoSchema>;
export type SearchFposQuery = z.infer<typeof searchFposQuerySchema>;
export type VerifyFpoInput = z.infer<typeof verifyFpoSchema>;
export type AssignFpoAdminInput = z.infer<typeof assignFpoAdminSchema>;
