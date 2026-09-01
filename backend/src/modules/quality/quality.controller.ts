import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { QualityService } from "./quality.service";
import { AddImageInput, CreateAssessmentInput, ListAssessmentsQuery, UpdateAssessmentInput, VerifyAssessmentInput } from "./quality.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createQualityController(service: QualityService) {
  async function create(req: Request, res: Response) {
    const body = req.body as CreateAssessmentInput;
    const assessment = await service.createAssessment(req.user!, req.params.lotPublicId, body, meta(req));
    return sendSuccess(res, { assessment }, "Quality assessment created successfully.", 201);
  }

  async function listForLot(req: Request, res: Response) {
    const query = req.validatedQuery as ListAssessmentsQuery;
    const result = await service.listByLot(req.user!, req.params.lotPublicId, query);
    return sendSuccess(res, result, "Quality assessments retrieved.");
  }

  async function getOne(req: Request, res: Response) {
    const assessment = await service.getAssessment(req.user!, req.params.publicId);
    return sendSuccess(res, { assessment }, "Quality assessment retrieved.");
  }

  async function update(req: Request, res: Response) {
    const body = req.body as UpdateAssessmentInput;
    const assessment = await service.updateAssessment(req.user!, req.params.publicId, body, meta(req));
    return sendSuccess(res, { assessment }, "Quality assessment updated successfully.");
  }

  async function addImage(req: Request, res: Response) {
    const body = req.body as AddImageInput;
    const assessment = await service.addImage(req.user!, req.params.publicId, body, meta(req));
    return sendSuccess(res, { assessment }, "Image added successfully.", 201);
  }

  async function removeImage(req: Request, res: Response) {
    const assessment = await service.removeImage(req.user!, req.params.publicId, req.params.imageId, meta(req));
    return sendSuccess(res, { assessment }, "Image removed successfully.");
  }

  async function analyze(req: Request, res: Response) {
    const assessment = await service.analyzeAssessment(req.user!, req.params.publicId, meta(req));
    return sendSuccess(res, { assessment }, "AI analysis requested.");
  }

  async function retryAnalyze(req: Request, res: Response) {
    const assessment = await service.retryAnalyzeAssessment(req.user!, req.params.publicId, meta(req));
    return sendSuccess(res, { assessment }, "AI analysis retried.");
  }

  async function verify(req: Request, res: Response) {
    const body = req.body as VerifyAssessmentInput;
    const assessment = await service.verifyAssessment(req.user!, req.params.publicId, body, meta(req));
    return sendSuccess(res, { assessment }, "Quality assessment verified successfully.");
  }

  async function lotQualitySummary(req: Request, res: Response) {
    const summary = await service.getLotQualitySummary(req.user!, req.params.lotPublicId);
    return sendSuccess(res, summary, "Lot quality summary retrieved.");
  }

  async function farmerQualitySummary(req: Request, res: Response) {
    const summary = await service.getFarmerQualitySummary(req.user!);
    return sendSuccess(res, summary, "Quality summary retrieved.");
  }

  return { create, listForLot, getOne, update, addImage, removeImage, analyze, retryAnalyze, verify, lotQualitySummary, farmerQualitySummary };
}
