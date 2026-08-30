import { AuthorizationError } from "../../common/errors";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { FpoAdminRepository } from "./fpo-admin.repository";

/**
 * Build spec section 12/54/80: an FPO_ADMIN role alone must never grant
 * access to every FPO. This is the single, shared place that answers "can
 * this user manage this FPO" so the same condition isn't re-implemented
 * (and potentially re-implemented *wrong*) in a dozen controllers.
 *
 * `fpoId` here is always the internal database id, never the publicId —
 * callers resolve publicId -> internal id first (typically by loading the
 * Fpo, or the entity that references it, from a repository) and then check
 * ownership against that internal id.
 */
export class FpoAuthorizationService {
  constructor(private readonly fpoAdmins: FpoAdminRepository) {}

  async canManageFpo(user: AuthenticatedUserContext, fpoId: string): Promise<boolean> {
    if (user.role === "ADMIN") return true;
    if (user.role !== "FPO_ADMIN") return false;
    const admin = await this.fpoAdmins.findActiveByUserAndFpo(user.id, fpoId);
    return admin !== null;
  }

  async assertCanManageFpo(user: AuthenticatedUserContext, fpoId: string): Promise<void> {
    if (!(await this.canManageFpo(user, fpoId))) {
      throw new AuthorizationError("You do not have permission to manage this FPO.");
    }
  }
}
