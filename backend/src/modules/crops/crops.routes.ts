import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { CropsService } from "./crops.service";
import { createCropsController } from "./crops.controller";
import { addFarmerCropSchema, updateFarmerCropSchema } from "./crops.schemas";

const farmerCropIdParamsSchema = z.object({ id: z.string().uuid("Invalid crop record id.") });

/**
 * `/api/farmers/me/crops` — build spec section 30. Mounted under the
 * farmers namespace (not `/api/crops`, which is reference-data's read-only
 * catalog) since these rows belong to the authenticated farmer, not to the
 * crop catalog itself.
 */
export function createCropsRouter(service: CropsService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createCropsController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate, requireRole("FARMER"));

  /**
   * @openapi
   * /api/farmers/me/crops:
   *   get:
   *     summary: List the authenticated farmer's crops
   *     tags: [Farmer Crops]
   *     responses:
   *       200: { description: Crops, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *   post:
   *     summary: Add a crop to one of the authenticated farmer's farms
   *     tags: [Farmer Crops]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [farmId, cropId, area, areaUnit]
   *             properties:
   *               farmId: { type: string }
   *               cropId: { type: string }
   *               area: { type: number }
   *               areaUnit: { type: string, enum: [ACRE, HECTARE] }
   *               isPrimary: { type: boolean }
   *               typicalYield: { type: number }
   *               yieldUnit: { type: string }
   *     responses:
   *       201: { description: Crop added, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid crop, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: The farm does not belong to this farmer, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Farm not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: This crop is already recorded for this farm, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/")
    .get(asyncHandler(controller.list))
    .post(validateBody(addFarmerCropSchema), asyncHandler(controller.add));

  /**
   * @openapi
   * /api/farmers/me/crops/{id}:
   *   patch:
   *     summary: Update one of the authenticated farmer's crop records (including setting it as primary)
   *     tags: [Farmer Crops]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Crop updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   delete:
   *     summary: Remove one of the authenticated farmer's crop records
   *     tags: [Farmer Crops]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Crop removed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/:id")
    .all(validateParams(farmerCropIdParamsSchema))
    .patch(validateBody(updateFarmerCropSchema), asyncHandler(controller.update))
    .delete(asyncHandler(controller.remove));

  return router;
}
