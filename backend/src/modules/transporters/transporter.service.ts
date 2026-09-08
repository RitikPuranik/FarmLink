import { ServiceAreaType, TransporterVerificationStatus } from "@prisma/client";
import { ConflictError, NotFoundError, TransporterDomainError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { TransporterAuthorizationService } from "./transporter.authorization";
import { TransporterRepository, TransporterSearchFilters } from "./transporter.repository";
import { TransporterServiceAreaRepository } from "./transporter-service-area.repository";
import {
  TransporterAdminViewDTO,
  TransporterPublicDTO,
  ServiceAreaDTO,
  toServiceAreaDTO,
  toTransporterAdminViewDTO,
  toTransporterPublicDTO,
} from "./transporter.types";
import { VehicleRepository } from "./vehicle.repository";

export interface CreateTransporterProfileInput {
  businessName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export type UpdateTransporterProfileInput = CreateTransporterProfileInput;

export interface AddServiceAreaInput {
  areaType: ServiceAreaType;
  state?: string;
  district?: string;
  city?: string;
  pincode?: string;
}

export interface ListTransportersQuery {
  page: number;
  limit: number;
  state?: string;
  district?: string;
  vehicleType?: import("@prisma/client").VehicleType;
  minimumCapacityKg?: number;
  refrigerated?: boolean;
  availabilityStatus?: import("@prisma/client").VehicleAvailabilityStatus;
  verified?: boolean;
}

export interface PaginatedTransporters {
  items: TransporterPublicDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** PENDING -> VERIFIED/REJECTED, VERIFIED -> SUSPENDED, SUSPENDED -> VERIFIED
 * (Part I). Every other transition (including REJECTED -> anything) is
 * deliberately absent — a rejected transporter must re-apply as a new
 * profile action, not be silently un-rejected. */
const ALLOWED_TRANSITIONS: Record<TransporterVerificationStatus, TransporterVerificationStatus[]> = {
  PENDING: ["VERIFIED", "REJECTED"],
  VERIFIED: ["SUSPENDED"],
  REJECTED: [],
  SUSPENDED: ["VERIFIED"],
};

export class TransporterService {
  constructor(
    private readonly transporters: TransporterRepository,
    private readonly serviceAreas: TransporterServiceAreaRepository,
    private readonly vehicles: VehicleRepository,
    private readonly authorization: TransporterAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async toPublicDTO(profile: Awaited<ReturnType<TransporterRepository["findById"]>>): Promise<TransporterPublicDTO> {
    if (!profile) throw new NotFoundError("Transporter not found.");
    const [areas, vehicleCount] = await Promise.all([
      this.serviceAreas.listByTransporter(profile.id),
      this.transporters.countVehicles(profile.id),
    ]);
    return toTransporterPublicDTO(profile, areas, vehicleCount);
  }

  private async toAdminViewDTO(
    profile: Awaited<ReturnType<TransporterRepository["findById"]>>,
  ): Promise<TransporterAdminViewDTO> {
    if (!profile) throw new NotFoundError("Transporter not found.");
    const [areas, vehicleCount] = await Promise.all([
      this.serviceAreas.listByTransporter(profile.id),
      this.transporters.countVehicles(profile.id),
    ]);
    return toTransporterAdminViewDTO(profile, areas, vehicleCount);
  }

  /** Part K/L — any authenticated TRANSPORTER may create their own
   * profile, once. Always starts PENDING (never auto-verified — Part I). */
  async createProfile(
    user: AuthenticatedUserContext,
    input: CreateTransporterProfileInput,
    meta: RequestMeta,
  ): Promise<TransporterAdminViewDTO> {
    const existing = await this.transporters.findByUserId(user.id);
    if (existing) {
      throw new ConflictError("A transporter profile already exists for this account.");
    }

    const profile = await this.transporters.create({
      userId: user.id,
      businessName: input.businessName ?? null,
      contactName: input.contactName ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "TRANSPORTER_PROFILE_CREATED",
      entityType: "TransporterProfile",
      entityId: profile.id,
      metadata: {},
      ...meta,
    });
    trackEvent("transporter_profile_created", user.id, {});

    return this.toAdminViewDTO(profile);
  }

  async getMyProfile(user: AuthenticatedUserContext): Promise<TransporterAdminViewDTO> {
    const profile = await this.authorization.resolveOwnProfile(user);
    return this.toAdminViewDTO(profile);
  }

  async getByPublicId(publicId: string): Promise<TransporterPublicDTO> {
    const profile = await this.transporters.findByPublicId(publicId);
    if (!profile) throw new NotFoundError("Transporter not found.");
    return this.toPublicDTO(profile);
  }

  async updateMyProfile(
    user: AuthenticatedUserContext,
    input: UpdateTransporterProfileInput,
    meta: RequestMeta,
  ): Promise<TransporterAdminViewDTO> {
    const profile = await this.authorization.resolveOwnProfile(user);

    const updated = await this.transporters.updateProfile(profile.id, {
      ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "TRANSPORTER_PROFILE_UPDATED",
      entityType: "TransporterProfile",
      entityId: profile.id,
      metadata: {},
      ...meta,
    });

    return this.toAdminViewDTO(updated);
  }

  /**
   * Part N — Transporter Discovery. Pure filtering, never ranking/pricing:
   * vehicle-level filters (type/capacity/refrigerated/availability/
   * verification) narrow to a set of transporterIds via VehicleRepository,
   * which is then intersected with transporter-level filters
   * (state/district/verified) in a single paginated query.
   */
  async listTransporters(query: ListTransportersQuery): Promise<PaginatedTransporters> {
    const hasVehicleFilter =
      query.vehicleType !== undefined ||
      query.minimumCapacityKg !== undefined ||
      query.refrigerated !== undefined ||
      query.availabilityStatus !== undefined;

    let transporterIds: string[] | undefined;
    if (hasVehicleFilter) {
      transporterIds = await this.vehicles.discover({
        vehicleType: query.vehicleType,
        minimumCapacityKg: query.minimumCapacityKg,
        refrigerated: query.refrigerated,
        availabilityStatus: query.availabilityStatus,
      });
      // No vehicle anywhere matches — short-circuit rather than let an
      // empty `id: { in: [] }` silently behave like "no filter" would.
      if (transporterIds.length === 0) {
        return { items: [], pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 } };
      }
    }

    const filters: TransporterSearchFilters = {
      state: query.state,
      district: query.district,
      isActive: true,
      verificationStatus: query.verified ? "VERIFIED" : undefined,
      transporterIds,
      page: query.page,
      limit: query.limit,
    };

    const { items, total } = await this.transporters.search(filters);
    const ids = items.map((t) => t.id);
    const [areasByTransporter, vehicleCounts] = await Promise.all([
      this.transporters.listServiceAreasForMany(ids),
      this.transporters.countVehiclesForMany(ids),
    ]);

    return {
      items: items.map((t) => toTransporterPublicDTO(t, areasByTransporter[t.id] ?? [], vehicleCounts[t.id] ?? 0)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Admin-only (enforced by requireRole("ADMIN") at the router) —
   * PENDING/VERIFIED/SUSPENDED -> target, following ALLOWED_TRANSITIONS. */
  async setVerificationStatus(
    admin: AuthenticatedUserContext,
    publicId: string,
    target: TransporterVerificationStatus,
    meta: RequestMeta,
  ): Promise<TransporterAdminViewDTO> {
    const profile = await this.transporters.findByPublicId(publicId);
    if (!profile) throw new NotFoundError("Transporter not found.");

    if (!ALLOWED_TRANSITIONS[profile.verificationStatus].includes(target)) {
      throw new TransporterDomainError(
        `Cannot move a transporter from ${profile.verificationStatus} to ${target}.`,
        "INVALID_VERIFICATION_TRANSITION",
        409,
      );
    }

    const updated = await this.transporters.updateVerificationStatus(profile.id, target);

    const actionByTarget: Record<string, "TRANSPORTER_VERIFIED" | "TRANSPORTER_REJECTED" | "TRANSPORTER_SUSPENDED" | "TRANSPORTER_REACTIVATED"> = {
      VERIFIED: profile.verificationStatus === "SUSPENDED" ? "TRANSPORTER_REACTIVATED" : "TRANSPORTER_VERIFIED",
      REJECTED: "TRANSPORTER_REJECTED",
      SUSPENDED: "TRANSPORTER_SUSPENDED",
    };
    const action = actionByTarget[target];

    await this.audit.record({
      actorUserId: admin.id,
      action,
      entityType: "TransporterProfile",
      entityId: profile.id,
      metadata: { from: profile.verificationStatus, to: target },
      ...meta,
    });

    if (target === "VERIFIED") trackEvent("transporter_verified", admin.id, {});
    if (target === "SUSPENDED") trackEvent("transporter_suspended", admin.id, {});

    return this.toAdminViewDTO(updated);
  }

  // ---------------------------------------------------------------------
  // Service areas (Part F)
  // ---------------------------------------------------------------------

  private assertValidHierarchy(input: AddServiceAreaInput): void {
    const fail = (message: string) => {
      throw new TransporterDomainError(message, "INVALID_SERVICE_AREA");
    };

    switch (input.areaType) {
      case "STATE":
        if (!input.state) fail("A state-level service area requires state.");
        break;
      case "DISTRICT":
        if (!input.state || !input.district) fail("A district-level service area requires state and district.");
        break;
      case "CITY":
        if (!input.state || !input.district || !input.city) {
          fail("A city-level service area requires state, district, and city.");
        }
        break;
      case "PINCODE":
        if (!input.pincode) fail("A pincode-level service area requires a pincode.");
        break;
    }
  }

  private isDuplicateArea(existing: { areaType: ServiceAreaType; state: string | null; district: string | null; city: string | null; pincode: string | null }, input: AddServiceAreaInput): boolean {
    return (
      existing.areaType === input.areaType &&
      (existing.state ?? null) === (input.state ?? null) &&
      (existing.district ?? null) === (input.district ?? null) &&
      (existing.city ?? null) === (input.city ?? null) &&
      (existing.pincode ?? null) === (input.pincode ?? null)
    );
  }

  async addServiceArea(
    user: AuthenticatedUserContext,
    input: AddServiceAreaInput,
    meta: RequestMeta,
  ): Promise<ServiceAreaDTO> {
    this.assertValidHierarchy(input);
    const profile = await this.authorization.resolveOwnProfile(user);

    const existingAreas = await this.serviceAreas.listByTransporter(profile.id);
    if (existingAreas.some((a) => this.isDuplicateArea(a, input))) {
      throw new ConflictError("This service area has already been added.");
    }

    const created = await this.serviceAreas.create({
      transporterId: profile.id,
      areaType: input.areaType,
      state: input.state ?? null,
      district: input.district ?? null,
      city: input.city ?? null,
      pincode: input.pincode ?? null,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "SERVICE_AREA_ADDED",
      entityType: "TransporterServiceArea",
      entityId: created.id,
      metadata: { areaType: created.areaType },
      ...meta,
    });

    return toServiceAreaDTO(created);
  }

  async listMyServiceAreas(user: AuthenticatedUserContext): Promise<ServiceAreaDTO[]> {
    const profile = await this.authorization.resolveOwnProfile(user);
    const areas = await this.serviceAreas.listByTransporter(profile.id);
    return areas.map(toServiceAreaDTO);
  }

  async removeServiceArea(user: AuthenticatedUserContext, id: string, meta: RequestMeta): Promise<void> {
    const profile = await this.authorization.resolveOwnProfile(user);
    const area = await this.serviceAreas.findById(id);
    if (!area || area.transporterId !== profile.id) {
      throw new NotFoundError("Service area not found.");
    }

    await this.serviceAreas.remove(id);

    await this.audit.record({
      actorUserId: user.id,
      action: "SERVICE_AREA_REMOVED",
      entityType: "TransporterServiceArea",
      entityId: id,
      metadata: { areaType: area.areaType },
      ...meta,
    });
  }
}
