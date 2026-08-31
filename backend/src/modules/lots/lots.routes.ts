import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { LotsService } from "./lots.service";
import { createLotsController } from "./lots.controller";
import { createLotSchema, getLotQuerySchema, lotIdParamSchema, listLotsQuerySchema, updateDraftLotSchema } from "./lots.schemas";

const fpoIdParamsSchema = z.object({ fpoId: z.string().uuid("Invalid FPO id.") });

/**
 * Build spec section 48/93: `/api/lots` is the module's own top-level
 * resource, addressed by publicId (never the internal database id) —
 * mirrors how Module 3 addresses Fpo/AggregationGroup by publicId. Every
 * route below authenticates first; ownership/role-branch checks beyond
 * that live in LotsService (build spec section 95: controllers only
 * parse/validate/call the service/respond).
 */
export function createLotsRouter(service: LotsService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createLotsController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate);

  /**
   * @openapi
   * /api/lots:
   *   post:
   *     summary: Create a crop lot (farmer-owned via farmId, or FPO-owned via fpoId)
   *     tags: [Lots]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cropId, quantity, unit, availabilityDate]
   *             properties:
   *               farmId: { type: string, description: "Required for a farmer lot; mutually exclusive with fpoId." }
   *               fpoId: { type: string, description: "Required for an FPO-owned lot; mutually exclusive with farmId." }
   *               cropId: { type: string }
   *               quantity: { type: number }
   *               unit: { type: string, enum: [KG, QTL, TONNE] }
   *               variety: { type: string }
   *               harvestDate: { type: string, format: date }
   *               availabilityDate: { type: string, format: date }
   *     responses:
   *       201: { description: Lot created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Farm or FPO not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     summary: List the authenticated farmer's own lots
   *     tags: [Lots]
   *     parameters:
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [DRAFT, AVAILABLE, PARTIALLY_COMMITTED, COMMITTED, STORED, IN_TRANSACTION, DELIVERED, COMPLETED, CANCELLED] }
   *       - in: query
   *         name: cropId
   *         schema: { type: string }
   *       - in: query
   *         name: farmId
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200: { description: Lots, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router
    .route("/")
    .get(requireAnyRole("FARMER"), validateQuery(listLotsQuerySchema), asyncHandler(controller.listMine))
    .post(requireAnyRole("FARMER", "FPO_ADMIN"), validateBody(createLotSchema), asyncHandler(controller.create));

  /**
   * @openapi
   * /api/lots/{id}:
   *   get:
   *     summary: Get a single lot by its public id
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: unit
   *         schema: { type: string, enum: [KG, QTL, TONNE] }
   *     responses:
   *       200: { description: Lot, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found (including lots the caller has no access to), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     summary: Update a draft lot
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Lot updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Lot is no longer a draft, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   delete:
   *     summary: Delete a draft lot
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Lot deleted, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Only draft lots can be deleted, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/:id")
    .all(requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"), validateParams(lotIdParamSchema))
    .get(validateQuery(getLotQuerySchema), asyncHandler(controller.getOne))
    .patch(validateBody(updateDraftLotSchema), asyncHandler(controller.updateDraft))
    .delete(asyncHandler(controller.remove));

  /**
   * @openapi
   * /api/lots/{id}/publish:
   *   post:
   *     summary: Publish a draft lot (DRAFT -> AVAILABLE)
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Lot published, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Illegal transition, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/:id/publish",
    requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"),
    validateParams(lotIdParamSchema),
    asyncHandler(controller.publish),
  );

  /**
   * @openapi
   * /api/lots/{id}/cancel:
   *   post:
   *     summary: Cancel a lot (only while DRAFT or AVAILABLE)
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Lot cancelled, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Lot can no longer be cancelled, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/:id/cancel",
    requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"),
    validateParams(lotIdParamSchema),
    asyncHandler(controller.cancel),
  );

  /**
   * @openapi
   * /api/lots/{id}/history:
   *   get:
   *     summary: Get a lot's status transition history
   *     tags: [Lots, Lot History]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: History, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get(
    "/:id/history",
    requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"),
    validateParams(lotIdParamSchema),
    asyncHandler(controller.history),
  );

  return router;
}

/**
 * Build spec section 45: the farmer lot dashboard summary, kept as its own
 * tiny router (rather than nested under /api/lots) because its path,
 * `/api/farmers/me/lots/summary`, follows the existing
 * `/api/farmers/me/...` self-service convention (see
 * modules/crops/crops.routes.ts) rather than the lots module's own
 * publicId-addressed `/api/lots/*` shape.
 */
export function createFarmerLotsSummaryRouter(service: LotsService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createLotsController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/farmers/me/lots/summary:
   *   get:
   *     summary: The authenticated farmer's lot dashboard summary
   *     tags: [Lots]
   *     responses:
   *       200: { description: Summary, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/summary", authenticate, requireRole("FARMER"), asyncHandler(controller.farmerSummary));

  return router;
}

/**
 * Build spec section 23/76: an FPO admin's view of lots belonging to their
 * own FPO. Deliberately its own router mounted at the existing `/api/fpos`
 * prefix (app.ts) rather than a change to modules/fpo/fpo.routes.ts itself
 * — Module 3's own router composition is left untouched, per the build
 * spec's "do not rewrite existing modules" rule.
 */
export function createFpoLotsRouter(service: LotsService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createLotsController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/fpos/{fpoId}/lots:
   *   get:
   *     summary: List lots owned by an FPO (its own admins only)
   *     tags: [Lots]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Lots, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not an admin of this FPO, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/:fpoId/lots",
    authenticate,
    requireAnyRole("FPO_ADMIN", "ADMIN"),
    validateParams(fpoIdParamsSchema),
    validateQuery(listLotsQuerySchema),
    asyncHandler(controller.listForFpo),
  );

  return router;
}
