import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { RequestMeta } from "../auth/auth.types";
import { FpoMembershipService } from "./membership.service";
import { ListMembersQuery, RejectMembershipInput } from "./membership.schemas";

function meta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

export function createMembershipController(service: FpoMembershipService) {
  async function requestMembership(req: Request, res: Response) {
    const membership = await service.requestMembership(req.user!.id, req.params.fpoId, meta(req));
    return sendSuccess(res, { membership }, "Membership request submitted.", 201);
  }

  async function approve(req: Request, res: Response) {
    const membership = await service.approveMembership(req.user!, req.params.membershipId, meta(req));
    return sendSuccess(res, { membership }, "Membership approved.");
  }

  async function reject(req: Request, res: Response) {
    const body = req.body as RejectMembershipInput;
    const membership = await service.rejectMembership(req.user!, req.params.membershipId, body.reason, meta(req));
    return sendSuccess(res, { membership }, "Membership rejected.");
  }

  async function remove(req: Request, res: Response) {
    const membership = await service.removeMembership(req.user!, req.params.membershipId, meta(req));
    return sendSuccess(res, { membership }, "Member removed.");
  }

  async function suspend(req: Request, res: Response) {
    const membership = await service.suspendMembership(req.user!, req.params.membershipId, meta(req));
    return sendSuccess(res, { membership }, "Membership suspended.");
  }

  async function reactivate(req: Request, res: Response) {
    const membership = await service.reactivateMembership(req.user!, req.params.membershipId, meta(req));
    return sendSuccess(res, { membership }, "Membership reactivated.");
  }

  async function getMyFpo(req: Request, res: Response) {
    const result = await service.getMyFpo(req.user!.id);
    return sendSuccess(res, result, "FPO membership retrieved.");
  }

  async function listMembers(req: Request, res: Response) {
    const query = req.validatedQuery as ListMembersQuery;
    const result = await service.listMembers(req.user!, req.params.fpoId, query);
    return sendSuccess(res, result, "Members retrieved.");
  }

  return { requestMembership, approve, reject, remove, suspend, reactivate, getMyFpo, listMembers };
}
