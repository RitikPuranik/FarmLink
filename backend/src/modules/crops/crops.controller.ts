import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { CropsService } from "./crops.service";
import { AddFarmerCropRequestBody, UpdateFarmerCropRequestBody } from "./crops.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createCropsController(service: CropsService) {
  async function list(req: Request, res: Response) {
    const crops = await service.list(req.user!.id);
    return sendSuccess(res, { crops }, "Crops retrieved.");
  }

  async function add(req: Request, res: Response) {
    const body = req.body as AddFarmerCropRequestBody;
    const crop = await service.add(req.user!.id, body, meta(req));
    return sendSuccess(res, { crop }, "Crop added successfully.", 201);
  }

  async function update(req: Request, res: Response) {
    const body = req.body as UpdateFarmerCropRequestBody;
    const crop = await service.update(req.user!.id, req.params.id, body, meta(req));
    return sendSuccess(res, { crop }, "Crop updated successfully.");
  }

  async function remove(req: Request, res: Response) {
    await service.remove(req.user!.id, req.params.id, meta(req));
    return sendSuccess(res, null, "Crop removed successfully.");
  }

  return { list, add, update, remove };
}
