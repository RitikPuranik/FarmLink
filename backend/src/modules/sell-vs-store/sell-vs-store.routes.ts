import { Router } from "express";
import { z } from "zod";
import { AuthRepository } from "../auth/auth.repository";
import { AuditService } from "../audit/audit.service";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { asyncHandler } from "../../common/asyncHandler";
import { validateParams } from "../../middleware/validateParams";
import { SellStoreController } from "./sell-vs-store.controller";
import { SellStoreOrchestrationService } from "./sell-store-orchestration.service";
import { CropLotRepository } from "../lots/lots.repository";
import { LotAuthorizationService } from "../lots/lot.authorization";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";

const lotPublicIdParamSchema = z.object({
  lotPublicId: z.string().uuid("Invalid lot public ID."),
});

const decisionPublicIdParamSchema = z.object({
  publicId: z.string().uuid("Invalid decision public ID."),
});

/**
 * Registers routes for Sell vs Store decision API.
 */
export function createSellStoreRouter(
  orchestrator: SellStoreOrchestrationService,
  lots: CropLotRepository,
  lotAuth: LotAuthorizationService,
  farmers: FarmerProfileResolver,
  authRepo: AuthRepository,
  auditService: AuditService
): Router {
  const router = Router();
  const controller = new SellStoreController(orchestrator, lots, lotAuth, farmers);

  const { authenticate: authMw } = createAuthMiddleware(authRepo, auditService);

  /**
   * @openapi
   * /api/sell-vs-store/lots/{lotPublicId}/analyze:
   *   post:
   *     tags: [Sell vs Store]
   *     summary: Generate a Sell vs Store decision
   *     description: |
   *       Analyzes market, quality, and storage context to generate a deterministic Sell vs Store decision.
   *       Requires authorization to access the lot (e.g. lot owner).
   *       Returns the exact inputs and scoring rules used. `INSUFFICIENT_DATA` is returned successfully if data is sparse.
   *     parameters:
   *       - name: lotPublicId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Decision generated successfully.
   *       400:
   *         description: Invalid lotPublicId format.
   *       401:
   *         description: Unauthorized.
   *       404:
   *         description: Lot not found or access denied.
   */
  router.post(
    "/lots/:lotPublicId/analyze",
    authMw,
    validateParams(lotPublicIdParamSchema),
    asyncHandler(controller.generateDecision)
  );

  /**
   * @openapi
   * /api/sell-vs-store/lots/{lotPublicId}/history:
   *   get:
   *     tags: [Sell vs Store]
   *     summary: Get historical decisions for a lot
   *     description: Retrieves the history of decisions generated for this lot. Does not recompute decisions.
   *     parameters:
   *       - name: lotPublicId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: List of historical decisions.
   *       400:
   *         description: Invalid lotPublicId format.
   *       401:
   *         description: Unauthorized.
   *       404:
   *         description: Lot not found or access denied.
   */
  router.get(
    "/lots/:lotPublicId/history",
    authMw,
    validateParams(lotPublicIdParamSchema),
    asyncHandler(controller.getDecisionHistory)
  );

  /**
   * @openapi
   * /api/sell-vs-store/decisions/{publicId}:
   *   get:
   *     tags: [Sell vs Store]
   *     summary: Get a historical decision
   *     description: Retrieves a previously generated decision exactly as it was resolved without recomputing. Requires access to the associated lot.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200:
   *         description: Historical decision retrieved successfully.
   *       400:
   *         description: Invalid publicId format.
   *       401:
   *         description: Unauthorized.
   *       404:
   *         description: Decision or lot not found.
   */
  router.get(
    "/decisions/:publicId",
    authMw,
    validateParams(decisionPublicIdParamSchema),
    asyncHandler(controller.getHistoricalDecision)
  );

  return router;
}
