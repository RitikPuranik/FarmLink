import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { VehicleController } from "./vehicle.controller";
import { VehicleService } from "./vehicle.service";
import {
  listMyVehiclesQuery,
  registerVehicleBody,
  updateAvailabilityBody,
  updateStatusBody,
  updateVehicleBody,
  vehiclePublicIdParams,
} from "./vehicle.schemas";

/**
 * Registers vehicle routes (Module 15, Part P). Mounted at "/api" by
 * app.ts, same shape as transporter.routes.ts.
 */
export function createVehicleRouter(
  vehicleService: VehicleService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = new VehicleController(vehicleService);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  // Every route below is owner-scoped: a TRANSPORTER only ever reaches
  // their own vehicles (loadOwnedOrThrow in vehicle.service.ts), an ADMIN
  // may reach any. No other role manages vehicles directly.
  router.use(authMw, requireAnyRole("TRANSPORTER", "ADMIN"));

  /**
   * @openapi
   * /api/vehicles:
   *   post:
   *     tags: [Vehicles]
   *     summary: Register a vehicle under the authenticated transporter
   *     description: |
   *       Registration numbers are normalized (case/space/hyphen-insensitive)
   *       before the uniqueness check, so "MH12AB1234" and "mh-12-ab-1234"
   *       cannot both be registered. Capacity is Decimal-safe and validated
   *       (must be a positive, finite number in a supported unit).
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [registrationNumber, vehicleType, capacityValue]
   *             properties:
   *               registrationNumber: { type: string }
   *               vehicleType: { type: string, enum: [MINI_TRUCK, PICKUP, LIGHT_TRUCK, MEDIUM_TRUCK, HEAVY_TRUCK, TRACTOR_TROLLEY, REFRIGERATED_TRUCK, OTHER] }
   *               capacityValue: { type: number }
   *               capacityUnit: { type: string, enum: [KG, QTL, TONNE], default: KG }
   *               capabilities: { type: array, items: { type: string, enum: [COVERED, OPEN_BODY, TEMPERATURE_CONTROLLED, BULK_TRANSPORT, SMALL_LOAD_SUITABLE, LARGE_LOAD_SUITABLE] } }
   *               isRefrigerated: { type: boolean }
   *     responses:
   *       201: { description: Vehicle registered., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: A vehicle with this normalized registration number already exists., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Invalid registration number or capacity., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     tags: [Vehicles]
   *     summary: List the authenticated transporter's own vehicles
   *     parameters:
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated vehicle list., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/vehicles", validateBody(registerVehicleBody), asyncHandler(controller.registerVehicle));
  router.get("/vehicles", validateQuery(listMyVehiclesQuery), asyncHandler(controller.listMyVehicles));

  /**
   * @openapi
   * /api/vehicles/{publicId}:
   *   get:
   *     tags: [Vehicles]
   *     summary: Get a vehicle (owner or admin only)
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Vehicle retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Vehicle not found, or does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     tags: [Vehicles]
   *     summary: Update a vehicle's declared attributes (owner or admin only)
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               vehicleType: { type: string }
   *               capacityValue: { type: number }
   *               capacityUnit: { type: string, enum: [KG, QTL, TONNE] }
   *               capabilities: { type: array, items: { type: string } }
   *               isRefrigerated: { type: boolean }
   *     responses:
   *       200: { description: Vehicle updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Vehicle not found, or does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Invalid capacity., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/vehicles/:publicId", validateParams(vehiclePublicIdParams), asyncHandler(controller.getVehicle));
  router.patch(
    "/vehicles/:publicId",
    validateParams(vehiclePublicIdParams),
    validateBody(updateVehicleBody),
    asyncHandler(controller.updateVehicle),
  );

  /**
   * @openapi
   * /api/vehicles/{publicId}/availability:
   *   patch:
   *     tags: [Vehicles]
   *     summary: Update a vehicle's availability (owner or admin only)
   *     description: |
   *       Only AVAILABLE/UNAVAILABLE may be set here. AVAILABLE means this
   *       vehicle can potentially receive a quote request in a future
   *       module — it is never a confirmed booking, and RESERVED/IN_TRANSIT
   *       are reserved for Module 16/17's own internal transitions.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [availabilityStatus]
   *             properties:
   *               availabilityStatus: { type: string, enum: [AVAILABLE, UNAVAILABLE] }
   *     responses:
   *       200: { description: Availability updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Vehicle not found, or does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/vehicles/:publicId/availability",
    validateParams(vehiclePublicIdParams),
    validateBody(updateAvailabilityBody),
    asyncHandler(controller.updateAvailability),
  );

  /**
   * @openapi
   * /api/vehicles/{publicId}/status:
   *   patch:
   *     tags: [Vehicles]
   *     summary: Update a vehicle's operational status
   *     description: |
   *       ACTIVE/INACTIVE/MAINTENANCE are owner-reversible. SUSPENDED may
   *       only be set by an administrator, and once suspended only an
   *       administrator can move the vehicle back to ACTIVE.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [status]
   *             properties:
   *               status: { type: string, enum: [ACTIVE, INACTIVE, MAINTENANCE, SUSPENDED] }
   *     responses:
   *       200: { description: Status updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Only an administrator can suspend a vehicle., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Vehicle not found, or does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Invalid status transition., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/vehicles/:publicId/status",
    validateParams(vehiclePublicIdParams),
    validateBody(updateStatusBody),
    asyncHandler(controller.updateStatus),
  );

  return router;
}
