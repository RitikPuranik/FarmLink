import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { QualityService } from "./quality.service";
import { createQualityController } from "./quality.controller";
import {
  addImageSchema,
  assessmentIdParamSchema,
  assessmentImageParamSchema,
  createAssessmentSchema,
  listAssessmentsQuerySchema,
  lotIdParamSchema,
  updateAssessmentSchema,
  verifyAssessmentSchema,
} from "./quality.schemas";

/**
 * Build spec section 58/29/34/60: the lot-scoped half of Module 5's API —
 * `/api/lots/:lotPublicId/quality-assessments` and
 * `/api/lots/:lotPublicId/quality-summary`. Mounted at the same
 * `/api/lots` prefix as Module 4's own router (lots/lots.routes.ts) rather
 * than a change to that file — exactly the same "second router, same
 * prefix" approach Module 4 itself used for `/api/fpos/:fpoId/lots`, and
 * for the same reason: none of Module 4's own `/:id`-shaped routes
 * literally match `quality-assessments` or `quality-summary` as a second
 * path segment, so Express falls through to this router untouched.
 */
export function createLotQualityRouter(service: QualityService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createQualityController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate, requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"));

  /**
   * @openapi
   * /api/lots/{lotPublicId}/quality-assessments:
   *   post:
   *     summary: Create a quality assessment for a lot
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: lotPublicId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [source]
   *             properties:
   *               source: { type: string, enum: [MANUAL, AI, LAB, HYBRID] }
   *               metrics:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     code: { type: string }
   *                     name: { type: string }
   *                     value: { type: number }
   *                     unit: { type: string }
   *               overallGrade: { type: string, enum: [A, B, C, D, REJECTED] }
   *               notes: { type: string }
   *     responses:
   *       201: { description: Assessment created, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Lot not found (or not accessible), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Lot status does not allow assessment, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     summary: List quality assessments for a lot, most recent first
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: lotPublicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Assessments, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router
    .route("/:lotPublicId/quality-assessments")
    .all(validateParams(lotIdParamSchema))
    .get(validateQuery(listAssessmentsQuerySchema), asyncHandler(controller.listForLot))
    .post(validateBody(createAssessmentSchema), asyncHandler(controller.create));

  /**
   * @openapi
   * /api/lots/{lotPublicId}/quality-summary:
   *   get:
   *     summary: The lot's current (non-superseded, non-rejected) quality assessment summary
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: lotPublicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Summary, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/:lotPublicId/quality-summary", validateParams(lotIdParamSchema), asyncHandler(controller.lotQualitySummary));

  return router;
}

/**
 * Build spec section 58: the assessment-scoped half of the API, addressed
 * by the assessment's own `publicId` — mirrors Module 4's `/api/lots/:id`
 * shape.
 */
export function createQualityAssessmentRouter(service: QualityService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createQualityController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(repo, audit);

  router.use(authenticate, requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"));

  /**
   * @openapi
   * /api/quality-assessments/{publicId}:
   *   get:
   *     summary: Get a single quality assessment
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Assessment, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Not found (including assessments the caller has no access to), content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     summary: Edit a draft/pending-images assessment's metrics, grade, or notes
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Assessment updated, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: No longer editable, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router
    .route("/:publicId")
    .all(validateParams(assessmentIdParamSchema))
    .get(asyncHandler(controller.getOne))
    .patch(validateBody(updateAssessmentSchema), asyncHandler(controller.update));

  /**
   * @openapi
   * /api/quality-assessments/{publicId}/images:
   *   post:
   *     summary: Attach an already-uploaded image's metadata to an assessment
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [externalId, secureUrl]
   *             properties:
   *               storageProvider: { type: string, default: cloudinary }
   *               externalId: { type: string }
   *               secureUrl: { type: string }
   *               imageType: { type: string, enum: [OVERVIEW, TOP_VIEW, SIDE_VIEW, CLOSE_UP, DEFECT, OTHER] }
   *     responses:
   *       201: { description: Image added, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Assessment not editable or image limit reached, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/:publicId/images",
    validateParams(assessmentIdParamSchema),
    validateBody(addImageSchema),
    asyncHandler(controller.addImage),
  );

  /**
   * @openapi
   * /api/quality-assessments/{publicId}/images/{imageId}:
   *   delete:
   *     summary: Remove an image from an editable assessment
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: imageId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Image removed, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.delete(
    "/:publicId/images/:imageId",
    validateParams(assessmentImageParamSchema),
    asyncHandler(controller.removeImage),
  );

  /**
   * @openapi
   * /api/quality-assessments/{publicId}/analyze:
   *   post:
   *     summary: Request AI analysis of an assessment's uploaded images
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Analysis started or already-completed result returned, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Already processing, retry limit reached, or wrong status, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Not enough images uploaded yet, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/:publicId/analyze", validateParams(assessmentIdParamSchema), asyncHandler(controller.analyze));

  /**
   * @openapi
   * /api/quality-assessments/{publicId}/analyze/retry:
   *   post:
   *     summary: Retry a failed AI analysis
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Retry started, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       409: { description: Previous attempt did not fail, or retry limit reached, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/:publicId/analyze/retry", validateParams(assessmentIdParamSchema), asyncHandler(controller.retryAnalyze));

  /**
   * @openapi
   * /api/quality-assessments/{publicId}/verify:
   *   post:
   *     summary: Verify an assessment (never permitted for the lot's own farmer)
   *     tags: [Quality]
   *     parameters:
   *       - in: path
   *         name: publicId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Verified, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       403: { description: Not authorized to verify this assessment, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Cannot be verified from its current status, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/:publicId/verify",
    validateParams(assessmentIdParamSchema),
    validateBody(verifyAssessmentSchema),
    asyncHandler(controller.verify),
  );

  return router;
}

/** Build spec section 59: mirrors lots/lots.routes.ts's
 * createFarmerLotsSummaryRouter — its own tiny router at the exact final
 * path, rather than a change to modules/farmers/farmers.routes.ts. */
export function createFarmerQualitySummaryRouter(service: QualityService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createQualityController(service);
  const { authenticate, requireRole } = createAuthMiddleware(repo, audit);

  /**
   * @openapi
   * /api/farmers/me/quality-summary:
   *   get:
   *     summary: The authenticated farmer's quality assessment dashboard summary
   *     tags: [Quality]
   *     responses:
   *       200: { description: Summary, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/", authenticate, requireRole("FARMER"), asyncHandler(controller.farmerQualitySummary));

  return router;
}
