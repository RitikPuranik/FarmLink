import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { FarmsService } from "./farms.service";
import { createFarmsController } from "./farms.controller";
import { createFarmSchema, updateFarmSchema } from "./farms.schemas";

const farmIdParamsSchema = z.object({ id: z.string().uuid("Invalid farm id.") });

/**
 * Self-service farm CRUD (build spec section 29). Every route derives the
 * farmer from the authenticated session (`req.user!.id`) — never from
 * `req.body.farmerId`/`req.query.farmerId` (section 48). RBAC restricts
 * this entire router to FARMER, mirroring how Module 1 restricts
 * `/api/admin/*` to ADMIN.
 */
export function createFarmsRouter(service: FarmsService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createFarmsController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate, requireRole("FARMER"));

  /**
   * @openapi
   * /api/farms:
   *   get:
   *     summary: List the authenticated farmer's farms
   *     tags: [Farms]
   *     responses:
   *       200: { description: Farms, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not a farmer, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   post:
   *     summary: Create a farm for the authenticated farmer
   *     tags: [Farms]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [village, stateId, districtId, talukaId, area, areaUnit]
   *             properties:
   *               name: { type: string }
   *               village: { type: string }
   *               pincode: { type: string }
   *               latitude: { type: number }
   *               longitude: { type: number }
   *               stateId: { type: string }
   *               districtId: { type: string }
   *               talukaId: { type: string }
   *               area: { type: number }
   *               areaUnit: { type: string, enum: [ACRE, HECTARE] }
   *               irrigationType: { type: string, enum: [RAINFED, CANAL, BOREWELL, DRIP, SPRINKLER, MIXED, OTHER, NOT_SPECIFIED] }
   *     responses:
   *       201: { description: Farm created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error (including an inconsistent state/district/taluka chain), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/")
    .get(asyncHandler(controller.list))
    .post(validateBody(createFarmSchema), asyncHandler(controller.create));

  /**
   * @openapi
   * /api/farms/{id}:
   *   get:
   *     summary: Get one of the authenticated farmer's farms
   *     tags: [Farms]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Farm, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found (including farms owned by another farmer), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     summary: Update one of the authenticated farmer's farms
   *     tags: [Farms]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Farm updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   delete:
   *     summary: Delete one of the authenticated farmer's farms
   *     tags: [Farms]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Farm deleted, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/:id")
    .all(validateParams(farmIdParamsSchema))
    .get(asyncHandler(controller.getOne))
    .patch(validateBody(updateFarmSchema), asyncHandler(controller.update))
    .delete(asyncHandler(controller.remove));

  return router;
}
