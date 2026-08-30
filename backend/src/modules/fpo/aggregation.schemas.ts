import { z } from "zod";
import { idSchema, publicIdSchema, quantityUnitSchema } from "./fpo.schemas";

export const aggregationIdParamSchema = z.object({ aggregationId: publicIdSchema });

export const cropAggregationMembersParamSchema = z.object({ cropId: idSchema });

export const createAggregationGroupSchema = z
  .object({
    cropId: idSchema,
    targetQuantity: z.number().positive("Target quantity must be greater than zero.").optional(),
    unit: quantityUnitSchema,
    targetDate: z.coerce.date().optional(),
  })
  .strict();

export const updateAggregationGroupSchema = z
  .object({
    targetQuantity: z.number().positive("Target quantity must be greater than zero.").optional(),
    targetDate: z.coerce.date().optional(),
    // CANCELLED is deliberately excluded — that transition only happens
    // through the dedicated /cancel endpoint (build spec section 39).
    status: z.enum(["DRAFT", "OPEN", "READY", "CLOSED"]).optional(),
  })
  .strict();

export const listAggregationGroupsQuerySchema = z
  .object({
    cropId: idSchema.optional(),
    status: z.enum(["DRAFT", "OPEN", "READY", "CLOSED", "CANCELLED"]).optional(),
  })
  .strict();

export type CreateAggregationGroupInput = z.infer<typeof createAggregationGroupSchema>;
export type UpdateAggregationGroupInput = z.infer<typeof updateAggregationGroupSchema>;
