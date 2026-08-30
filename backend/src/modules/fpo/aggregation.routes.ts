import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { createAggregationController } from "./aggregation.controller";
import { FpoAggregationService } from "./aggregation.service";
import {
  aggregationIdParamSchema,
  createAggregationGroupSchema,
  cropAggregationMembersParamSchema,
  listAggregationGroupsQuerySchema,
  updateAggregationGroupSchema,
} from "./aggregation.schemas";

/**
 * Mounted under /api/fpos/:fpoId (mergeParams: true) — build spec section
 * 28/33/35/38/39/41. Every route here requires FPO_ADMIN (of *this* FPO —
 * enforced inside the service via FpoAuthorizationService, not just by
 * role) or ADMIN; crop-aggregation reads additionally allow
 * GOVERNMENT_VIEWER (aggregate figures only, see fpo.authorization
 * comments in aggregation.service.ts).
 */
export function createAggregationRouter(service: FpoAggregationService, repo: AuthRepository, audit: AuditService) {
  const router = Router({ mergeParams: true });
  const controller = createAggregationController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  const canView = requireAnyRole("FPO_ADMIN", "ADMIN", "GOVERNMENT_VIEWER");
  const canManage = requireAnyRole("FPO_ADMIN", "ADMIN");

  /**
   * @openapi
   * /api/fpos/{fpoId}/crop-aggregation:
   *   get:
   *     summary: Estimated crop-wise supply from an FPO's active members
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Crop aggregation rows, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not authorized for this FPO, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/crop-aggregation", authenticate, canView, asyncHandler(controller.getCropAggregation));

  /**
   * @openapi
   * /api/fpos/{fpoId}/crop-aggregation/{cropId}/members:
   *   get:
   *     summary: Per-farmer breakdown for one crop (FPO admin/platform admin only)
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: cropId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Per-farmer breakdown, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get(
    "/crop-aggregation/:cropId/members",
    authenticate,
    canManage,
    validateParams(cropAggregationMembersParamSchema),
    asyncHandler(controller.getCropAggregationMembers),
  );

  /**
   * @openapi
   * /api/fpos/{fpoId}/analytics/overview:
   *   get:
   *     summary: FPO analytics overview (FPO admin/platform admin only)
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Analytics, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/analytics/overview", authenticate, canManage, asyncHandler(controller.getAnalyticsOverview));

  /**
   * @openapi
   * /api/fpos/{fpoId}/aggregation-groups:
   *   post:
   *     summary: Create a crop aggregation target
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cropId, unit]
   *             properties:
   *               cropId: { type: string }
   *               targetQuantity: { type: number }
   *               unit: { type: string, enum: [KG, QTL, TONNE] }
   *               targetDate: { type: string, format: date }
   *     responses:
   *       201: { description: Aggregation target created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     summary: List an FPO's aggregation targets
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: cropId
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string }
   *     responses:
   *       200: { description: Aggregation targets, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post(
    "/aggregation-groups",
    authenticate,
    canManage,
    validateBody(createAggregationGroupSchema),
    asyncHandler(controller.createAggregationGroup),
  );
  router.get(
    "/aggregation-groups",
    authenticate,
    canView,
    validateQuery(listAggregationGroupsQuerySchema),
    asyncHandler(controller.listAggregationGroups),
  );

  /**
   * @openapi
   * /api/fpos/{fpoId}/aggregation-groups/{aggregationId}:
   *   get:
   *     summary: Get one aggregation target
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: aggregationId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Aggregation target, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *   patch:
   *     summary: Update an aggregation target's quantity/date/status
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: aggregationId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Aggregation target updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get(
    "/aggregation-groups/:aggregationId",
    authenticate,
    canView,
    validateParams(aggregationIdParamSchema),
    asyncHandler(controller.getAggregationGroup),
  );
  router.patch(
    "/aggregation-groups/:aggregationId",
    authenticate,
    canManage,
    validateParams(aggregationIdParamSchema),
    validateBody(updateAggregationGroupSchema),
    asyncHandler(controller.updateAggregationGroup),
  );

  /**
   * @openapi
   * /api/fpos/{fpoId}/aggregation-groups/{aggregationId}/cancel:
   *   post:
   *     summary: Cancel an aggregation target
   *     tags: [FPO Aggregation]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: aggregationId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Aggregation target cancelled, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post(
    "/aggregation-groups/:aggregationId/cancel",
    authenticate,
    canManage,
    validateParams(aggregationIdParamSchema),
    asyncHandler(controller.cancelAggregationGroup),
  );

  return router;
}
