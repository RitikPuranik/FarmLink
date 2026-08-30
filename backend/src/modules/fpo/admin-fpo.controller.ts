import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { FpoService } from "./fpo.service";
import { FpoVerificationService } from "./fpo-verification.service";
import { FpoAdminService } from "./fpo-admin.service";
import { AssignFpoAdminInput, SearchFposQuery, VerifyFpoInput } from "./fpo.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createAdminFpoController(
  fpoService: FpoService,
  verification: FpoVerificationService,
  admins: FpoAdminService,
) {
  async function list(req: Request, res: Response) {
    const query = req.validatedQuery as SearchFposQuery;
    const result = await fpoService.listFposForAdmin(query);
    return sendSuccess(res, result, "FPOs retrieved.");
  }

  async function details(req: Request, res: Response) {
    const fpo = await fpoService.getFpoDetailsForAdmin(req.params.fpoId);
    return sendSuccess(res, { fpo }, "FPO retrieved.");
  }

  async function verify(req: Request, res: Response) {
    const body = req.body as VerifyFpoInput;
    const fpo = await verification.verifyFpo(req.user!, req.params.fpoId, body.verificationNote, meta(req));
    return sendSuccess(res, { fpo }, "FPO verified.");
  }

  async function reject(req: Request, res: Response) {
    const body = req.body as VerifyFpoInput;
    const fpo = await verification.rejectFpo(req.user!, req.params.fpoId, body.verificationNote, meta(req));
    return sendSuccess(res, { fpo }, "FPO verification rejected.");
  }

  async function suspend(req: Request, res: Response) {
    const fpo = await verification.suspendFpo(req.user!, req.params.fpoId, meta(req));
    return sendSuccess(res, { fpo }, "FPO suspended.");
  }

  async function reactivate(req: Request, res: Response) {
    const fpo = await verification.reactivateFpo(req.user!, req.params.fpoId, meta(req));
    return sendSuccess(res, { fpo }, "FPO reactivated.");
  }

  async function listAdmins(req: Request, res: Response) {
    const result = await admins.listAdmins(req.params.fpoId);
    return sendSuccess(res, result, "FPO admins retrieved.");
  }

  async function assignAdmin(req: Request, res: Response) {
    const body = req.body as AssignFpoAdminInput;
    const admin = await admins.assignAdmin(req.user!, req.params.fpoId, body, meta(req));
    return sendSuccess(res, { admin }, "FPO admin assigned.", 201);
  }

  async function removeAdmin(req: Request, res: Response) {
    await admins.removeAdmin(req.user!, req.params.fpoId, req.params.adminId, meta(req));
    return sendSuccess(res, {}, "FPO admin removed.");
  }

  return { list, details, verify, reject, suspend, reactivate, listAdmins, assignAdmin, removeAdmin };
}
