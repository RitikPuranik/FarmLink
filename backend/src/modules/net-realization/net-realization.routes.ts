import { Router } from "express";
import { AuthRepository } from "../auth/auth.repository";
import { AuditService } from "../audit/audit.service";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { asyncHandler } from "../../common/asyncHandler";
import { validateParams } from "../../middleware/validateParams";
import { validateBody } from "../../middleware/validateBody";
import { validateQuery } from "../../middleware/validateQuery";
import { NetRealizationController } from "./net-realization.controller";
import { NetRealizationOrchestrationService } from "./net-realization-orchestration.service";
import { CropLotRepository } from "../lots/lots.repository";
import { LotAuthorizationService } from "../lots/lot.authorization";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import {
  calculateRealizationBody,
  calculationPublicIdParams,
  listRealizationsQuery,
  lotPublicIdParams,
} from "./net-realization.schemas";

/**
 * Registers routes for the Net Realization Calculator API (Module 14).
 * Mounted at /api/net-realization and /api/lots (for the lot-scoped
 * history endpoint) by app.ts — same two-mount-point shape Module 8 uses
 * for its own /api/sell-vs-store + lot-scoped routes.
 */
export function createNetRealizationRouter(
  orchestrator: NetRealizationOrchestrationService,
  lots: CropLotRepository,
  lotAuth: LotAuthorizationService,
  farmers: FarmerProfileResolver,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = new NetRealizationController(orchestrator, lots, lotAuth, farmers);

  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  // Same coarse role gate as Module 8's sell-vs-store router: only roles
  // that can plausibly own or manage a lot may reach these handlers.
  // Per-lot ownership/FPO-management is still separately enforced in the
  // controller (ensureAuthorizedForLot) for every request.
  router.use(authMw, requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"));

  /**
   * @openapi
   * /api/net-realization/lots/{lotPublicId}/calculate:
   *   post:
   *     tags: [Net Realization]
   *     summary: Calculate net realization for a lot
   *     description: |
   *       Deterministically calculates approximately how much the farmer will realize after
   *       known costs and deductions, given a particular buyer offer, market reference, or
   *       user-supplied what-if price. Never fabricates a cost or price: any component with
   *       no real backing data is returned under `costs.unavailable` and is never treated as
   *       zero. `result.completeness` is one of COMPLETE, PARTIAL, or INSUFFICIENT —
   *       INSUFFICIENT means no sale price/quantity could be resolved at all, and
   *       `result.netRealization` is `null` in that case (never a fabricated number).
   *       All amounts are informational only — see `explanation.disclaimer`.
   *     parameters:
   *       - name: lotPublicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               offerPublicId: { type: string, format: uuid, description: "Calculate against this specific offer instead of auto-detecting the lot's accepted offer." }
   *               salePricePerUnit: { type: number, description: "A what-if sale price, used only when no offer applies." }
   *               salePriceUnit: { type: string, enum: [KG, QTL, TONNE] }
   *               saleQuantity: { type: number }
   *               saleQuantityUnit: { type: string, enum: [KG, QTL, TONNE] }
   *               costs:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     category: { type: string, enum: [TRANSPORT, LOADING, UNLOADING, PACKAGING, STORAGE, COMMISSION, MARKET_FEE, TAX, INSURANCE, OTHER] }
   *                     amount: { type: number }
   *                     name: { type: string, description: "Required for category OTHER." }
   *                     isIncludedInPrice: { type: boolean }
   *     responses:
   *       200: { description: Calculation completed (COMPLETE, PARTIAL, or INSUFFICIENT_DATA — all are successful responses)., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid request body., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Lot not found, access denied, or the specified offer does not belong to this lot., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: An explicit price/quantity/cost override was invalid (e.g. negative)., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/net-realization/lots/:lotPublicId/calculate",
    validateParams(lotPublicIdParams),
    validateBody(calculateRealizationBody),
    asyncHandler(controller.calculate),
  );

  /**
   * @openapi
   * /api/net-realization/{publicId}:
   *   get:
   *     tags: [Net Realization]
   *     summary: Get a historical calculation
   *     description: Retrieves a previously persisted calculation exactly as it was resolved. Never recomputed. Requires access to the associated lot.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Calculation retrieved successfully., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid publicId format., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Calculation or lot not found, or access denied., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/net-realization/:publicId",
    validateParams(calculationPublicIdParams),
    asyncHandler(controller.getByPublicId),
  );

  /**
   * @openapi
   * /api/lots/{lotPublicId}/net-realizations:
   *   get:
   *     tags: [Net Realization]
   *     summary: List historical calculations for a lot
   *     description: Paginated history of calculations for this lot, most recent first. Never recomputed.
   *     parameters:
   *       - name: lotPublicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: pageSize
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated list of historical calculations., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid lotPublicId format or pagination parameters., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Lot not found or access denied., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/lots/:lotPublicId/net-realizations",
    validateParams(lotPublicIdParams),
    validateQuery(listRealizationsQuery),
    asyncHandler(controller.listForLot),
  );

  return router;
}
