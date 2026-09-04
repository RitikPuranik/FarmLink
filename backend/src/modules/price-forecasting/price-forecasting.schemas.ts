import { z } from "zod";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { MAX_LIST_RESULTS } from "./price-forecasting.repository";

// ---------------------------------------------------------------------------
// Module 7 Part 5 — request validation.
//
// MANDI/REGIONAL/CROP_WIDE are validated as a strict discriminated union
// (not three optional fields) so a mismatched combination — a mandiId sent
// alongside CROP_WIDE, a REGIONAL scope missing `state` — is rejected by
// Zod itself as a 400 VALIDATION_ERROR before it ever reaches the service
// layer, per the build spec's "reject invalid combinations instead of
// silently ignoring fields."
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

export const forecastPublicIdParams = z.object({ forecastPublicId: uuid });
export const cropIdParams = z.object({ cropId: uuid });

const mandiScope = z.object({ type: z.literal("MANDI"), mandiId: uuid }).strict();
const regionalScope = z
  .object({
    type: z.literal("REGIONAL"),
    state: z.string().trim().min(1, "state is required for a REGIONAL scope").max(100),
    district: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const cropWideScope = z.object({ type: z.literal("CROP_WIDE") }).strict();

export const forecastScopeSchema = z.discriminatedUnion("type", [mandiScope, regionalScope, cropWideScope]);

export const generateForecastBody = z
  .object({
    cropId: uuid,
    scope: forecastScopeSchema,
    // Bounded by the same MAX_HORIZON_DAYS the underlying sufficiency
    // check (Part 1) already enforces — rejected here as a fast, cheap
    // 400 rather than round-tripping through history preparation first.
    horizonDays: z.coerce.number().int().min(1).max(PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS).optional(),
  })
  .strict();

const scopeTypeEnum = z.enum(["MANDI", "REGIONAL", "CROP_WIDE"]);

export const listForecastsQuery = z
  .object({
    scopeType: scopeTypeEnum.optional(),
    mandiId: uuid.optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_RESULTS).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mandiId && v.scopeType && v.scopeType !== "MANDI") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mandiId"], message: "mandiId can only be combined with scopeType MANDI" });
    }
    if (v.startDate && v.endDate && v.startDate > v.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must not precede startDate" });
    }
  });

export const latestForecastQuery = z
  .object({
    scopeType: scopeTypeEnum.default("CROP_WIDE"),
    mandiId: uuid.optional(),
    state: z.string().trim().min(1).max(100).optional(),
    district: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scopeType === "MANDI" && !v.mandiId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mandiId"], message: "mandiId is required when scopeType is MANDI" });
    }
    if (v.scopeType === "REGIONAL" && !v.state) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "state is required when scopeType is REGIONAL" });
    }
    if (v.scopeType !== "MANDI" && v.mandiId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mandiId"], message: "mandiId can only be combined with scopeType MANDI" });
    }
    if (v.scopeType !== "REGIONAL" && (v.state || v.district)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "state/district can only be combined with scopeType REGIONAL" });
    }
  });

export type GenerateForecastBody = z.infer<typeof generateForecastBody>;
export type ListForecastsQuery = z.infer<typeof listForecastsQuery>;
export type LatestForecastQuery = z.infer<typeof latestForecastQuery>;
