import { z } from "zod";

const idSchema = z.string().uuid("This value is not valid.");
const publicIdSchema = z.string().uuid("This value is not valid.");

export const qualityAssessmentSourceSchema = z.enum(["MANUAL", "AI", "LAB", "HYBRID"], {
  errorMap: () => ({ message: "Select a valid assessment source." }),
});

export const qualityGradeSchema = z.enum(["A", "B", "C", "D", "REJECTED"], {
  errorMap: () => ({ message: "Select a valid grade." }),
});

export const qualityImageTypeSchema = z.enum(["OVERVIEW", "TOP_VIEW", "SIDE_VIEW", "CLOSE_UP", "DEFECT", "OTHER"], {
  errorMap: () => ({ message: "Select a valid image type." }),
});

// Build spec section 11-13: a flexible metric — code/name/value only
// required, everything else optional so any crop's parameter set fits.
const metricInputSchema = z
  .object({
    code: z.string().trim().min(1).max(60),
    name: z.string().trim().min(1).max(120),
    value: z.number().finite("Enter a valid metric value."),
    unit: z.string().trim().max(20).optional(),
    minAllowed: z.number().finite().optional(),
    maxAllowed: z.number().finite().optional(),
  })
  .strict();

// Build spec section 17: at most 30 metrics per submission is a generous
// ceiling — no real crop's parameter set approaches that.
const metricsArraySchema = z.array(metricInputSchema).max(30).optional();

export const createAssessmentSchema = z
  .object({
    source: qualityAssessmentSourceSchema,
    metrics: metricsArraySchema,
    overallGrade: qualityGradeSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const updateAssessmentSchema = z
  .object({
    // Replaces the metric set wholesale when provided (build spec section
    // 53: only reachable while still DRAFT/PENDING_IMAGES, so there is no
    // "history to protect" yet — a new assessment is required for any
    // change after that).
    metrics: metricsArraySchema,
    overallGrade: qualityGradeSchema.optional().or(z.null()),
    notes: z.string().trim().max(2000).optional().or(z.null()),
  })
  .strict();

export const lotIdParamSchema = z.object({ lotPublicId: publicIdSchema });
export const assessmentIdParamSchema = z.object({ publicId: publicIdSchema });
export const assessmentImageParamSchema = z.object({ publicId: publicIdSchema, imageId: idSchema });

export const listAssessmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

// Build spec section 15/18: the backend never handles the raw file — the
// client uploads to its own storage first (see
// images/quality-image.service.ts's comment) and only sends the resulting
// metadata here.
export const addImageSchema = z
  .object({
    storageProvider: z.string().trim().min(1).max(40).default("cloudinary"),
    externalId: z.string().trim().min(1).max(300),
    secureUrl: z.string().trim().url("Enter a valid image URL."),
    imageType: qualityImageTypeSchema.optional().default("OTHER"),
    checksum: z.string().trim().max(128).optional(),
  })
  .strict();

// Build spec section 54: an authorized verifier can accept the current
// grade as-is, override it, and/or add their own verified metrics.
export const verifyAssessmentSchema = z
  .object({
    overallGrade: qualityGradeSchema.optional(),
    qualityScore: z.number().min(0).max(100).optional(),
    metrics: metricsArraySchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>;
export type UpdateAssessmentInput = z.infer<typeof updateAssessmentSchema>;
export type AddImageInput = z.infer<typeof addImageSchema>;
export type VerifyAssessmentInput = z.infer<typeof verifyAssessmentSchema>;
export type ListAssessmentsQuery = z.infer<typeof listAssessmentsQuerySchema>;
