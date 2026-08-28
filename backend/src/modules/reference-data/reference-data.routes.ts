import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { ReferenceDataService } from "./reference-data.service";
import { createReferenceDataController } from "./reference-data.controller";
import { listDistrictsQuerySchema, listFposQuerySchema, listTalukasQuerySchema } from "./reference-data.schemas";

/**
 * Read-only lookups consumed by every role's forms (farm location, crop
 * catalog, FPO selection, etc.) — authenticated (build spec section 31)
 * but deliberately not role-restricted, since e.g. a future buyer/warehouse
 * module will also need states/districts/crops.
 */
export function createReferenceDataRouter(service: ReferenceDataService, repo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createReferenceDataController(service);
  const { authenticate } = createAuthMiddleware(repo, audit);

  router.use(authenticate);

  /**
   * @openapi
   * /api/reference/languages:
   *   get:
   *     summary: List supported UI languages
   *     tags: [Reference Data]
   *     responses:
   *       200: { description: Languages, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/languages", asyncHandler(controller.languages));

  /**
   * @openapi
   * /api/reference/irrigation-types:
   *   get:
   *     summary: List controlled irrigation type values
   *     tags: [Reference Data]
   *     responses:
   *       200: { description: Irrigation types, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/irrigation-types", asyncHandler(controller.irrigationTypes));

  /**
   * @openapi
   * /api/reference/states:
   *   get:
   *     summary: List states (Maharashtra-only seed for the current SIH scope)
   *     tags: [Reference Data]
   *     responses:
   *       200: { description: States, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/states", asyncHandler(controller.states));

  /**
   * @openapi
   * /api/reference/districts:
   *   get:
   *     summary: List districts for a state
   *     tags: [Reference Data]
   *     parameters:
   *       - in: query
   *         name: stateId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Districts, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Unknown state, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/districts", validateQuery(listDistrictsQuerySchema), asyncHandler(controller.districts));

  /**
   * @openapi
   * /api/reference/talukas:
   *   get:
   *     summary: List talukas for a district
   *     tags: [Reference Data]
   *     parameters:
   *       - in: query
   *         name: districtId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Talukas, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Validation error, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Unknown district, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/talukas", validateQuery(listTalukasQuerySchema), asyncHandler(controller.talukas));

  /**
   * @openapi
   * /api/reference/crops:
   *   get:
   *     summary: List the active crop catalog with English/Hindi/Marathi names
   *     tags: [Reference Data]
   *     responses:
   *       200: { description: Crops, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   */
  router.get("/crops", asyncHandler(controller.crops));

  /**
   * @openapi
   * /api/reference/fpos:
   *   get:
   *     summary: Search/list FPOs, optionally filtered by district (used by the FPO-membership selection flow)
   *     tags: [Reference Data]
   *     parameters:
   *       - in: query
   *         name: districtId
   *         required: false
   *         schema: { type: string }
   *     responses:
   *       200: { description: FPOs, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Unknown district, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/fpos", validateQuery(listFposQuerySchema), asyncHandler(controller.fpos));

  return router;
}
