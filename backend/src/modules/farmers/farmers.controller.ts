import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { FarmersService } from "./farmers.service";
import { FarmerProfileRequestBody } from "./farmers.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createFarmersController(service: FarmersService) {
  async function getMe(req: Request, res: Response) {
    const data = await service.getMyAggregate(req.user!.id);
    return sendSuccess(res, data, "Farmer profile retrieved.");
  }

  async function createProfile(req: Request, res: Response) {
    const body = req.body as FarmerProfileRequestBody;
    const data = await service.createProfile(req.user!.id, body, meta(req));
    return sendSuccess(res, data, "Farmer profile created.", 201);
  }

  async function updateProfile(req: Request, res: Response) {
    const body = req.body as FarmerProfileRequestBody;
    const data = await service.updateProfile(req.user!.id, body, meta(req));
    return sendSuccess(res, data, "Farmer profile updated.");
  }

  async function completion(req: Request, res: Response) {
    const data = await service.getCompletion(req.user!.id);
    return sendSuccess(res, data, "Profile completion retrieved.");
  }

  return { getMe, createProfile, updateProfile, completion };
}
