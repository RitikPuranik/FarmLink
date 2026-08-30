import { ConflictError, NotFoundError } from "../../common/errors";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { FpoRepository } from "./fpo.repository";
import { FpoAdminViewDTO, toFpoAdminViewDTO } from "./fpo.types";
import { FpoMembershipRepository } from "./membership.repository";
import { FpoNotificationHooks } from "./notifications";

/**
 * Admin-only FPO lifecycle transitions (build spec section 43-46/51).
 * Authorization for every method here is `ADMIN` only — enforced at the
 * route layer (Module 1's existing requireRole("ADMIN")), so this service
 * does not re-check role itself, matching how e.g. users.service.ts
 * doesn't either.
 *
 * `verificationStatus` and `accountStatus` are two different questions
 * ("has this org been vetted" vs. "can it be used right now" — see the
 * enums' own comments in schema.prisma) that build spec sections 10 and 51
 * describe slightly differently for the *suspend* action specifically:
 * section 10 ties "normal operations blocked" to accountStatus, while
 * section 51's state machine lists VERIFIED -> SUSPENDED as a
 * verificationStatus transition, and FpoVerificationStatus (section 9)
 * does list SUSPENDED as one of its own values. Read together, an admin
 * "suspend" is a single action that moves both — the FPO stops being
 * usable (accountStatus) *and* its displayed verification standing
 * reflects that (verificationStatus) — and "reactivate" reverses both.
 */
export class FpoVerificationService {
  constructor(
    private readonly fpoRepo: FpoRepository,
    private readonly memberships: FpoMembershipRepository,
    private readonly audit: AuditService,
    private readonly notifications: FpoNotificationHooks,
  ) {}

  private async loadOrThrow(fpoPublicId: string) {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    return fpo;
  }

  private async toDTO(fpoId: string, fpo: Awaited<ReturnType<FpoRepository["findById"]>>) {
    if (!fpo) throw new NotFoundError("FPO not found.");
    const memberCount = await this.memberships.countActiveByFpoId(fpoId);
    return toFpoAdminViewDTO(fpo, memberCount);
  }

  /** PENDING/UNDER_REVIEW -> VERIFIED (build spec section 44/45). */
  async verifyFpo(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    verificationNote: string | undefined,
    meta: RequestMeta,
  ): Promise<FpoAdminViewDTO> {
    const fpo = await this.loadOrThrow(fpoPublicId);
    if (fpo.verificationStatus !== "PENDING" && fpo.verificationStatus !== "UNDER_REVIEW") {
      throw new ConflictError("This FPO is not awaiting verification.");
    }

    const updated = await this.fpoRepo.updateStatus(fpo.id, { verificationStatus: "VERIFIED" });

    await this.audit.record({
      actorUserId: user.id,
      action: "FPO_VERIFIED",
      entityType: "Fpo",
      entityId: fpo.id,
      // Build spec section 45: keep the private admin note out of any
      // farmer-facing FPO response — it only ever lands in the audit log.
      metadata: { verificationNote: verificationNote ?? null },
      ...meta,
    });
    await this.notifications.notify({ type: "FPO_VERIFICATION_COMPLETED", fpoId: fpo.id, verificationStatus: "VERIFIED" });

    return this.toDTO(fpo.id, updated);
  }

  /** PENDING/UNDER_REVIEW -> REJECTED (build spec section 44). */
  async rejectFpo(
    user: AuthenticatedUserContext,
    fpoPublicId: string,
    verificationNote: string | undefined,
    meta: RequestMeta,
  ): Promise<FpoAdminViewDTO> {
    const fpo = await this.loadOrThrow(fpoPublicId);
    if (fpo.verificationStatus !== "PENDING" && fpo.verificationStatus !== "UNDER_REVIEW") {
      throw new ConflictError("This FPO is not awaiting verification.");
    }

    const updated = await this.fpoRepo.updateStatus(fpo.id, { verificationStatus: "REJECTED" });

    await this.audit.record({
      actorUserId: user.id,
      action: "FPO_REJECTED",
      entityType: "Fpo",
      entityId: fpo.id,
      metadata: { verificationNote: verificationNote ?? null },
      ...meta,
    });
    await this.notifications.notify({ type: "FPO_VERIFICATION_COMPLETED", fpoId: fpo.id, verificationStatus: "REJECTED" });

    return this.toDTO(fpo.id, updated);
  }

  /** VERIFIED + ACTIVE -> SUSPENDED (build spec section 10/46/51). */
  async suspendFpo(user: AuthenticatedUserContext, fpoPublicId: string, meta: RequestMeta): Promise<FpoAdminViewDTO> {
    const fpo = await this.loadOrThrow(fpoPublicId);
    if (fpo.accountStatus !== "ACTIVE") {
      throw new ConflictError("This FPO is already suspended or deactivated.");
    }

    const updated = await this.fpoRepo.updateStatus(fpo.id, {
      accountStatus: "SUSPENDED",
      verificationStatus: fpo.verificationStatus === "VERIFIED" ? "SUSPENDED" : fpo.verificationStatus,
      active: false,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "FPO_SUSPENDED",
      entityType: "Fpo",
      entityId: fpo.id,
      ...meta,
    });

    return this.toDTO(fpo.id, updated);
  }

  /** SUSPENDED -> ACTIVE/VERIFIED (build spec section 43/51). */
  async reactivateFpo(user: AuthenticatedUserContext, fpoPublicId: string, meta: RequestMeta): Promise<FpoAdminViewDTO> {
    const fpo = await this.loadOrThrow(fpoPublicId);
    if (fpo.accountStatus !== "SUSPENDED") {
      throw new ConflictError("This FPO is not currently suspended.");
    }

    const updated = await this.fpoRepo.updateStatus(fpo.id, {
      accountStatus: "ACTIVE",
      verificationStatus: fpo.verificationStatus === "SUSPENDED" ? "VERIFIED" : fpo.verificationStatus,
      active: true,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "FPO_REACTIVATED",
      entityType: "Fpo",
      entityId: fpo.id,
      ...meta,
    });

    return this.toDTO(fpo.id, updated);
  }
}
