import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { FarmersService } from "./farmers.service";
import { createFarmersController } from "./farmers.controller";
import { createFarmerProfileSchema, updateFarmerProfileSchema } from "./farmers.schemas";

/**
 * Farmer self-service: profile + the aggregate view the dashboard/profile
 * page reads from (build spec section 28/32/33/57). RBAC-restricted to
 * FARMER, same pattern as the farms/crops routers.
 */
export function createFarmersRouter(service: FarmersService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createFarmersController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate, requireRole("FARMER"));

  /**
   * @openapi
   * /api/farmers/me:
   *   get:
   *     summary: Get the authenticated farmer's full profile (profile + farms + crops + completion)
   *     tags: [Farmer Profile]
   *     description: Auto-creates a bare FarmerProfile on first call if the farmer hasn't started onboarding yet, so this endpoint always returns a usable (if mostly-empty) shape right after registration.
   *     responses:
   *       200: { description: Farmer profile, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not a farmer, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/me", asyncHandler(controller.getMe));

  /**
   * @openapi
   * /api/farmers/me/profile:
   *   post:
   *     summary: Create/complete the authenticated farmer's selling-preference profile
   *     tags: [Farmer Profile]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               fpoMembershipStatus: { type: string, enum: [NOT_A_MEMBER, MEMBER, PENDING] }
   *               fpoId: { type: string, nullable: true }
   *               liquidityPreference: { type: string, enum: [URGENT, WITHIN_3_DAYS, WITHIN_1_WEEK, CAN_WAIT_2_WEEKS, FLEXIBLE] }
   *               willingToStore: { type: boolean }
   *               communicationPreference: { type: string, enum: [IN_APP, SMS, WHATSAPP, VOICE] }
   *     responses:
   *       201: { description: Profile created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error (e.g. MEMBER without an fpoId, or an unknown FPO), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: A farmer profile already exists for this account, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     summary: Update the authenticated farmer's selling-preference profile
   *     tags: [Farmer Profile]
   *     responses:
   *       200: { description: Profile updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/me/profile")
    .post(validateBody(createFarmerProfileSchema), asyncHandler(controller.createProfile))
    .patch(validateBody(updateFarmerProfileSchema), asyncHandler(controller.updateProfile));

  /**
   * @openapi
   * /api/farmers/me/completion:
   *   get:
   *     summary: Get the authenticated farmer's server-calculated profile completion percentage
   *     tags: [Farmer Profile]
   *     responses:
   *       200: { description: Completion, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/me/completion", asyncHandler(controller.completion));

  return router;
}
