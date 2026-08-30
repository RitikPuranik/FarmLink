import { ConflictError, NotFoundError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { FpoAuthorizationService } from "./fpo.authorization";
import { FpoRepository } from "./fpo.repository";
import { toFpoPublicDTO } from "./fpo.types";
import {
  FpoMembershipRepository,
  MembershipListFilters,
  MembershipListResult,
} from "./membership.repository";
import { FpoNotificationHooks } from "./notifications";
import {
  MembershipDTO,
  MemberDirectoryEntryDTO,
  MyFpoDTO,
  toMemberDirectoryEntryDTO,
  toMembershipDTO,
} from "./membership.types";

export interface PaginatedMembers {
  items: MemberDirectoryEntryDTO[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Implements the farmer join -> FPO admin approve/reject/remove workflow
 * (build spec section 15-20/50/93). Every mutation goes through
 * FpoMembershipRepository.transition(), which conditionally applies the
 * state change only if the row is still in an expected starting status —
 * that single primitive is what makes double-approval, double-removal,
 * and racing requests all fail safely with a clear conflict instead of
 * corrupting data.
 */
export class FpoMembershipService {
  constructor(
    private readonly memberships: FpoMembershipRepository,
    private readonly fpoRepo: FpoRepository,
    private readonly farmerProfiles: FarmerProfileResolver,
    private readonly authorization: FpoAuthorizationService,
    private readonly audit: AuditService,
    private readonly notifications: FpoNotificationHooks,
  ) {}

  /**
   * Build spec section 15/53: farmer identity is always derived from the
   * authenticated session (never a client-supplied farmerId), and the FPO
   * is looked up by the publicId in the URL — a client can never target an
   * FPO's internal id directly.
   */
  async requestMembership(userId: string, fpoPublicId: string, meta: RequestMeta): Promise<MembershipDTO> {
    const farmer = await this.farmerProfiles.ensure(userId);

    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    if (fpo.accountStatus !== "ACTIVE") {
      throw new ConflictError("This FPO is not currently accepting new members.");
    }

    const activeElsewhere = await this.memberships.findActiveByFarmerId(farmer.id);
    if (activeElsewhere) {
      // Build spec section 14: a farmer may hold only one ACTIVE primary
      // FPO membership. Enforced here server-side regardless of what the
      // client believes their current membership state is.
      throw new ConflictError("You are already an active member of an FPO.", {
        membership: "ALREADY_ACTIVE_ELSEWHERE",
      });
    }

    // Build spec section 16: duplicate PENDING request for the *same* FPO
    // is a 409, not a second row.
    const existingPending = await this.memberships.findPendingByFarmerAndFpo(farmer.id, fpo.id);
    if (existingPending) {
      throw new ConflictError("A membership request is already pending for this FPO.");
    }

    const membership = await this.memberships.create({ fpoId: fpo.id, farmerId: farmer.id });

    await this.audit.record({
      actorUserId: userId,
      action: "MEMBERSHIP_REQUESTED",
      entityType: "FpoMembership",
      entityId: membership.id,
      metadata: { fpoId: fpo.id },
      ...meta,
    });
    trackEvent("membership_requested", userId, { fpoId: fpo.publicId });
    await this.notifications.notify({
      type: "MEMBERSHIP_REQUESTED",
      membershipId: membership.id,
      fpoId: fpo.id,
      farmerUserId: userId,
    });

    return toMembershipDTO(membership);
  }

  private async loadMembershipOrThrow(membershipPublicId: string) {
    const membership = await this.memberships.findByPublicId(membershipPublicId);
    if (!membership) {
      throw new NotFoundError("Membership request not found.");
    }
    return membership;
  }

  /**
   * Build spec section 17: FPO_ADMIN (of this FPO) or ADMIN only. A farmer
   * approving their own request is impossible here by construction — a
   * FARMER's role is never accepted by FpoAuthorizationService.
   */
  async approveMembership(
    user: AuthenticatedUserContext,
    membershipPublicId: string,
    meta: RequestMeta,
  ): Promise<MembershipDTO> {
    const membership = await this.loadMembershipOrThrow(membershipPublicId);
    await this.authorization.assertCanManageFpo(user, membership.fpoId);

    const fpo = await this.fpoRepo.findById(membership.fpoId);
    if (!fpo || fpo.accountStatus !== "ACTIVE") {
      throw new ConflictError("This FPO is not currently active.");
    }

    // Re-check the one-active-membership rule at approval time too, in
    // case the farmer joined a different FPO between requesting and now.
    const farmerAlreadyActive = await this.memberships.findActiveByFarmerId(membership.farmerId);
    if (farmerAlreadyActive && farmerAlreadyActive.id !== membership.id) {
      throw new ConflictError("This farmer already has an active membership at another FPO.");
    }

    const now = new Date();
    const updated = await this.memberships.transition(membership.id, ["PENDING"], {
      status: "ACTIVE",
      approvedAt: now,
      joinedAt: now,
    });
    if (!updated) {
      // Build spec section 93: repeated/racing approval must not corrupt
      // data — a clear conflict beats a silent no-op here.
      throw new ConflictError("This membership request is no longer pending.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "MEMBERSHIP_APPROVED",
      entityType: "FpoMembership",
      entityId: updated.id,
      metadata: { fpoId: updated.fpoId },
      ...meta,
    });
    trackEvent("membership_approved", user.id, { fpoId: fpo.publicId });
    await this.notifications.notify({
      type: "MEMBERSHIP_APPROVED",
      membershipId: updated.id,
      fpoId: updated.fpoId,
      farmerUserId: membership.farmerId,
    });

    return toMembershipDTO(updated);
  }

  async rejectMembership(
    user: AuthenticatedUserContext,
    membershipPublicId: string,
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<MembershipDTO> {
    const membership = await this.loadMembershipOrThrow(membershipPublicId);
    await this.authorization.assertCanManageFpo(user, membership.fpoId);

    const updated = await this.memberships.transition(membership.id, ["PENDING"], {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionReason: reason ?? null,
    });
    if (!updated) {
      throw new ConflictError("This membership request is no longer pending.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "MEMBERSHIP_REJECTED",
      entityType: "FpoMembership",
      entityId: updated.id,
      metadata: { fpoId: updated.fpoId },
      ...meta,
    });
    trackEvent("membership_rejected", user.id, { fpoId: membership.fpoId });
    await this.notifications.notify({
      type: "MEMBERSHIP_REJECTED",
      membershipId: updated.id,
      fpoId: updated.fpoId,
      farmerUserId: membership.farmerId,
      reason: updated.rejectionReason,
    });

    return toMembershipDTO(updated);
  }

  /** Build spec section 19: never physically delete — ACTIVE -> REMOVED,
   * history stays for auditability. */
  async removeMembership(
    user: AuthenticatedUserContext,
    membershipPublicId: string,
    meta: RequestMeta,
  ): Promise<MembershipDTO> {
    const membership = await this.loadMembershipOrThrow(membershipPublicId);
    await this.authorization.assertCanManageFpo(user, membership.fpoId);

    const updated = await this.memberships.transition(membership.id, ["ACTIVE", "SUSPENDED"], {
      status: "REMOVED",
      removedAt: new Date(),
    });
    if (!updated) {
      // Build spec section 93: removing an already-removed member must not
      // cause unexpected state changes.
      throw new ConflictError("This membership is not currently active.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "MEMBER_REMOVED",
      entityType: "FpoMembership",
      entityId: updated.id,
      metadata: { fpoId: updated.fpoId },
      ...meta,
    });
    await this.notifications.notify({
      type: "MEMBER_REMOVED",
      membershipId: updated.id,
      fpoId: updated.fpoId,
      farmerUserId: membership.farmerId,
    });

    return toMembershipDTO(updated);
  }

  /** Build spec section 20/50: ACTIVE -> SUSPENDED, provided as an explicit
   * admin/FPO-admin-only action. */
  async suspendMembership(
    user: AuthenticatedUserContext,
    membershipPublicId: string,
    meta: RequestMeta,
  ): Promise<MembershipDTO> {
    const membership = await this.loadMembershipOrThrow(membershipPublicId);
    await this.authorization.assertCanManageFpo(user, membership.fpoId);

    const updated = await this.memberships.transition(membership.id, ["ACTIVE"], { status: "SUSPENDED" });
    if (!updated) {
      throw new ConflictError("This membership is not currently active.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "MEMBER_SUSPENDED",
      entityType: "FpoMembership",
      entityId: updated.id,
      metadata: { fpoId: updated.fpoId },
      ...meta,
    });

    return toMembershipDTO(updated);
  }

  /** Build spec section 50: SUSPENDED -> ACTIVE is the one valid way back. */
  async reactivateMembership(
    user: AuthenticatedUserContext,
    membershipPublicId: string,
    meta: RequestMeta,
  ): Promise<MembershipDTO> {
    const membership = await this.loadMembershipOrThrow(membershipPublicId);
    await this.authorization.assertCanManageFpo(user, membership.fpoId);

    const updated = await this.memberships.transition(membership.id, ["SUSPENDED"], { status: "ACTIVE" });
    if (!updated) {
      throw new ConflictError("This membership is not currently suspended.");
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "MEMBERSHIP_APPROVED",
      entityType: "FpoMembership",
      entityId: updated.id,
      metadata: { fpoId: updated.fpoId, reactivated: true },
      ...meta,
    });

    return toMembershipDTO(updated);
  }

  async getMyFpo(userId: string): Promise<MyFpoDTO> {
    const farmer = await this.farmerProfiles.ensure(userId);
    const membership = await this.memberships.findMostRelevantByFarmerId(farmer.id);
    if (!membership) {
      return { hasFpo: false, membership: null, fpo: null };
    }

    const fpo = await this.fpoRepo.findById(membership.fpoId);
    if (!fpo) {
      // Defensive — the FPO row should always exist for a live FK, but
      // never let a dangling reference surface as a 500.
      return { hasFpo: false, membership: null, fpo: null };
    }

    const memberCount = await this.memberships.countActiveByFpoId(fpo.id);
    return {
      hasFpo: membership.status === "ACTIVE",
      membership: toMembershipDTO(membership),
      fpo: toFpoPublicDTO(fpo, memberCount),
    };
  }

  /** Build spec section 25: FPO_ADMIN (own FPO) or ADMIN only — never
   * ordinary farmers, and (per the section 52 authorization matrix) not
   * GOVERNMENT_VIEWER either, since this is the private roster with names
   * and villages, not an aggregate figure. */
  async listMembers(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    filters: Omit<MembershipListFilters, never>,
  ): Promise<PaginatedMembers> {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    await this.authorization.assertCanManageFpo(user, fpo.id);

    const result: MembershipListResult = await this.memberships.listForFpo(fpo.id, filters);
    return {
      items: result.items.map(toMemberDirectoryEntryDTO),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / filters.limit)),
      },
    };
  }
}
