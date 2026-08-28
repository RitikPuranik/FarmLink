import { z } from "zod";

export const listDistrictsQuerySchema = z.object({
  stateId: z.string({ required_error: "stateId is required." }).uuid("stateId must be a valid id."),
});

export const listTalukasQuerySchema = z.object({
  districtId: z.string({ required_error: "districtId is required." }).uuid("districtId must be a valid id."),
});

export const listFposQuerySchema = z.object({
  districtId: z.string().uuid("districtId must be a valid id.").optional(),
});

export type ListDistrictsQuery = z.infer<typeof listDistrictsQuerySchema>;
export type ListTalukasQuery = z.infer<typeof listTalukasQuerySchema>;
export type ListFposQuery = z.infer<typeof listFposQuerySchema>;
