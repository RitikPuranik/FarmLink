import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { FarmsService } from "./farms.service";
import { CreateFarmRequestBody, UpdateFarmRequestBody } from "./farms.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createFarmsController(service: FarmsService) {
  async function list(req: Request, res: Response) {
    const farms = await service.list(req.user!.id);
    return sendSuccess(res, { farms }, "Farms retrieved.");
  }

  async function getOne(req: Request, res: Response) {
    const farm = await service.get(req.user!.id, req.params.id);
    return sendSuccess(res, { farm }, "Farm retrieved.");
  }

  async function create(req: Request, res: Response) {
    const body = req.body as CreateFarmRequestBody;
    const farm = await service.create(req.user!.id, body, meta(req));
    return sendSuccess(res, { farm }, "Farm created successfully.", 201);
  }

  async function update(req: Request, res: Response) {
    const body = req.body as UpdateFarmRequestBody;
    const farm = await service.update(req.user!.id, req.params.id, body, meta(req));
    return sendSuccess(res, { farm }, "Farm updated successfully.");
  }

  async function remove(req: Request, res: Response) {
    await service.remove(req.user!.id, req.params.id, meta(req));
    return sendSuccess(res, null, "Farm deleted successfully.");
  }

  return { list, getOne, create, update, remove };
}
