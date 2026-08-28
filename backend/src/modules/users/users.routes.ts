import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { asyncHandler } from "../../common/asyncHandler";
import { sendSuccess } from "../../common/apiResponse";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuthRepository } from "../auth/auth.repository";
import { AuditService } from "../audit/audit.service";

/**
 * This is intentionally thin. Module 1 is authentication/RBAC, not user
 * management — the point of this route is to give future admin tooling a
 * real, protected foundation to build on, and to give the RBAC security
 * tests (spec section 52) something concrete to exercise:
 * "Farmer -> GET /api/admin/users -> 403", "Admin -> 200".
 */
export function createUsersRouter(prisma: PrismaClient, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/admin/users:
   *   get:
   *     summary: List users (ADMIN only)
   *     tags: [Admin]
   *     responses:
   *       200: { description: User list, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/users",
    authenticate,
    requireRole("ADMIN"),
    asyncHandler(async (_req, res) => {
      const users = await prisma.user.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        select: {
          publicId: true,
          fullName: true,
          mobile: true,
          email: true,
          role: true,
          accountStatus: true,
          createdAt: true,
        },
      });
      return sendSuccess(res, { users }, "Users retrieved.");
    }),
  );

  return router;
}
