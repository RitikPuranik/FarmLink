import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import { WarehouseSuitabilityService } from "./warehouse-suitability.service";
import { WarehouseSuitabilityAnalysisService } from "./warehouse-risk-analysis.service";
import { WarehouseRecommendationService } from "./warehouse-recommendation.service";
import {
  NearbyWarehousesQuery,
  RecommendWarehousesBody,
  StorageEligibilityQuery,
  SuitabilityAnalysisQuery,
  UpdateStorageCapacityBody,
  UpdateStorageConditionsBody,
  UpsertCropStorageRequirementBody,
  WarehouseAvailabilityQuery,
  WarehouseSuitabilityQuery,
} from "./warehouse-intelligence.schemas";

export function createWarehouseIntelligenceController(
  service: WarehouseAvailabilityService,
  suitabilityService: WarehouseSuitabilityService,
  riskAnalysisService: WarehouseSuitabilityAnalysisService,
  recommendationService: WarehouseRecommendationService,
) {
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

    // -----------------------------------------------------------------
    // Module 9 Part 3 — Storage Conditions, Crop Suitability & Storage
    // Constraints.
    // -----------------------------------------------------------------

    suitability: async (req: Request, res: Response) => {
      const q = req.validatedQuery as WarehouseSuitabilityQuery;
      const result = await suitabilityService.getSuitability(req.params.warehouseId, q.cropId, req.user!);
      return sendSuccess(res, result, "Warehouse storage suitability retrieved.");
    },

    storageEligibility: async (req: Request, res: Response) => {
      const q = req.validatedQuery as StorageEligibilityQuery;
      const result = await suitabilityService.getStorageEligibility(
        req.params.warehouseId,
        { cropId: q.cropId, quantity: q.quantity, unit: q.unit },
        req.user!,
      );
      return sendSuccess(res, result, "Storage eligibility retrieved.");
    },

    updateStorageConditions: async (req: Request, res: Response) => {
      const body = req.body as UpdateStorageConditionsBody;
      const result = await suitabilityService.updateStorageConditions(
        req.user!,
        req.params.warehouseId,
        req.params.storageUnitId,
        body,
      );
      return sendSuccess(res, result, "Storage conditions updated.");
    },

    upsertCropStorageRequirement: async (req: Request, res: Response) => {
      const body = req.body as UpsertCropStorageRequirementBody;
      const result = await suitabilityService.upsertCropStorageRequirement(req.user!, req.params.cropId, body);
      return sendSuccess(res, result, "Crop storage requirement saved.");
    },

    // -----------------------------------------------------------------
    // Module 9 Part 4 — Warehouse Suitability & Risk Analysis.
    // -----------------------------------------------------------------

    suitabilityAnalysis: async (req: Request, res: Response) => {
      const q = req.validatedQuery as SuitabilityAnalysisQuery;
      const result = await riskAnalysisService.analyzeSuitability(
        req.params.warehouseId,
        { cropId: q.cropId, quantity: q.quantity, unit: q.unit, durationDays: q.durationDays },
        req.user!,
      );
      return sendSuccess(res, result, "Warehouse suitability analysis retrieved.");
    },

    // -----------------------------------------------------------------
    // Module 9 Part 5 — Warehouse Recommendation & Ranking Engine.
    // -----------------------------------------------------------------

    recommend: async (req: Request, res: Response) => {
      const body = req.body as RecommendWarehousesBody;
      const result = await recommendationService.recommend(
        {
          cropId: body.cropId,
          latitude: body.latitude,
          longitude: body.longitude,
          radiusKm: body.radiusKm,
          quantity: body.quantity,
          unit: body.unit,
          durationDays: body.durationDays,
        },
        req.user!,
      );
      return sendSuccess(res, result, "Warehouse recommendations generated.");
    },
  };
}
