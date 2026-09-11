import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { LogisticsRequestController } from "./logistics-request.controller";
import { LogisticsRequestService } from "./logistics-request.service";
import {
  cancelLogisticsRequestBody,
  createLogisticsRequestBody,
  listLogisticsRequestsQuery,
  logisticsRequestPublicIdParams,
  updateLogisticsRequestBody,
} from "./logistics.schemas";

/**
 * Step 6 — Logistics Request API. Mounted at "/api" by app.ts.
 * Create/update/cancel/calculate/optimize/available-providers are
 * FARMER/FPO_ADMIN/ADMIN only (Step 6: "TRANSPORT_PROVIDER: should not
 * create arbitrary farmer logistics requests"). GET (detail) and the
 * list endpoint are open to all four authenticated roles — service-level
 * checks (LogisticsRequestService.assertCanView/listRequests) decide
 * exactly what each role is allowed to see, per-row, rather than the
 * router gating an entire resource.
 */
export function createLogisticsRequestRouter(
  requestService: LogisticsRequestService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = new LogisticsRequestController(requestService);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  router.use(authMw);

  const manageRoles = requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN");

  /**
   * @openapi
   * /api/logistics/requests:
   *   post:
   *     tags: [Logistics]
   *     summary: Raise a transport requirement for a lot
   *     description: |
   *       FARMER may create for their own lots; FPO_ADMIN for lots owned by
   *       an FPO they administer; ADMIN for any. Pickup defaults to the
   *       lot's own registered origin (district/state/village) when
   *       omitted — only destination is required. Coordinates are optional
   *       on both ends but required later to call .../calculate (Step 3).
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [lotId, requiredQuantityValue, destination]
   *             properties:
   *               lotId: { type: string, format: uuid }
   *               requiredQuantityValue: { type: number }
   *               requiredQuantityUnit: { type: string, enum: [KG, QTL, TONNE], default: KG }
   *               pickup: { type: object, properties: { address: { type: string }, district: { type: string }, state: { type: string }, pincode: { type: string }, latitude: { type: number }, longitude: { type: number } } }
   *               destination: { type: object, required: [district, state], properties: { address: { type: string }, district: { type: string }, state: { type: string }, pincode: { type: string }, latitude: { type: number }, longitude: { type: number } } }
   *               requestedPickupAt: { type: string, format: date-time }
   *               deliveryDeadline: { type: string, format: date-time }
   *               requiredCapabilities: { type: array, items: { type: string, enum: [COVERED, OPEN_BODY, TEMPERATURE_CONTROLLED, BULK_TRANSPORT, SMALL_LOAD_SUITABLE, LARGE_LOAD_SUITABLE] } }
   *               requiresRefrigeration: { type: boolean }
   *               specialInstructions: { type: string }
   *     responses:
   *       201: { description: Logistics request created., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to raise a request for this lot., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Lot not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Invalid input, or requested quantity exceeds the lot's available quantity., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     tags: [Logistics]
   *     summary: List logistics requests visible to the caller
   *     description: |
   *       FARMER/FPO_ADMIN see their own requests; ADMIN sees all; a
   *       TRANSPORTER sees every currently-OPEN request regardless of who
   *       raised it (their own status filter is ignored — they only ever
   *       browse OPEN requests here).
   *     parameters:
   *       - name: status
   *         in: query
   *         schema: { type: string, enum: [OPEN, QUOTE_ACCEPTED, CANCELLED] }
   *       - name: cropId
   *         in: query
   *         schema: { type: string, format: uuid }
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated logistics request list., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/logistics/requests", manageRoles, validateBody(createLogisticsRequestBody), asyncHandler(controller.createRequest));
  router.get("/logistics/requests", validateQuery(listLogisticsRequestsQuery), asyncHandler(controller.listRequests));

  /**
   * @openapi
   * /api/logistics/requests/{publicId}:
   *   get:
   *     tags: [Logistics]
   *     summary: Get a logistics request
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Logistics request retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not visible to this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     tags: [Logistics]
   *     summary: Update an open logistics request's location/schedule/requirements
   *     description: Any change resets the previously-calculated estimate — call .../calculate again afterward.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Logistics request updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Only an open request can be updated., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/logistics/requests/:publicId", validateParams(logisticsRequestPublicIdParams), asyncHandler(controller.getRequest));
  router.patch(
    "/logistics/requests/:publicId",
    manageRoles,
    validateParams(logisticsRequestPublicIdParams),
    validateBody(updateLogisticsRequestBody),
    asyncHandler(controller.updateRequest),
  );

  /**
   * @openapi
   * /api/logistics/requests/{publicId}/calculate:
   *   post:
   *     tags: [Logistics]
   *     summary: Calculate FarmLink's own best-effort distance/duration/cost estimate
   *     description: |
   *       Requires pickup and destination coordinates to already be set on
   *       the request (Step 3/12) — this never calls a third-party maps
   *       API; distance is a Haversine straight-line estimate scaled by a
   *       configurable road-distance multiplier, clearly marked as
   *       estimated. Always kept distinct from any provider's own
   *       LogisticsQuote.quotedAmount.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Estimate calculated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Pickup/destination coordinates are missing, or the request is cancelled., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/requests/:publicId/calculate",
    manageRoles,
    validateParams(logisticsRequestPublicIdParams),
    asyncHandler(controller.calculateEstimate),
  );

  /**
   * @openapi
   * /api/logistics/requests/{publicId}/available-providers:
   *   get:
   *     tags: [Logistics]
   *     summary: List every candidate vehicle, eligible or not, with explicit reasons
   *     description: Step 5 — never silently excludes a vehicle; every rejection is an explainable reason code.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Candidate list., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/logistics/requests/:publicId/available-providers",
    manageRoles,
    validateParams(logisticsRequestPublicIdParams),
    asyncHandler(controller.listAvailableProviders),
  );

  /**
   * @openapi
   * /api/logistics/requests/{publicId}/optimize:
   *   post:
   *     tags: [Logistics]
   *     summary: Deterministically rank every currently-active quote and recommend the best one
   *     description: |
   *       Step 9 — a weighted score over price/distance/time/capacity
   *       fit/reliability, all component scores and weights returned
   *       alongside the ranking (never hidden). DO NOT use an LLM: this is
   *       a pure, deterministic calculation — the same input always
   *       produces the same ranking.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Optimization result., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: The request is not open, or there are no active quotes to rank yet., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/requests/:publicId/optimize",
    manageRoles,
    validateParams(logisticsRequestPublicIdParams),
    asyncHandler(controller.optimize),
  );

  /**
   * @openapi
   * /api/logistics/requests/{publicId}/cancel:
   *   post:
   *     tags: [Logistics]
   *     summary: Cancel an open logistics request
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema: { type: object, properties: { reason: { type: string } } }
   *     responses:
   *       200: { description: Logistics request cancelled., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Only an open request can be cancelled, or it is already cancelled., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/requests/:publicId/cancel",
    manageRoles,
    validateParams(logisticsRequestPublicIdParams),
    validateBody(cancelLogisticsRequestBody),
    asyncHandler(controller.cancelRequest),
  );

  return router;
}
