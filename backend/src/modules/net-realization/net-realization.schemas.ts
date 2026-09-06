import { z } from "zod";

const publicId = z.string().uuid("This value is not valid.");
const quantityUnit = z.enum(["KG", "QTL", "TONNE"]);
const costCategory = z.enum([
  "TRANSPORT",
  "LOADING",
  "UNLOADING",
  "PACKAGING",
  "STORAGE",
  "COMMISSION",
  "MARKET_FEE",
  "TAX",
  "INSURANCE",
  "OTHER",
]);

export const lotPublicIdParams = z.object({ lotPublicId: publicId });
export const calculationPublicIdParams = z.object({ publicId });

const userProvidedCost = z
  .object({
    category: costCategory,
    amount: z.coerce.number().finite("Cost amount must be a finite number.").nonnegative("Cost amount cannot be negative."),
    name: z.string().trim().min(1).max(120).optional(),
    isIncludedInPrice: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.category === "OTHER" && !v.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["name"], message: "name is required for an OTHER cost." });
    }
  });

/** Part K/L — the calculate-realization POST body. Every field is
 * optional: omitting all of them still resolves a valid (or honestly
 * INSUFFICIENT) calculation purely from real system data. */
export const calculateRealizationBody = z
  .object({
    offerPublicId: publicId.optional(),
    salePricePerUnit: z.coerce.number().finite().nonnegative("Sale price cannot be negative.").optional(),
    salePriceUnit: quantityUnit.optional(),
    saleQuantity: z.coerce.number().finite().positive("Sale quantity must be positive.").optional(),
    saleQuantityUnit: quantityUnit.optional(),
    costs: z.array(userProvidedCost).max(30).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.salePriceUnit !== undefined && v.salePricePerUnit === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salePriceUnit"],
        message: "salePriceUnit requires salePricePerUnit.",
      });
    }
    if (v.saleQuantityUnit !== undefined && v.saleQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["saleQuantityUnit"],
        message: "saleQuantityUnit requires saleQuantity.",
      });
    }
    if (v.offerPublicId && v.salePricePerUnit !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salePricePerUnit"],
        message: "salePricePerUnit cannot be combined with offerPublicId — an offer already carries its own price.",
      });
    }
  });

export const listRealizationsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
