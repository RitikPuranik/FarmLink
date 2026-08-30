import { ConflictError, NotFoundError, ValidationError } from "../../common/errors";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { AssignFpoAdminInput } from "./fpo.schemas";
import { FpoAdminRepository } from "./fpo-admin.repository";
import { FpoRepository } from "./fpo.repository";
import { FpoAdminDTO, toFpoAdminDTO } from "./fpo.types";

/**
 * Build spec section 48: FPO_ADMIN is never self-assignable by a public
 * user. Every method here is reached only via /api/admin/fpos/:fpoId/admins
 * (platform ADMIN only, Module 1's existing requireRole("ADMIN") — see
 * admin-fpo.routes.ts), matching how the rest of section 43's endpoints
 * reuse Module 1's ADMIN authorization rather than inventing a parallel one.
 */
export class FpoAdminService {
  constructor(
    private readonly fpoRepo: FpoRepository,
    private readonly fpoAdmins: FpoAdminRepository,
    private readonly authRepo: AuthRepository,
    private readonly audit: AuditService,
  ) {}

  private async loadFpoOrThrow(fpoPublicId: string) {
    const fpo = await this.fpoRepo.findByPublicId(fpoPublicId);
    if (!fpo) {
      throw new NotFoundError("FPO not found.");
    }
    return fpo;
  }

  async listAdmins(fpoPublicId: string): Promise<FpoAdminDTO[]> {
    const fpo = await this.loadFpoOrThrow(fpoPublicId);
    const admins = await this.fpoAdmins.listByFpoId(fpo.id);
    return admins.map(toFpoAdminDTO);
  }

  async assignAdmin(
    actor: AuthenticatedUserContext,
    fpoPublicId: string,
    input: AssignFpoAdminInput,
    meta: RequestMeta,
  ): Promise<FpoAdminDTO> {
    const fpo = await this.loadFpoOrThrow(fpoPublicId);

    const targetUser = await this.authRepo.findUserById(input.userId);
    if (!targetUser) {
      throw new ValidationError("Please correct the highlighted fields", { userId: "Unknown user." });
    }
    if (targetUser.role !== "FPO_ADMIN") {
      throw new ValidationError("Please correct the highlighted fields", {
        userId: "This user does not have the FPO_ADMIN role.",
      });
    }

    const existing = await this.fpoAdmins.findByFpoAndUser(fpo.id, targetUser.id);
    let admin;
    if (existing && existing.status === "ACTIVE") {
      throw new ConflictError("This user already administers this FPO.");
    } else if (existing) {
      admin = await this.fpoAdmins.setStatus(existing.id, "ACTIVE");
    } else {
      admin = await this.fpoAdmins.create({ fpoId: fpo.id, userId: targetUser.id, role: input.role });
    }

    await this.audit.record({
      actorUserId: actor.id,
      action: "FPO_ADMIN_ADDED",
      entityType: "Fpo",
      entityId: fpo.id,
      metadata: { userId: targetUser.id, role: input.role },
      ...meta,
    });

    return toFpoAdminDTO(admin);
  }

  async removeAdmin(actor: AuthenticatedUserContext, fpoPublicId: string, adminId: string, meta: RequestMeta): Promise<void> {
    const fpo = await this.loadFpoOrThrow(fpoPublicId);
    const admin = await this.fpoAdmins.findById(adminId);
    if (!admin || admin.fpoId !== fpo.id) {
      throw new NotFoundError("FPO admin assignment not found.");
    }
    if (admin.status === "INACTIVE") {
      throw new ConflictError("This admin assignment is already inactive.");
    }

    await this.fpoAdmins.setStatus(admin.id, "INACTIVE");

    await this.audit.record({
      actorUserId: actor.id,
      action: "FPO_ADMIN_REMOVED",
      entityType: "Fpo",
      entityId: fpo.id,
      metadata: { userId: admin.userId },
      ...meta,
    });
  }
}
