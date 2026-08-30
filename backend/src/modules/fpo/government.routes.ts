import { Request, Response, Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { sendSuccess } from "../../common/apiResponse";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { GovernmentFpoService } from "./government-fpo.service";

/**
 * Mounted at /api/government (build spec section 42). GOVERNMENT_VIEWER
 * only, and every route here is a GET — this module never lets a
 * government account mutate FPO/membership/aggregation data (build spec:
 * "Government endpoints must be read-only for this module").
 */
export function createGovernmentFpoRouter(service: GovernmentFpoService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/government/fpo-summary:
   *   get:
   *     summary: Read-only national FPO/crop-supply summary
   *     tags: [Government]
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Summary, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not a government viewer, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/fpo-summary",
    authenticate,
    requireRole("GOVERNMENT_VIEWER"),
    asyncHandler(async (req: Request, res: Response) => {
      const summary = await service.getSummary();
      return sendSuccess(res, summary, "Government FPO summary retrieved.");
    }),
  );

  return router;
}
