import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { createFpoController } from "./fpo.controller";
import { FpoService } from "./fpo.service";
import { createFpoSchema, fpoIdParamSchema, searchFposQuerySchema } from "./fpo.schemas";
import { createFpoScopedMembershipRouter } from "./membership.routes";
import { FpoMembershipService } from "./membership.service";
import { createAggregationRouter } from "./aggregation.routes";
import { FpoAggregationService } from "./aggregation.service";

/**
 * Top-level router mounted at /api/fpos (build spec section 76). Composes
 * the core FPO endpoints with the FPO-scoped membership-request/member-
 * directory routes and the FPO-scoped aggregation routes, all under the
 * same :fpoId — see membership.routes.ts / aggregation.routes.ts for what
 * each sub-router adds.
 */
export function createFpoRouter(
  fpoService: FpoService,
  membershipService: FpoMembershipService,
  aggregationService: FpoAggregationService,
  repo: AuthRepository,
  audit: AuditService,
) {
  const router = Router();
  const controller = createFpoController(fpoService);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/fpos:
   *   get:
   *     summary: Search FPOs
   *     tags: [FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: name
   *         schema: { type: string }
   *       - in: query
   *         name: state
   *         schema: { type: string }
   *       - in: query
   *         name: district
   *         schema: { type: string }
   *       - in: query
   *         name: verificationStatus
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Paginated FPOs, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *   post:
   *     summary: Register a new FPO (FPO_ADMIN or platform ADMIN)
   *     tags: [FPO]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, organizationType, stateId, districtId]
   *             properties:
   *               name: { type: string }
   *               legalName: { type: string }
   *               registrationNumber: { type: string }
   *               organizationType: { type: string, enum: [FPO, FPC, COOPERATIVE, OTHER] }
   *               phone: { type: string }
   *               email: { type: string }
   *               village: { type: string }
   *               pincode: { type: string }
   *               stateId: { type: string }
   *               districtId: { type: string }
   *               talukaId: { type: string }
   *     responses:
   *       201: { description: FPO registered, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/", authenticate, validateQuery(searchFposQuerySchema), asyncHandler(controller.list));
  router.post(
    "/",
    authenticate,
    requireAnyRole("FPO_ADMIN", "ADMIN"),
    validateBody(createFpoSchema),
    asyncHandler(controller.create),
  );

  /**
   * @openapi
   * /api/fpos/{fpoId}:
   *   get:
   *     summary: FPO details (public-safe, richer for the FPO's own admin)
   *     tags: [FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPO, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: FPO not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/:fpoId", authenticate, validateParams(fpoIdParamSchema), asyncHandler(controller.details));

  router.use("/:fpoId", validateParams(fpoIdParamSchema), createFpoScopedMembershipRouter(membershipService, repo, audit));
  router.use("/:fpoId", validateParams(fpoIdParamSchema), createAggregationRouter(aggregationService, repo, audit));

  return router;
}
