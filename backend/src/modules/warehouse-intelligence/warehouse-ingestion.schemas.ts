import { z } from "zod";

export const triggerWarehouseSyncBody = z
  .object({
    /** Optional lower bound passed through to providers as a fetch hint
     * only (see WarehouseProviderRequest.updatedSince) — omitting it lets
     * each provider decide its own default window. */
    updatedSince: z.coerce.date().optional(),
  })
  .strict();

export type TriggerWarehouseSyncBody = z.infer<typeof triggerWarehouseSyncBody>;
