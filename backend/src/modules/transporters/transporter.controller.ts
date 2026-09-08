import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { convertQuantityToKg } from "../fpo/unit-conversion";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import {
  AddServiceAreaInput,
  CreateTransporterProfileInput,
  ListTransportersQuery,
  TransporterService,
} from "./transporter.service";

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.get("user-agent") };
}

export class TransporterController {
  constructor(private readonly transporters: TransporterService) {}

  createProfile = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const input = req.body as CreateTransporterProfileInput;

    const profile = await this.transporters.createProfile(user, input, requestMeta(req));
    sendSuccess(res, profile, "Transporter profile created successfully", 201);
  };

  getMyProfile = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const profile = await this.transporters.getMyProfile(user);
    sendSuccess(res, profile);
  };

  updateMyProfile = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const input = req.body as CreateTransporterProfileInput;

    const profile = await this.transporters.updateMyProfile(user, input, requestMeta(req));
    sendSuccess(res, profile, "Transporter profile updated successfully");
  };

  getByPublicId = async (req: Request, res: Response) => {
    const { publicId } = req.params;
    const profile = await this.transporters.getByPublicId(publicId);
    sendSuccess(res, profile);
  };

  listTransporters = async (req: Request, res: Response) => {
    const q = req.validatedQuery as {
      page: number;
      limit: number;
      state?: string;
      district?: string;
      providerType?: ListTransportersQuery["providerType"];
      vehicleType?: ListTransportersQuery["vehicleType"];
      minimumCapacity?: number;
      minimumCapacityUnit: "KG" | "QTL" | "TONNE";
      refrigerated?: "true" | "false";
      availability?: "AVAILABLE" | "UNAVAILABLE";
      verified?: "true" | "false";
    };

    // The query gives capacity in the caller's chosen unit; the repository
    // filters against the canonical KG column, so convert once here rather
    // than teach the repository about display units (Part E convention).
    const minimumCapacityKg =
      q.minimumCapacity !== undefined ? convertQuantityToKg(q.minimumCapacity, q.minimumCapacityUnit) : undefined;

    const result = await this.transporters.listTransporters({
      page: q.page,
      limit: q.limit,
      state: q.state,
      district: q.district,
      providerType: q.providerType,
      vehicleType: q.vehicleType,
      minimumCapacityKg,
      refrigerated: q.refrigerated === undefined ? undefined : q.refrigerated === "true",
      availabilityStatus: q.availability,
      verified: q.verified === undefined ? undefined : q.verified === "true",
    });

    sendSuccess(res, result);
  };

  setVerificationStatus = async (req: Request, res: Response) => {
    const admin = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const { status } = req.body as { status: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED" };

    const profile = await this.transporters.setVerificationStatus(admin, publicId, status, requestMeta(req));
    sendSuccess(res, profile, "Transporter verification status updated");
  };

  addServiceArea = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const input = req.body as AddServiceAreaInput;

    const area = await this.transporters.addServiceArea(user, input, requestMeta(req));
    sendSuccess(res, area, "Service area added successfully", 201);
  };

  listMyServiceAreas = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const areas = await this.transporters.listMyServiceAreas(user);
    sendSuccess(res, areas);
  };

  removeServiceArea = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { id } = req.params;

    await this.transporters.removeServiceArea(user, id, requestMeta(req));
    sendSuccess(res, null, "Service area removed successfully");
  };
}
