import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { WarehouseSyncService } from "./warehouse-sync.service";
import { TriggerWarehouseSyncBody } from "./warehouse-ingestion.schemas";

export function createWarehouseIngestionController(syncService: WarehouseSyncService) {
  return {
    triggerSync: async (req: Request, res: Response) => {
      const body = req.body as TriggerWarehouseSyncBody;
      const summary = await syncService.run({ updatedSince: body.updatedSince, actorUserId: req.user!.id });
      return sendSuccess(res, summary, "Warehouse provider sync completed.");
    },
  };
}
