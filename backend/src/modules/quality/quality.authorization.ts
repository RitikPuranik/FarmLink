import { AuthenticatedUserContext } from "../auth/auth.types";
import { FpoAuthorizationService } from "../fpo/fpo.authorization";
import { LotAuthorizationService } from "../lots/lot.authorization";
import { CropLotWithRelations } from "../lots/lots.types";

/**
 * Build spec section 56 (authorization matrix), reusing Module 4's own
 * lot-access check rather than re-deriving farm/FPO ownership a third
 * time — "can you touch this lot" already means "can you touch its
 * quality data" for every action except verification (build spec section
 * 55: a lot's own farmer must never be able to verify their own
 * self-assessment, however the general access check would answer).
 *
 * `QUALITY_INSPECTOR` (build spec section 27) is deliberately not a role
 * this checks against yet — it doesn't exist in the current RBAC model
 * (`UserRole` in schema.prisma), and the build spec is explicit: "do not
 * force a breaking role migration without evaluating architecture." When
 * that role is added, only `canVerify` below needs a new branch.
 */
export class QualityAuthorizationService {
  constructor(
    private readonly lotAuthorization: LotAuthorizationService,
    private readonly fpoAuthorization: FpoAuthorizationService,
  ) {}

  /** Create a self-assessment, upload/remove images, run AI, view — the
   * same set of people who can already view/manage the lot itself. */
  async canAccessLot(user: AuthenticatedUserContext, lot: CropLotWithRelations, callerFarmerProfileId: string | null): Promise<boolean> {
    return this.lotAuthorization.canViewLot(user, lot, callerFarmerProfileId);
  }

  /**
   * Build spec section 55/56: never true for the lot's own farmer — a
   * self-assessment can never become VERIFIED by the same person who
   * submitted it, no matter what grade they entered. For an FPO-owned
   * lot, that FPO's own admin may verify (mirrors
   * `LotAuthorizationService.canManageFpoLot`); a platform ADMIN may
   * always verify. A plain farmer-owned lot (no FPO involved) can only be
   * verified by an ADMIN today, since there is no inspector role yet to
   * lean on.
   */
  async canVerify(user: AuthenticatedUserContext, lot: CropLotWithRelations): Promise<boolean> {
    if (user.role === "ADMIN") return true;
    if (lot.ownerType === "FPO" && lot.fpoId) return this.fpoAuthorization.canManageFpo(user, lot.fpoId);
    return false;
  }
}
