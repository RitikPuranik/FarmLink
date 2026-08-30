import { z } from "zod";
import { publicIdSchema, paginationQuerySchema } from "./fpo.schemas";

export const membershipIdParamSchema = z.object({ membershipId: publicIdSchema });

export const rejectMembershipSchema = z
  .object({ reason: z.string().trim().max(500, "Reason is too long.").optional() })
  .strict();

export const listMembersQuerySchema = z
  .object({
    status: z.enum(["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "REMOVED"]).optional(),
    cropId: z.string().uuid().optional(),
    district: z.string().trim().max(120).optional(),
    search: z.string().trim().max(120).optional(),
  })
  .merge(paginationQuerySchema);

export type RejectMembershipInput = z.infer<typeof rejectMembershipSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
