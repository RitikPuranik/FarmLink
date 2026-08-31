import { AuthenticatedUserContext } from "../auth/auth.types";
import { FpoAuthorizationService } from "../fpo/fpo.authorization";
import { CropLotWithRelations } from "./lots.types";

/**
 * Build spec section 76/94: who can see/touch a given lot. Ownership is
 * never re-derived from the request (build spec section 49/50) — every
 * caller here passes in a `callerFarmerProfileId` the service already
 * resolved from the authenticated session (see
 * modules/farmers/farmer-profile.resolver.ts), never from req.body.
 */
export class LotAuthorizationService {
  constructor(private readonly fpoAuthorization: FpoAuthorizationService) {}

  async canViewLot(
    user: AuthenticatedUserContext,
    lot: CropLotWithRelations,
    callerFarmerProfileId: string | null,
  ): Promise<boolean> {
    if (user.role === "ADMIN") return true;

    if (lot.ownerType === "FARMER") {
      return callerFarmerProfileId !== null && lot.farmerId === callerFarmerProfileId;
    }

    // FPO-owned lot (build spec section 23/76): visible to admins of that
    // specific FPO — never to an admin of a different FPO, and never
    // simply because the caller holds role FPO_ADMIN somewhere.
    if (lot.fpoId) return this.fpoAuthorization.canManageFpo(user, lot.fpoId);

    return false;
  }

  async canModifyLot(
    user: AuthenticatedUserContext,
    lot: CropLotWithRelations,
    callerFarmerProfileId: string | null,
  ): Promise<boolean> {
    // Build spec section 49/74/75: for Module 4 there is no "can view but
    // not edit" tier for a lot's own owner — modify rights mirror view
    // rights. State (DRAFT-only for edits, cancellable-only for cancel) is
    // enforced separately in lots.service.ts / lot-status.service.ts.
    return this.canViewLot(user, lot, callerFarmerProfileId);
  }

  /** Build spec section 14/50: used before an FPO admin creates a new
   * FPO-owned lot, i.e. before any CropLot row exists to check ownership
   * against. */
  async canManageFpoLot(user: AuthenticatedUserContext, fpoId: string): Promise<boolean> {
    return this.fpoAuthorization.canManageFpo(user, fpoId);
  }
}
