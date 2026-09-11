import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import {
  CreateLogisticsRequestInput,
  ListLogisticsRequestsInput,
  LogisticsRequestService,
  UpdateLogisticsRequestInput,
} from "./logistics-request.service";

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.get("user-agent") };
}

/** Maps the flat Zod body shape (createLogisticsRequestBody in
 * logistics.schemas.ts) into the nested LocationInput the service expects. */
function toCreateInput(body: any): CreateLogisticsRequestInput {
  return {
    lotId: body.lotId,
    requiredQuantityValue: body.requiredQuantityValue,
    requiredQuantityUnit: body.requiredQuantityUnit,
    pickup: body.pickup,
    destination: body.destination,
    requestedPickupAt: body.requestedPickupAt,
    deliveryDeadline: body.deliveryDeadline,
    requiredCapabilities: body.requiredCapabilities,
    requiresRefrigeration: body.requiresRefrigeration,
    specialInstructions: body.specialInstructions,
  };
}

function toUpdateInput(body: any): UpdateLogisticsRequestInput {
  return {
    pickup: body.pickup,
    destination: body.destination,
    requestedPickupAt: body.requestedPickupAt,
    deliveryDeadline: body.deliveryDeadline,
    requiredCapabilities: body.requiredCapabilities,
    requiresRefrigeration: body.requiresRefrigeration,
    specialInstructions: body.specialInstructions,
  };
}

export class LogisticsRequestController {
  constructor(private readonly requests: LogisticsRequestService) {}

  createRequest = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const result = await this.requests.createRequest(user, toCreateInput(req.body), requestMeta(req));
    sendSuccess(res, result, "Logistics request created successfully", 201);
  };

  getRequest = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.requests.getRequest(user, publicId);
    sendSuccess(res, result);
  };

  listRequests = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const query = req.validatedQuery as ListLogisticsRequestsInput;
    const result = await this.requests.listRequests(user, query);
    sendSuccess(res, result);
  };

  updateRequest = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.requests.updateRequest(user, publicId, toUpdateInput(req.body), requestMeta(req));
    sendSuccess(res, result, "Logistics request updated successfully");
  };

  cancelRequest = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const { reason } = req.body as { reason?: string };
    const result = await this.requests.cancelRequest(user, publicId, reason, requestMeta(req));
    sendSuccess(res, result, "Logistics request cancelled successfully");
  };

  calculateEstimate = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.requests.calculateEstimate(user, publicId, requestMeta(req));
    sendSuccess(res, result, "Estimate calculated successfully");
  };

  listAvailableProviders = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.requests.listAvailableProviders(user, publicId);
    sendSuccess(res, { providers: result, count: result.length });
  };

  optimize = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const result = await this.requests.optimize(user, publicId, requestMeta(req));
    sendSuccess(res, result, "Optimization completed successfully");
  };
}
