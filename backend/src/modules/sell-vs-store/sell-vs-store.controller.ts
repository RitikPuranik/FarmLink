import { Request, Response } from "express";
import { NotFoundError } from "../../common/errors";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { CropLotRepository } from "../lots/lots.repository";
import { LotAuthorizationService } from "../lots/lot.authorization";
import { SellStoreOrchestrationService } from "./sell-store-orchestration.service";

/**
 * Controller for Sell vs Store API endpoints.
 * Handles authorization only — delegates all logic to the orchestration service.
 * Validation is handled upstream by validateParams middleware (project convention).
 */
export class SellStoreController {
  constructor(
    private readonly orchestrator: SellStoreOrchestrationService,
    private readonly lots: CropLotRepository,
    private readonly lotAuth: LotAuthorizationService,
    private readonly farmers: FarmerProfileResolver
  ) {}

  /**
   * Orchestrates authorization: resolves farmer, checks lot access.
   * Returns 404 (obfuscated) for unauthorized access to hide lot existence.
   */
  private async ensureAuthorizedForLot(user: AuthenticatedUserContext, lotPublicId: string) {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) {
      throw new NotFoundError("Lot not found.");
    }

    const farmerProfileId = user.role === "FARMER" ? (await this.farmers.ensure(user.id)).id : null;
    const canView = await this.lotAuth.canViewLot(user, lot, farmerProfileId);

    if (!canView) {
      throw new NotFoundError("Lot not found."); // Obfuscate unauthorized access
    }

    return lot;
  }

  generateDecision = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { lotPublicId } = req.params;

    await this.ensureAuthorizedForLot(user, lotPublicId);

    const decision = await this.orchestrator.generateDecision(lotPublicId, user.id);
    res.json({ success: true, data: decision });
  };

  getDecisionHistory = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { lotPublicId } = req.params;

    await this.ensureAuthorizedForLot(user, lotPublicId);

    const decisions = await this.orchestrator.getDecisionsForLot(lotPublicId);
    res.json({ success: true, data: decisions });
  };

  getHistoricalDecision = async (req: Request, res: Response) => {
    const user = req.user as AuthenticatedUserContext;
    const { publicId } = req.params;

    // 1. Fetch decision first
    const decision = await this.orchestrator.getDecisionByPublicId(publicId);

    // 2. Fetch the corresponding lot to check authorization
    const lot = await this.lots.findById(decision.lotId);
    if (!lot) {
      throw new NotFoundError("Decision not found.");
    }

    const farmerProfileId = user.role === "FARMER" ? (await this.farmers.ensure(user.id)).id : null;
    const canView = await this.lotAuth.canViewLot(user, lot, farmerProfileId);

    if (!canView) {
      throw new NotFoundError("Decision not found."); // Obfuscate unauthorized access
    }

    res.json({ success: true, data: decision });
  };
}
