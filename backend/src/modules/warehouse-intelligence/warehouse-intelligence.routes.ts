import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import { createWarehouseIntelligenceController } from "./warehouse-intelligence.controller";
import {
  nearbyWarehousesQuery,
  updateStorageCapacityBody,
  warehouseAvailabilityQuery,
  warehouseIdParams,
  warehouseStorageUnitParams,
} from "./warehouse-intelligence.schemas";

/**
 * Module 9 Part 2 — Warehouse Intelligence: Storage Availability &
 * Capacity Management. Mounted at /api/warehouses (see app.ts). All
 * routes require authentication; read routes are open to every role that
 * can legitimately want to know about storage (FARMER/FPO_ADMIN look for
 * somewhere to store; WAREHOUSE_OPERATOR checks their own listings;
 * ADMIN sees everything) — the capacity-mutation route is further
 * restricted inside the service (see canManageWarehouse() in
 * warehouse-availability.service.ts), not just by role, since a
 * WAREHOUSE_OPERATOR must own the specific warehouse they're editing.
 */
export function createWarehouseIntelligenceRouter(
  service: WarehouseAvailabilityService,
  authRepo: AuthRepository,
  audit: AuditService,
) {
  const router = Router();
  const controller = createWarehouseIntelligenceController(service);
  const { authenticate, requireAnyRole } = createAuthMiddleware(authRepo, audit);

  router.use(authenticate, requireAnyRole("FARMER", "FPO_ADMIN", "WAREHOUSE_OPERATOR", "ADMIN"));

  /**
   * @openapi
   * /api/warehouses/nearby:
   *   get:
   *     summary: Find nearby warehouses with sufficient available capacity
   *     description: >
   *       Bounding-box + exact Haversine distance search over factual,
   *       persisted warehouse capacity. Never fabricates availability —
   *       a warehouse with no configured capacity is reported as
   *       UNAVAILABLE, not omitted or guessed at. If cropId is supplied,
   *       compatibility is resolved from configured
   *       WarehouseCropCapability rows only (SUPPORTED/UNSUPPORTED/
   *       UNKNOWN — never inferred).
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: query
   *         name: latitude
   *         required: true
   *         schema: { type: number, minimum: -90, maximum: 90 }
   *       - in: query
   *         name: longitude
   *         required: true
   *         schema: { type: number, minimum: -180, maximum: 180 }
   *       - in: query
   *         name: radiusKm
   *         schema: { type: number, minimum: 0, maximum: 500, default: 50 }
   *       - in: query
   *         name: cropId
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: quantity
   *         description: Must be provided together with `unit`.
   *         schema: { type: number, exclusiveMinimum: 0 }
   *       - in: query
   *         name: unit
   *         schema: { type: string, enum: [KG, QTL, TONNE] }
   *     responses:
   *       200:
   *         description: >
   *           Warehouses within radiusKm, sorted by (1) can accommodate
   *           the requested quantity, (2) capacity status
   *           (AVAILABLE > LIMITED > FULL > UNAVAILABLE), (3) distance
   *           ascending, (4) available capacity descending.
   *         content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } }
   *       400: { description: Invalid location, radius, or quantity/unit pairing, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/nearby", validateQuery(nearbyWarehousesQuery), asyncHandler(controller.nearby));

  /**
   * @openapi
   * /api/warehouses/{warehouseId}:
   *   get:
   *     summary: Get warehouse details
   *     description: >
   *       Returns identity/location/status only — no capacity math (see
   *       the availability endpoint for that). Returns 404 for a
   *       warehouse the caller cannot see (e.g. suspended, to a
   *       non-owner/non-admin) rather than 403, so existence itself
   *       isn't leaked.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Warehouse details, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       404: { description: Warehouse not found or not visible, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/:warehouseId", validateParams(warehouseIdParams), asyncHandler(controller.detail));

  /**
   * @openapi
   * /api/warehouses/{warehouseId}/availability:
   *   get:
   *     summary: Get a warehouse's factual storage capacity and availability
   *     description: >
   *       Availability is always derived from persisted
   *       WarehouseStorageUnit rows, normalized internally to KG.
   *       Never a booking or reservation of any kind — a pure read.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: cropId
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: quantity
   *         description: Must be provided together with `unit`.
   *         schema: { type: number, exclusiveMinimum: 0 }
   *       - in: query
   *         name: unit
   *         schema: { type: string, enum: [KG, QTL, TONNE] }
   *     responses:
   *       200:
   *         description: >
   *           capacity.status is one of AVAILABLE/LIMITED/FULL/UNAVAILABLE.
   *           compatibility (only present with cropId) is one of
   *           SUPPORTED/UNSUPPORTED/UNKNOWN. canAccommodate is null
   *           (unknown, never assumed true) when compatibility is UNKNOWN.
   *         content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } }
   *       400: { description: Invalid crop, quantity/unit pairing, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse not found or not visible, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/:warehouseId/availability",
    validateParams(warehouseIdParams),
    validateQuery(warehouseAvailabilityQuery),
    asyncHandler(controller.availability),
  );

  /**
   * @openapi
   * /api/warehouses/{warehouseId}/storage-units/{storageUnitId}/capacity:
   *   patch:
   *     summary: Update a storage unit's total/available capacity
   *     description: >
   *       ADMIN, or the WAREHOUSE_OPERATOR who owns this warehouse
   *       (ownerUserId match). FPO-owned warehouse capacity management by
   *       an FPO_ADMIN is not yet wired in this part (see docs). Rejects
   *       any update where the resulting available capacity would be
   *       negative or exceed the resulting total capacity. Does not
   *       support changing capacityUnit.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: path
   *         name: storageUnitId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               totalCapacity: { type: number, minimum: 0 }
   *               availableCapacity: { type: number, minimum: 0 }
   *     responses:
   *       200: { description: Updated storage unit, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid capacity values, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this warehouse, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse or storage unit not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/:warehouseId/storage-units/:storageUnitId/capacity",
    requireAnyRole("WAREHOUSE_OPERATOR", "ADMIN"),
    validateParams(warehouseStorageUnitParams),
    validateBody(updateStorageCapacityBody),
    asyncHandler(controller.updateCapacity),
  );

  return router;
}
