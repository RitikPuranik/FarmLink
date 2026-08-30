import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { FpoAggregationService } from "./aggregation.service";
import { CreateAggregationGroupInput, UpdateAggregationGroupInput } from "./aggregation.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createAggregationController(service: FpoAggregationService) {
  async function getCropAggregation(req: Request, res: Response) {
    const rows = await service.getCropAggregation(req.user!, req.params.fpoId);
    return sendSuccess(res, rows, "Crop aggregation retrieved.");
  }

  async function getCropAggregationMembers(req: Request, res: Response) {
    const rows = await service.getCropAggregationMembers(req.user!, req.params.fpoId, req.params.cropId);
    return sendSuccess(res, rows, "Crop aggregation breakdown retrieved.");
  }

  async function createAggregationGroup(req: Request, res: Response) {
    const body = req.body as CreateAggregationGroupInput;
    const group = await service.createAggregationGroup(req.user!, req.params.fpoId, body, meta(req));
    return sendSuccess(res, { aggregationGroup: group }, "Aggregation target created.", 201);
  }

  async function listAggregationGroups(req: Request, res: Response) {
    const query = req.validatedQuery as { cropId?: string; status?: "DRAFT" | "OPEN" | "READY" | "CLOSED" | "CANCELLED" };
    const groups = await service.listAggregationGroups(req.user!, req.params.fpoId, query);
    return sendSuccess(res, groups, "Aggregation targets retrieved.");
  }

  async function getAggregationGroup(req: Request, res: Response) {
    const group = await service.getAggregationGroup(req.user!, req.params.fpoId, req.params.aggregationId);
    return sendSuccess(res, { aggregationGroup: group }, "Aggregation target retrieved.");
  }

  async function updateAggregationGroup(req: Request, res: Response) {
    const body = req.body as UpdateAggregationGroupInput;
    const group = await service.updateAggregationGroup(req.user!, req.params.fpoId, req.params.aggregationId, body, meta(req));
    return sendSuccess(res, { aggregationGroup: group }, "Aggregation target updated.");
  }

  async function cancelAggregationGroup(req: Request, res: Response) {
    const group = await service.cancelAggregationGroup(req.user!, req.params.fpoId, req.params.aggregationId, meta(req));
    return sendSuccess(res, { aggregationGroup: group }, "Aggregation target cancelled.");
  }

  async function getAnalyticsOverview(req: Request, res: Response) {
    const analytics = await service.getAnalyticsOverview(req.user!, req.params.fpoId);
    return sendSuccess(res, analytics, "Analytics retrieved.");
  }

  return {
    getCropAggregation,
    getCropAggregationMembers,
    createAggregationGroup,
    listAggregationGroups,
    getAggregationGroup,
    updateAggregationGroup,
    cancelAggregationGroup,
    getAnalyticsOverview,
  };
}
