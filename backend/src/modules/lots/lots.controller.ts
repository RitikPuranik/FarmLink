import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { LotsService } from "./lots.service";
import { CreateLotInput, GetLotQuery, ListLotsQuery, UpdateDraftLotInput } from "./lots.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createLotsController(service: LotsService) {
  async function create(req: Request, res: Response) {
    const body = req.body as CreateLotInput;
    const lot = await service.createLot(req.user!, body, meta(req));
    return sendSuccess(res, { lot }, "Lot created successfully.", 201);
  }

  async function listMine(req: Request, res: Response) {
    const query = req.validatedQuery as ListLotsQuery;
    const result = await service.listMyLots(req.user!, query);
    return sendSuccess(res, result, "Lots retrieved.");
  }

  async function listForFpo(req: Request, res: Response) {
    const query = req.validatedQuery as ListLotsQuery;
    const result = await service.listFpoLots(req.user!, req.params.fpoId, query);
    return sendSuccess(res, result, "Lots retrieved.");
  }

  async function getOne(req: Request, res: Response) {
    const query = req.validatedQuery as GetLotQuery;
    const lot = await service.getLot(req.user!, req.params.id, query.unit);
    return sendSuccess(res, { lot }, "Lot retrieved.");
  }

  async function updateDraft(req: Request, res: Response) {
    const body = req.body as UpdateDraftLotInput;
    const lot = await service.updateDraftLot(req.user!, req.params.id, body, meta(req));
    return sendSuccess(res, { lot }, "Lot updated successfully.");
  }

  async function remove(req: Request, res: Response) {
    await service.deleteDraftLot(req.user!, req.params.id, meta(req));
    return sendSuccess(res, null, "Lot deleted successfully.");
  }

  async function publish(req: Request, res: Response) {
    const lot = await service.publishLot(req.user!, req.params.id, meta(req));
    return sendSuccess(res, { lot }, "Lot published successfully.");
  }

  async function cancel(req: Request, res: Response) {
    const lot = await service.cancelLot(req.user!, req.params.id, undefined, meta(req));
    return sendSuccess(res, { lot }, "Lot cancelled successfully.");
  }

  async function history(req: Request, res: Response) {
    const entries = await service.getLotHistory(req.user!, req.params.id);
    return sendSuccess(res, { history: entries }, "Lot history retrieved.");
  }

  async function farmerSummary(req: Request, res: Response) {
    const summary = await service.getFarmerSummary(req.user!);
    return sendSuccess(res, summary, "Lot summary retrieved.");
  }

  return { create, listMine, listForFpo, getOne, updateDraft, remove, publish, cancel, history, farmerSummary };
}
