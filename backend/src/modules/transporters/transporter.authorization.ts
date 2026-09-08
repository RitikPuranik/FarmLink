import { NotFoundError, TransporterDomainError } from "../../common/errors";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { TransporterRepository } from "./transporter.repository";
import { TransporterProfileRecord } from "./transporter.types";

/**
 * Part O — Authorization. A transporterId/vehicleId/userId from the client
 * is never trusted on its own: every owner-scoped action resolves the
 * caller's own TransporterProfile first (never accepts a transporterId in
 * the request body/params for "my" endpoints) and every admin action still
 * goes through requireRole("ADMIN") at the router.
 */
export class TransporterAuthorizationService {
  constructor(private readonly transporters: TransporterRepository) {}

  /** Resolves the authenticated user's own TransporterProfile, or throws
   * NotFoundError if they don't have one yet (mirrors FarmerProfileResolver's
   * shape for the equivalent "must already exist" case). */
  async resolveOwnProfile(user: AuthenticatedUserContext): Promise<TransporterProfileRecord> {
    const profile = await this.transporters.findByUserId(user.id);
    if (!profile) {
      throw new NotFoundError("Transporter profile not found. Create one first.");
    }
    return profile;
  }

  /** A transporter may only manage their own profile/vehicles/service
   * areas; ADMIN may manage any (for verification/suspension actions only —
   * see transporter.service.ts, which still gates those behind
   * requireRole("ADMIN") at the router, not this check alone). */
  assertOwnsProfile(user: AuthenticatedUserContext, profile: TransporterProfileRecord): void {
    if (user.role === "ADMIN") return;
    if (profile.userId !== user.id) {
      throw new TransporterDomainError(
        "You do not have permission to manage this transporter's resources.",
        "UNAUTHORIZED_TRANSPORTER_ACCESS",
        403,
      );
    }
  }
}
