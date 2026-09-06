import { Request, Response } from "express";
import { NotFoundError } from "../../common/errors";
import { sendSuccess } from "../../common/apiResponse";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { CropLotRepository } from "../lots/lots.repository";
import { LotAuthorizationService } from "../lots/lot.authorization";
import { NetRealizationOrchestrationService } from "./net-realization-orchestration.service";
import { NetRealizationRequestOverrides } from "./net-realization-input-resolver.types";

/**
 * Part J — Authorization. Reuses the exact same lot-ownership/FPO
 * authorization this codebase already has (LotAuthorizationService,
 * shared with Module 8) rather than a second, Net-Realization-specific
 * authorization system. A lot ID from the request is never trusted
 * without this check, and — matching SellStoreController's own choice —
 * an unauthorized lot returns the same 404 a nonexistent lot would, so
 * the response never confirms *which* lots exist for someone who
 * shouldn't be able to see them.
 */
export class NetRealizationController {
  constructor(
    private readonly orchestrator: NetRealizationOrchestrationService,
    private readonly lots: CropLotRepository,
    private readonly lotAuth: LotAuthorizationService,
    private readonly farmers: FarmerProfileResolver,
  ) {}

  private async ensureAuthorizedForLot(user: AuthenticatedUserContext, lotPublicId: string) {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const farmerProfileId = user.role === "FARMER" ? (await this.farmers.ensure(user.id)).id : null;
    const canView = await this.lotAuth.canViewLot(user, lot, farmerProfileId);
    if (!canView) throw new NotFoundError("Lot not found."); // Obfuscate unauthorized access

    return lot;
  }

  calculate = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { lotPublicId } = req.params;

    await this.ensureAuthorizedForLot(user, lotPublicId);

    const overrides = req.body as NetRealizationRequestOverrides;
    const result = await this.orchestrator.calculate(lotPublicId, overrides, { id: user.id, role: user.role });

    sendSuccess(res, result);
  };

  getByPublicId = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;

    // Fetch the calculation first (Part K: never recomputed automatically),
    // then authorize against the lot it belongs to — same two-step shape
    // as SellStoreController.getHistoricalDecision.
    const calculation = await this.orchestrator.getByPublicId(publicId);

    const lot = await this.lots.findById(calculation.lotId);
    if (!lot) throw new NotFoundError("Calculation not found.");

    const farmerProfileId = user.role === "FARMER" ? (await this.farmers.ensure(user.id)).id : null;
    const canView = await this.lotAuth.canViewLot(user, lot, farmerProfileId);
    if (!canView) throw new NotFoundError("Calculation not found."); // Obfuscate unauthorized access

    sendSuccess(res, calculation);
  };

  listForLot = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { lotPublicId } = req.params;
    const { page, pageSize } = req.validatedQuery as { page: number; pageSize: number };

    await this.ensureAuthorizedForLot(user, lotPublicId);

    const result = await this.orchestrator.listForLot(lotPublicId, page, pageSize);
    sendSuccess(res, result);
  };
}
