import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import { NearbyWarehousesQuery, UpdateStorageCapacityBody, WarehouseAvailabilityQuery } from "./warehouse-intelligence.schemas";

export function createWarehouseIntelligenceController(service: WarehouseAvailabilityService) {
  return {
    nearby: async (req: Request, res: Response) => {
      const q = req.validatedQuery as NearbyWarehousesQuery;
      const result = await service.searchNearby(
        {
          latitude: q.latitude,
          longitude: q.longitude,
          radiusKm: q.radiusKm,
          cropId: q.cropId,
          quantity: q.quantity,
          unit: q.unit,
        },
        req.user!,
      );
      return sendSuccess(res, result, "Nearby warehouses retrieved.");
    },

    detail: async (req: Request, res: Response) => {
      const result = await service.getWarehouseDetail(req.params.warehouseId, req.user!);
      return sendSuccess(res, result, "Warehouse retrieved.");
    },

    availability: async (req: Request, res: Response) => {
      const q = req.validatedQuery as WarehouseAvailabilityQuery;
      const result = await service.getStorageAvailability(
        req.params.warehouseId,
        { cropId: q.cropId, quantity: q.quantity, unit: q.unit },
        req.user!,
      );
      return sendSuccess(res, result, "Warehouse availability retrieved.");
    },

    updateCapacity: async (req: Request, res: Response) => {
      const body = req.body as UpdateStorageCapacityBody;
      const result = await service.updateStorageUnitCapacity(
        req.user!,
        req.params.warehouseId,
        req.params.storageUnitId,
        body,
      );
      return sendSuccess(res, result, "Storage capacity updated.");
    },
  };
}
