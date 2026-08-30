import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { CreateFpoInput, SearchFposQuery } from "./fpo.schemas";
import { FpoService } from "./fpo.service";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createFpoController(service: FpoService) {
  async function create(req: Request, res: Response) {
    const body = req.body as CreateFpoInput;
    const fpo = await service.createFpo(req.user!, body, meta(req));
    return sendSuccess(res, { fpo }, "FPO registered.", 201);
  }

  async function list(req: Request, res: Response) {
    const query = req.validatedQuery as SearchFposQuery;
    const result = await service.listFpos(query);
    return sendSuccess(res, result, "FPOs retrieved.");
  }

  async function details(req: Request, res: Response) {
    const fpo = await service.getFpoDetails(req.user!, req.params.fpoId);
    return sendSuccess(res, { fpo }, "FPO retrieved.");
  }

  return { create, list, details };
}
