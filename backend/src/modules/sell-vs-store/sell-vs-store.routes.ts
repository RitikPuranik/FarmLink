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

  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  // Matches the RBAC convention used by every other lot-scoped module
  // (quality, market-intelligence, lots): authentication alone is not
  // sufficient — only roles that can plausibly own or manage a lot may
  // reach these handlers. Ownership/FPO-management is still separately
  // enforced per-lot in the controller (ensureAuthorizedForLot); this is
  // the coarse role gate that runs first, matches other modules'
  // AUTHORIZATION_DENIED audit trail for rejected roles (e.g. BUYER,
  // TRANSPORTER, WAREHOUSE_OPERATOR), and avoids doing any DB work for a
  // role that could never pass the ownership check anyway.
  router.use(authMw, requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"));

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
   *       The response additively includes `aiAdvisory` — an optional, advisory-only explanation of the
   *       deterministic result (summary, reasoning, risks, considerations, data limitations, and whether the
   *       AI agrees with the result). `aiAdvisory` is `null` whenever no AI provider is configured or the AI
   *       attempt fails for any reason; it never affects `result`, the scores, or `decisionMetadata`, and it is
   *       never persisted (historical decisions always return `aiAdvisory: null`).
   *     parameters:
   *       - name: lotPublicId
   *         in: path
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *     responses:
   *       200: { description: Decision generated successfully., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid lotPublicId format., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Lot not found or access denied., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/lots/:lotPublicId/analyze",
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
   *       200: { description: List of historical decisions., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid lotPublicId format., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Lot not found or access denied., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/lots/:lotPublicId/history",
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
   *       200: { description: Historical decision retrieved successfully., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid publicId format., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Decision or lot not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/decisions/:publicId",
    validateParams(decisionPublicIdParamSchema),
    asyncHandler(controller.getHistoricalDecision)
  );

  return router;
}
