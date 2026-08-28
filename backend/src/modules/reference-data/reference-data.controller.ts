import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { ReferenceDataService } from "./reference-data.service";
import { ListDistrictsQuery, ListFposQuery, ListTalukasQuery } from "./reference-data.schemas";

export function createReferenceDataController(service: ReferenceDataService) {
  async function languages(_req: Request, res: Response) {
    return sendSuccess(res, { languages: service.listLanguages() }, "Languages retrieved.");
  }

  async function irrigationTypes(_req: Request, res: Response) {
    return sendSuccess(res, { irrigationTypes: service.listIrrigationTypes() }, "Irrigation types retrieved.");
  }

  async function states(_req: Request, res: Response) {
    const data = await service.listStates();
    return sendSuccess(res, { states: data }, "States retrieved.");
  }

  async function districts(req: Request, res: Response) {
    const { stateId } = req.validatedQuery as ListDistrictsQuery;
    const data = await service.listDistricts(stateId);
    return sendSuccess(res, { districts: data }, "Districts retrieved.");
  }

  async function talukas(req: Request, res: Response) {
    const { districtId } = req.validatedQuery as ListTalukasQuery;
    const data = await service.listTalukas(districtId);
    return sendSuccess(res, { talukas: data }, "Talukas retrieved.");
  }

  async function crops(_req: Request, res: Response) {
    const data = await service.listCrops();
    return sendSuccess(res, { crops: data }, "Crops retrieved.");
  }

  async function fpos(req: Request, res: Response) {
    const { districtId } = req.validatedQuery as ListFposQuery;
    const data = await service.listFpos(districtId);
    return sendSuccess(res, { fpos: data }, "FPOs retrieved.");
  }

  return { languages, irrigationTypes, states, districts, talukas, crops, fpos };
}
