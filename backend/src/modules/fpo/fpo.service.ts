import { NotFoundError, ValidationError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { CreateFpoInput, SearchFposQuery } from "./fpo.schemas";
import { FpoAdminRepository } from "./fpo-admin.repository";
import { FpoAuthorizationService } from "./fpo.authorization";
import { FpoRepository } from "./fpo.repository";
import { FpoAdminViewDTO, FpoPublicDTO, toFpoAdminViewDTO, toFpoPublicDTO } from "./fpo.types";
import { FpoMembershipRepository } from "./membership.repository";

export interface PaginatedFposAdmin {
  items: FpoAdminViewDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface PaginatedFpos {
  items: FpoPublicDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Core FPO record service: registration and read (search/details). FPO
 * verification/account-status transitions live in
 * fpo-verification.service.ts, and admin assignment in
 * fpo-admin.service.ts — kept separate per build spec section 78's service
 * responsibility split.
 */
export class FpoService {
  constructor(
    private readonly fpoRepo: FpoRepository,
    private readonly fpoAdmins: FpoAdminRepository,
    private readonly memberships: FpoMembershipRepository,
    private readonly referenceData: ReferenceDataService,
    private readonly authorization: FpoAuthorizationService,
    private readonly audit: AuditService,
  ) {}

  private async assertValidLocation(input: { stateId: string; districtId: string; talukaId?: string }) {
    const { district } = await this.referenceData.assertValidStateDistrict(input);
    if (input.talukaId) {
      await this.referenceData.assertValidTalukaInDistrict(district.id, input.talukaId);
    }
  }

  /**
   * Build spec section 47/48: any authenticated FPO_ADMIN or platform ADMIN
   * may register a new FPO; a fresh FPO always starts PENDING/ACTIVE (never
   * auto-verified). If the creator is themself an FPO_ADMIN, they become
   * that FPO's PRIMARY_ADMIN in the same operation — a platform ADMIN
   * registering on an org's behalf does not auto-assign themselves (they
   * assign the real admin separately via /api/admin/fpos/:fpoId/admins,
   * build spec section 48).
   */
  async createFpo(
    user: AuthenticatedUserContext,
    input: CreateFpoInput,
    meta: RequestMeta,
  ): Promise<FpoAdminViewDTO> {
    if (input.registrationNumber) {
      // Light shape validation only (build spec section 9: "do not claim
      // government verification unless an actual integration exists") —
      // this is not a government registry check, just input hygiene.
      if (input.registrationNumber.trim().length < 3) {
        throw new ValidationError("Please correct the highlighted fields", {
          registrationNumber: "Enter a valid registration number.",
        });
      }
    }

    await this.assertValidLocation(input);

    const fpo = await this.fpoRepo.create({
      name: input.name,
      legalName: input.legalName ?? null,
      registrationNumber: input.registrationNumber ?? null,
      organizationType: input.organizationType,
      phone: input.phone ?? null,
      email: input.email ?? null,
      village: input.village ?? null,
      pincode: input.pincode ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      stateId: input.stateId,
      districtId: input.districtId,
      talukaId: input.talukaId ?? null,
    });

    if (user.role === "FPO_ADMIN") {
      await this.fpoAdmins.create({ fpoId: fpo.id, userId: user.id, role: "PRIMARY_ADMIN" });
      await this.audit.record({
        actorUserId: user.id,
        action: "FPO_ADMIN_ADDED",
        entityType: "Fpo",
        entityId: fpo.id,
        metadata: { userId: user.id, role: "PRIMARY_ADMIN", self: true },
        ...meta,
      });
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "FPO_CREATED",
      entityType: "Fpo",
      entityId: fpo.id,
      metadata: { organizationType: fpo.organizationType, districtId: fpo.districtId },
      ...meta,
    });
    trackEvent("fpo_created", user.id, { organizationType: fpo.organizationType, districtId: fpo.districtId });

    return toFpoAdminViewDTO(fpo, 0);
  }

  async listFpos(filters: SearchFposQuery): Promise<PaginatedFpos> {
    const { items, total } = await this.fpoRepo.search({
      name: filters.name,
      stateId: filters.stateId,
      districtId: filters.districtId,
      stateName: filters.state,
      districtName: filters.district,
      verificationStatus: filters.verificationStatus,
      page: filters.page,
      limit: filters.limit,
    });

    const counts = await this.memberships.countActiveGroupedByFpoIds(items.map((f) => f.id));

    return {
      items: items.map((fpo) => toFpoPublicDTO(fpo, counts[fpo.id] ?? 0)),
      pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.max(1, Math.ceil(total / filters.limit)) },
    };
  }

  /**
   * Build spec section 43: GET /api/admin/fpos — same search filters as the
   * public listing, but every row uses the admin-level DTO (platform ADMIN
   * only, enforced at the route layer).
   */
  async listFposForAdmin(filters: SearchFposQuery): Promise<PaginatedFposAdmin> {
    const { items, total } = await this.fpoRepo.search({
      name: filters.name,
      stateId: filters.stateId,
      districtId: filters.districtId,
      stateName: filters.state,
      districtName: filters.district,
      verificationStatus: filters.verificationStatus,
      page: filters.page,
      limit: filters.limit,
    });
    const counts = await this.memberships.countActiveGroupedByFpoIds(items.map((f) => f.id));
    return {
      items: items.map((fpo) => toFpoAdminViewDTO(fpo, counts[fpo.id] ?? 0)),
      pagination: { page: filters.page, limit: filters.limit, total, totalPages: Math.max(1, Math.ceil(total / filters.limit)) },
    };
  }

  /** Build spec section 43: GET /api/admin/fpos/:fpoId — platform ADMIN
   * always sees the full admin view (role already guaranteed by the route). */
  async getFpoDetailsForAdmin(fpoPublicId: string): Promise<FpoAdminViewDTO> {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    const memberCount = await this.memberships.countActiveByFpoId(fpo.id);
    return toFpoAdminViewDTO(fpo, memberCount);
  }

  /**
   * Build spec section 24: public-safe by default. If the caller can
   * manage this specific FPO (its own FPO_ADMIN, or a platform ADMIN), the
   * richer admin view is returned instead — same endpoint, response shaped
   * to what the caller is allowed to see.
   */
  async getFpoDetails(user: AuthenticatedUserContext, fpoPublicId: string): Promise<FpoPublicDTO | FpoAdminViewDTO> {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }

    const memberCount = await this.memberships.countActiveByFpoId(fpo.id);
    const canManage = await this.authorization.canManageFpo(user, fpo.id);
    return canManage ? toFpoAdminViewDTO(fpo, memberCount) : toFpoPublicDTO(fpo, memberCount);
  }
}
