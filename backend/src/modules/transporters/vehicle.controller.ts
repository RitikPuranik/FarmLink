import { Request, Response } from "express";
import { sendSuccess } from "../../common/apiResponse";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { RegisterVehicleInput, UpdateVehicleInput, VehicleService } from "./vehicle.service";

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.get("user-agent") };
}

export class VehicleController {
  constructor(private readonly vehicles: VehicleService) {}

  registerVehicle = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const input = req.body as RegisterVehicleInput;

    const vehicle = await this.vehicles.registerVehicle(user, input, requestMeta(req));
    sendSuccess(res, vehicle, "Vehicle registered successfully", 201);
  };

  getVehicle = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;

    const vehicle = await this.vehicles.getVehicle(user, publicId);
    sendSuccess(res, vehicle);
  };

  listMyVehicles = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { page, limit } = req.validatedQuery as { page: number; limit: number };

    const result = await this.vehicles.listMyVehicles(user, { page, limit });
    sendSuccess(res, result);
  };

  updateVehicle = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const input = req.body as UpdateVehicleInput;

    const vehicle = await this.vehicles.updateVehicle(user, publicId, input, requestMeta(req));
    sendSuccess(res, vehicle, "Vehicle updated successfully");
  };

  updateAvailability = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const { availabilityStatus } = req.body as { availabilityStatus: "AVAILABLE" | "UNAVAILABLE" };

    const vehicle = await this.vehicles.updateAvailability(user, publicId, availabilityStatus, requestMeta(req));
    sendSuccess(res, vehicle, "Vehicle availability updated successfully");
  };

  updateStatus = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const { status } = req.body as { status: "ACTIVE" | "INACTIVE" | "MAINTENANCE" | "SUSPENDED" };

    const vehicle = await this.vehicles.updateStatus(user, publicId, status, requestMeta(req));
    sendSuccess(res, vehicle, "Vehicle status updated successfully");
  };

  setVerificationStatus = async (req: Request, res: Response) => {
    const admin = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;
    const { status } = req.body as { status: "PENDING" | "VERIFIED" | "REJECTED" };

    const vehicle = await this.vehicles.verifyVehicle(admin, publicId, status, requestMeta(req));
    sendSuccess(res, vehicle, "Vehicle verification status updated");
  };
}
