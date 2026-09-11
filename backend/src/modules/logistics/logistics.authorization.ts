import { LogisticsDomainError, NotFoundError } from "../../common/errors";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { FpoAuthorizationService } from "../fpo/fpo.authorization";
import { LogisticsRequestRecord } from "./logistics.types";

/**
 * Step 6/7/15 — who can create/view/manage a LogisticsRequest, and who can
 * submit/manage a LogisticsQuote against it. Ownership is never re-derived
 * from the request body (a lotId/transporterId/vehicleId from the client
 * is never trusted on its own) — every check here resolves the caller's
 * own identity first, same convention as LotAuthorizationService /
 * TransporterAuthorizationService.
 */
export class LogisticsAuthorizationService {
  constructor(private readonly fpoAuthorization: FpoAuthorizationService) {}

  /** Step 6 — FARMER may create for own lots; FPO_ADMIN for authorized FPO
   * lots; ADMIN for any. TRANSPORTER must never create a farmer logistics
   * request (enforced at the router via requireAnyRole, this is the
   * service-level backstop). */
  async canCreateForLot(
    user: AuthenticatedUserContext,
    lot: { ownerType: "FARMER" | "FPO"; farmerId: string | null; fpoId: string | null },
    callerFarmerProfileId: string | null,
  ): Promise<boolean> {
    if (user.role === "ADMIN") return true;
    if (user.role === "TRANSPORTER") return false;

    if (lot.ownerType === "FARMER") {
      return callerFarmerProfileId !== null && lot.farmerId === callerFarmerProfileId;
    }
    if (lot.fpoId) return this.fpoAuthorization.canManageFpo(user, lot.fpoId);
    return false;
  }

  /** Step 6 — the requester (or their FPO's other admins/ADMIN) may view/
   * manage their own request. */
  async canManageRequest(
    user: AuthenticatedUserContext,
    request: LogisticsRequestRecord,
    lot: { ownerType: "FARMER" | "FPO"; farmerId: string | null; fpoId: string | null },
    callerFarmerProfileId: string | null,
  ): Promise<boolean> {
    if (user.role === "ADMIN") return true;
    if (request.requesterUserId === user.id) return true;
    // An FPO admin other than the original requester can still manage a
    // request raised for their own FPO's lot (mirrors LotAuthorizationService's
    // own FPO-wide, not just-the-creator, visibility).
    if (lot.ownerType === "FPO" && lot.fpoId) return this.fpoAuthorization.canManageFpo(user, lot.fpoId);
    return false;
  }

  /** Step 7 — a TRANSPORTER may view a request's shape (pickup/destination/
   * quantity/deadline) to decide whether to quote on it while it is still
   * OPEN, or once they already have a quote against it (to track their own
   * submission's status). */
  canViewAsTransporter(request: LogisticsRequestRecord, hasOwnQuote: boolean): boolean {
    return request.status === "OPEN" || hasOwnQuote;
  }

  /** Step 7/15 — only the provider owning a quote may modify/withdraw it;
   * ADMIN may always act. Never trusts a providerId in the request body. */
  assertOwnsQuoteProvider(
    user: AuthenticatedUserContext,
    quoteTransportProviderId: string,
    callerTransporterProfileId: string | null,
  ): void {
    if (user.role === "ADMIN") return;
    if (callerTransporterProfileId && callerTransporterProfileId === quoteTransportProviderId) return;
    throw new LogisticsDomainError(
      "You do not have permission to manage this quote.",
      "UNAUTHORIZED_QUOTE_ACCESS",
      403,
    );
  }

  /** Step 6/11 — only the requester (or their FPO's admins) or ADMIN may
   * accept/reject/cancel a request or its quotes. */
  assertCanDecide(
    user: AuthenticatedUserContext,
    request: LogisticsRequestRecord,
    canManage: boolean,
  ): void {
    if (!canManage) {
      throw new LogisticsDomainError(
        "You do not have permission to manage this logistics request.",
        "UNAUTHORIZED_QUOTE_ACCESS",
        403,
      );
    }
  }

  requireFound<T>(value: T | null, message: string): T {
    if (value === null) throw new NotFoundError(message);
    return value;
  }
}
