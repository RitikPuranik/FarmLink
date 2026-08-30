import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { createMembershipController } from "./membership.controller";
import { FpoMembershipService } from "./membership.service";
import { membershipIdParamSchema, listMembersQuerySchema, rejectMembershipSchema } from "./membership.schemas";

/**
 * Mounted under /api/fpos/:fpoId (mergeParams: true so req.params.fpoId
 * from the parent router is visible here) — build spec section 15
 * (POST .../membership-requests) and section 25 (GET .../members).
 */
export function createFpoScopedMembershipRouter(service: FpoMembershipService, repo: AuthRepository, audit: AuditService) {
  const router = Router({ mergeParams: true });
  const controller = createMembershipController(service);
  const { authenticate, requireRole, requireAnyRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/fpos/{fpoId}/membership-requests:
   *   post:
   *     summary: Request membership at an FPO (authenticated farmer only)
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Membership request created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: FPO not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Duplicate/conflicting membership state, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/membership-requests",
    authenticate,
    requireRole("FARMER"),
    asyncHandler(controller.requestMembership),
  );

  /**
   * @openapi
   * /api/fpos/{fpoId}/members:
   *   get:
   *     summary: FPO member directory (own FPO admin or platform admin only)
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: fpoId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [PENDING, ACTIVE, REJECTED, SUSPENDED, REMOVED] }
   *       - in: query
   *         name: cropId
   *         schema: { type: string }
   *       - in: query
   *         name: district
   *         schema: { type: string }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Members, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not this FPO's admin, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/members",
    authenticate,
    requireAnyRole("FPO_ADMIN", "ADMIN"),
    validateQuery(listMembersQuerySchema),
    asyncHandler(controller.listMembers),
  );

  return router;
}

/** Mounted at /api/fpo-memberships — build spec section 17-20/50. */
export function createMembershipActionsRouter(service: FpoMembershipService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createMembershipController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  // NOTE: validateParams(membershipIdParamSchema) is intentionally NOT
  // applied here as blanket router.use() middleware — at this point in the
  // middleware chain Express hasn't matched a route pattern yet, so
  // req.params.membershipId would not exist and the check would always
  // fail. It's applied per-route below instead, after the path (which
  // declares :membershipId) is known.
  router.use(authenticate, requireAnyRole("FPO_ADMIN", "ADMIN"));

  /**
   * @openapi
   * /api/fpo-memberships/{membershipId}/approve:
   *   post:
   *     summary: Approve a pending membership request
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: membershipId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Membership approved, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not this FPO's admin, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Membership is no longer pending, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/:membershipId/approve", validateParams(membershipIdParamSchema), asyncHandler(controller.approve));

  /**
   * @openapi
   * /api/fpo-memberships/{membershipId}/reject:
   *   post:
   *     summary: Reject a pending membership request
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: membershipId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason: { type: string }
   *     responses:
   *       200: { description: Membership rejected, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post(
    "/:membershipId/reject",
    validateParams(membershipIdParamSchema),
    validateBody(rejectMembershipSchema),
    asyncHandler(controller.reject),
  );

  /**
   * @openapi
   * /api/fpo-memberships/{membershipId}/remove:
   *   post:
   *     summary: Remove an active member
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: membershipId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Member removed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post("/:membershipId/remove", validateParams(membershipIdParamSchema), asyncHandler(controller.remove));

  /**
   * @openapi
   * /api/fpo-memberships/{membershipId}/suspend:
   *   post:
   *     summary: Suspend an active member
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: membershipId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Member suspended, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post("/:membershipId/suspend", validateParams(membershipIdParamSchema), asyncHandler(controller.suspend));

  /**
   * @openapi
   * /api/fpo-memberships/{membershipId}/reactivate:
   *   post:
   *     summary: Reactivate a suspended member
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: membershipId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Membership reactivated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.post("/:membershipId/reactivate", validateParams(membershipIdParamSchema), asyncHandler(controller.reactivate));

  return router;
}

/** Mounted at /api/farmers/me/fpo — build spec section 21. */
export function createMyFpoRouter(service: FpoMembershipService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createMembershipController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/farmers/me/fpo:
   *   get:
   *     summary: The authenticated farmer's current/most relevant FPO membership
   *     tags: [FPO Membership]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: FPO membership (or a valid empty state if none), content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/", authenticate, requireRole("FARMER"), asyncHandler(controller.getMyFpo));

  return router;
}
