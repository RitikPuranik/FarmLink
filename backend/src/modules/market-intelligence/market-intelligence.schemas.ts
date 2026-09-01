import { z } from "zod";

const id = z.string().uuid();
export const cropIdParams = z.object({ cropId: id });
export const mandiIdParams = z.object({ mandiId: id });
export const lotIdParams = z.object({ lotPublicId: id });
const date = z.coerce.date();
export const trendQuery = z.object({ mandiId: id.optional(), days: z.coerce.number().int().min(1).max(365).optional(), startDate: date.optional(), endDate: date.optional() }).superRefine((v, ctx) => { if (v.startDate && !v.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endDate is required with startDate" }); if (v.endDate && !v.startDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startDate is required with endDate" }); if (v.startDate && v.endDate && v.startDate > v.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startDate must precede endDate" }); });
export const snapshotQuery = z.object({ mandiId: id.optional(), state: z.string().trim().min(1).max(100).optional(), district: z.string().trim().min(1).max(100).optional() });
export const nearbyQuery = z.object({ cropId: id, latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().positive().max(500).default(150) });
export const compareQuery = z.object({ state: z.string().trim().min(1).max(100).optional(), district: z.string().trim().min(1).max(100).optional(), latitude: z.coerce.number().min(-90).max(90).optional(), longitude: z.coerce.number().min(-180).max(180).optional(), radiusKm: z.coerce.number().positive().max(500).default(150) }).superRefine((v, c) => { if ((v.latitude === undefined) !== (v.longitude === undefined)) c.addIssue({ code: z.ZodIssueCode.custom, message: "latitude and longitude must be provided together" }); });
export const recommendationBody = z.object({ cropId: id, quantity: z.coerce.number().positive().optional(), unit: z.enum(["QTL", "KG", "TONNE"]).default("QTL"), location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }), radiusKm: z.number().positive().max(500).default(150) });
export const radiusQuery = z.object({ radiusKm: z.coerce.number().positive().max(500).default(150) });
export type TrendQuery = z.infer<typeof trendQuery>; export type RecommendationBody = z.infer<typeof recommendationBody>;
