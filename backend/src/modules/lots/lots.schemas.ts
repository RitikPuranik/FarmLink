import { z } from "zod";

const idSchema = z.string().uuid("This value is not valid.");
// Every lot URL segment (:id) is the lot's publicId, never its internal
// database id (build spec section 48).
const publicIdSchema = z.string().uuid("This value is not valid.");

export const quantityUnitSchema = z.enum(["KG", "QTL", "TONNE"], {
  errorMap: () => ({ message: "Select a valid quantity unit." }),
});

// Build spec section 83: reject negative, zero, NaN, and infinite values —
// `.finite()` rejects both NaN and +/-Infinity, `.positive()` rejects zero
// and negatives. 100,000 of any unit is a generous ceiling that still
// catches fat-finger input (mirrors farms.schemas.ts' areaSchema pattern).
const quantitySchema = z
  .number({ invalid_type_error: "Enter a valid quantity." })
  .finite("Enter a valid quantity.")
  .positive("Quantity must be greater than zero.")
  .lte(1_000_000, "Enter a realistic quantity.");

const varietySchema = z.string().trim().min(1).max(120, "Variety is too long.").optional();

// Section 20/21: harvestDate must be <= availabilityDate, and (section 20)
// a harvest date may not be in the future — planned/future harvests are
// deliberately out of scope for this module ("add a separate field rather
// than abusing harvestDate").
function assertDateOrdering<T extends { harvestDate?: Date; availabilityDate: Date }>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.harvestDate) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (data.harvestDate.getTime() > today.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["harvestDate"], message: "Harvest date cannot be in the future." });
    }
    if (data.harvestDate.getTime() > data.availabilityDate.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["harvestDate"],
        message: "Harvest date must be on or before the availability date.",
      });
    }
  }
}

export const createLotSchema = z
  .object({
    // Exactly one of these two is required — enforced below, since which
    // one applies depends on the field itself, not on the caller's role
    // (the service additionally checks the branch matches the caller's
    // role — build spec section 12 vs 14 — this is defense in depth at
    // the request-shape level).
    farmId: idSchema.optional(),
    fpoId: idSchema.optional(),
    cropId: idSchema,
    quantity: quantitySchema,
    unit: quantityUnitSchema,
    variety: varietySchema,
    harvestDate: z.coerce.date().optional(),
    availabilityDate: z.coerce.date({ required_error: "Availability date is required." }),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Boolean(data.farmId) === Boolean(data.fpoId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["farmId"],
        message: "Provide exactly one of farmId (farmer lot) or fpoId (FPO lot).",
      });
    }
    assertDateOrdering(data, ctx);
  });

export const updateDraftLotSchema = z
  .object({
    farmId: idSchema.optional(),
    cropId: idSchema.optional(),
    quantity: quantitySchema.optional(),
    unit: quantityUnitSchema.optional(),
    variety: varietySchema.or(z.null()),
    harvestDate: z.coerce.date().optional().or(z.null()),
    availabilityDate: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.harvestDate instanceof Date && data.availabilityDate instanceof Date) {
      assertDateOrdering(data as { harvestDate?: Date; availabilityDate: Date }, ctx);
    }
  });

export const lotIdParamSchema = z.object({ id: publicIdSchema });

export const listLotsQuerySchema = z
  .object({
    status: z
      .enum([
        "DRAFT",
        "AVAILABLE",
        "PARTIALLY_COMMITTED",
        "COMMITTED",
        "STORED",
        "IN_TRANSACTION",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ])
      .optional(),
    cropId: idSchema.optional(),
    farmId: idSchema.optional(),
    unit: quantityUnitSchema.optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    // Build spec section 56 (reused convention): default 20, hard ceiling
    // 100 — list endpoints never return unlimited rows.
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

export const getLotQuerySchema = z.object({ unit: quantityUnitSchema.optional() }).strict();

export type CreateLotInput = z.infer<typeof createLotSchema>;
export type UpdateDraftLotInput = z.infer<typeof updateDraftLotSchema>;
export type ListLotsQuery = z.infer<typeof listLotsQuerySchema>;
export type GetLotQuery = z.infer<typeof getLotQuerySchema>;
