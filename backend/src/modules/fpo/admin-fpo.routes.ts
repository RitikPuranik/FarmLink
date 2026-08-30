import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { createAdminFpoController } from "./admin-fpo.controller";
import { FpoService } from "./fpo.service";
import { FpoVerificationService } from "./fpo-verification.service";
import { FpoAdminService } from "./fpo-admin.service";
import {
  assignFpoAdminSchema,
  fpoAdminIdParamSchema,
  fpoIdParamSchema,
  rejectFpoSchema,
  searchFposQuerySchema,
  verifyFpoSchema,
} from "./fpo.schemas";

/**
 * Mounted at /api/admin (alongside the existing /api/admin/users router —
 * see app.ts) for /fpos* (build spec section 43/48). Every route here
 * reuses Module 1's existing ADMIN role check; there is no separate
 * Module-3-specific "platform admin" concept.
 */
export function createAdminFpoRouter(
  fpoService: FpoService,
  verification: FpoVerificationService,
  admins: FpoAdminService,
  repo: AuthRepository,
  audit: AuditService,
) {
  const router = Router();
  const controller = createAdminFpoController(fpoService, verification, admins);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  router.use("/fpos", authenticate, requireRole("ADMIN"));

  /**
   * @openapi
   * /api/admin/fpos:
   *   get:
   *     summary: List all FPOs, any status (platform ADMIN only)
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: name
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
   *       200: { description: Paginated FPOs (admin view), content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not a platform ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/fpos", validateQuery(searchFposQuerySchema), asyncHandler(controller.list));

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}:
   *   get:
   *     summary: FPO details, full admin view (platform ADMIN only)
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPO (admin view), content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: FPO not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/fpos/:fpoId", validateParams(fpoIdParamSchema), asyncHandler(controller.details));

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/verify:
   *   post:
   *     summary: Verify an FPO's registration (PENDING/UNDER_REVIEW -> VERIFIED)
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               verificationNote: { type: string, description: "Private admin note — audited only, never returned in any farmer-facing response." }
   *     responses:
   *       200: { description: FPO verified, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: FPO not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: FPO is not awaiting verification, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/fpos/:fpoId/verify",
    validateParams(fpoIdParamSchema),
    validateBody(verifyFpoSchema),
    asyncHandler(controller.verify),
  );

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/reject:
   *   post:
   *     summary: Reject an FPO's registration (PENDING/UNDER_REVIEW -> REJECTED)
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               verificationNote: { type: string }
   *     responses:
   *       200: { description: FPO rejected, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: FPO is not awaiting verification, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/fpos/:fpoId/reject",
    validateParams(fpoIdParamSchema),
    validateBody(rejectFpoSchema),
    asyncHandler(controller.reject),
  );

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/suspend:
   *   post:
   *     summary: Suspend an FPO (blocks normal member-management/aggregation operations)
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPO suspended, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: FPO is already suspended or deactivated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/fpos/:fpoId/suspend", validateParams(fpoIdParamSchema), asyncHandler(controller.suspend));

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/reactivate:
   *   post:
   *     summary: Reactivate a suspended FPO
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPO reactivated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: FPO is not currently suspended, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/fpos/:fpoId/reactivate", validateParams(fpoIdParamSchema), asyncHandler(controller.reactivate));

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/admins:
   *   get:
   *     summary: List an FPO's administrators
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPO admins, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *   post:
   *     summary: Assign an FPO_ADMIN user as an administrator of this FPO
   *     tags: [Admin FPO]
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
   *             required: [userId, role]
   *             properties:
   *               userId: { type: string }
   *               role: { type: string, enum: [PRIMARY_ADMIN, ADMIN] }
   *     responses:
   *       201: { description: Admin assigned, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Target user does not exist or is not an FPO_ADMIN, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: User already administers this FPO, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/fpos/:fpoId/admins", validateParams(fpoIdParamSchema), asyncHandler(controller.listAdmins));
  router.post(
    "/fpos/:fpoId/admins",
    validateParams(fpoIdParamSchema),
    validateBody(assignFpoAdminSchema),
    asyncHandler(controller.assignAdmin),
  );

  /**
   * @openapi
   * /api/admin/fpos/{fpoId}/admins/{adminId}/remove:
   *   post:
   *     summary: Remove (deactivate) an FPO administrator assignment
   *     tags: [Admin FPO]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: adminId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Admin removed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Admin assignment is already inactive, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/fpos/:fpoId/admins/:adminId/remove",
    validateParams(fpoAdminIdParamSchema),
    asyncHandler(controller.removeAdmin),
  );

  return router;
}
