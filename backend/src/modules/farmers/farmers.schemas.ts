import { z } from "zod";

export const fpoMembershipStatusSchema = z.enum(["NOT_A_MEMBER", "MEMBER", "PENDING"], {
  errorMap: () => ({ message: "Select a valid FPO membership status." }),
});

export const liquidityPreferenceSchema = z.enum(
  ["URGENT", "WITHIN_3_DAYS", "WITHIN_1_WEEK", "CAN_WAIT_2_WEEKS", "FLEXIBLE"],
  { errorMap: () => ({ message: "Select a valid liquidity preference." }) },
);

export const communicationPreferenceSchema = z.enum(["IN_APP", "SMS", "WHATSAPP", "VOICE"], {
  errorMap: () => ({ message: "Select a valid communication preference." }),
});

const fpoIdSchema = z.string().uuid("This value is not valid.");

// Shared body shape for both create and update — build spec section 25/26
// group these fields together as "selling preferences" and every field is
// independently optional (a farmer can answer them one at a time). The
// refinement below is what actually differs create from a hypothetical
// "anything goes" PATCH: if the farmer says they're a member, a specific
// FPO must be selected in the same request.
const farmerProfileBodySchema = z
  .object({
    fpoMembershipStatus: fpoMembershipStatusSchema.optional(),
    fpoId: fpoIdSchema.nullable().optional(),
    liquidityPreference: liquidityPreferenceSchema.optional(),
    willingToStore: z.boolean().optional(),
    communicationPreference: communicationPreferenceSchema.optional(),
  })
  .strict()
  .refine((val) => val.fpoMembershipStatus !== "MEMBER" || Boolean(val.fpoId), {
    message: "Select your FPO.",
    path: ["fpoId"],
  });

export const createFarmerProfileSchema = farmerProfileBodySchema;
export const updateFarmerProfileSchema = farmerProfileBodySchema;

export type FarmerProfileRequestBody = z.infer<typeof farmerProfileBodySchema>;
