import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { WarehouseAvailabilityService } from "./warehouse-availability.service";
import { WarehouseSuitabilityService } from "./warehouse-suitability.service";
import { WarehouseSuitabilityAnalysisService } from "./warehouse-risk-analysis.service";
import { WarehouseRecommendationService } from "./warehouse-recommendation.service";
import { createWarehouseIntelligenceController } from "./warehouse-intelligence.controller";
import {
  cropIdParams,
  nearbyWarehousesQuery,
  recommendWarehousesBody,
  storageEligibilityQuery,
  suitabilityAnalysisQuery,
  updateStorageCapacityBody,
  updateStorageConditionsBody,
  upsertCropStorageRequirementBody,
  warehouseAvailabilityQuery,
  warehouseIdParams,
  warehouseStorageUnitParams,
  warehouseSuitabilityQuery,
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
  suitabilityService: WarehouseSuitabilityService,
  riskAnalysisService: WarehouseSuitabilityAnalysisService,
  recommendationService: WarehouseRecommendationService,
  authRepo: AuthRepository,
  audit: AuditService,
) {
  const router = Router();
  const controller = createWarehouseIntelligenceController(service, suitabilityService, riskAnalysisService, recommendationService);
  const { authenticate, requireAnyRole } = createAuthMiddleware(authRepo, audit);

  router.use(authenticate, requireAnyRole("FARMER", "FPO_ADMIN", "WAREHOUSE_OPERATOR", "ADMIN"));

  /**
   * @openapi
   * /api/warehouses/crop-storage-requirements/{cropId}:
   *   put:
   *     summary: Configure a crop's explicit storage requirements (ADMIN only)
   *     description: >
   *       Upserts the single CropStorageRequirement row for this crop.
   *       Never auto-created for a crop that has no row — the
   *       suitability/eligibility endpoints report UNKNOWN honestly for
   *       any crop without one. Any field omitted from the request body
   *       keeps its previously configured value; there is no "reset to
   *       unconfigured" via this endpoint (delete support is not part of
   *       this scope).
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: cropId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               preferredTemperatureMin: { type: number, nullable: true }
   *               preferredTemperatureMax: { type: number, nullable: true }
   *               preferredHumidityMin: { type: number, nullable: true }
   *               preferredHumidityMax: { type: number, nullable: true }
   *               requiresVentilation: { type: boolean, nullable: true }
   *               requiresColdStorage: { type: boolean, nullable: true }
   *               requiresControlledAtmosphere: { type: boolean, nullable: true }
   *               requiresPestControl: { type: boolean, nullable: true }
   *               requiresMoistureControl: { type: boolean, nullable: true }
   *               compatibleStorageTypes:
   *                 type: array
   *                 items: { type: string, enum: [AMBIENT, COLD_STORAGE, CONTROLLED_ATMOSPHERE, SILO, WAREHOUSE_GODOWN, OTHER] }
   *               maximumRecommendedStorageDays: { type: integer, nullable: true }
   *               notes: { type: string, nullable: true }
   *     responses:
   *       200: { description: Saved crop storage requirement, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid temperature/humidity range, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not an administrator, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Crop not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.put(
    "/crop-storage-requirements/:cropId",
    requireAnyRole("ADMIN"),
    validateParams(cropIdParams),
    validateBody(upsertCropStorageRequirementBody),
    asyncHandler(controller.upsertCropStorageRequirement),
  );

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
   * /api/warehouses/recommend:
   *   post:
   *     summary: Deterministic warehouse recommendation & ranking for a crop
   *     description: >
   *       Discovers candidate warehouses (bounded, indexed query — by
   *       location+radius when latitude/longitude are given, otherwise by
   *       configured crop compatibility), evaluates each through Part 4's
   *       Warehouse Suitability & Risk Analysis (never re-derived here),
   *       excludes UNSUITABLE candidates, separates UNKNOWN
   *       ("insufficient data") candidates into `unevaluableCandidates`
   *       rather than mixing them into `recommendations`, then ranks the
   *       remaining SUITABLE/CONDITIONALLY_SUITABLE candidates by a
   *       deterministic weighted score (distance 30% / suitability 30% /
   *       capacity 20% / cost 20%, proportionally rebalanced per
   *       candidate when a factor — most commonly cost, which requires a
   *       configured rate, a requested quantity, and a requested duration
   *       all at once — is unavailable for that candidate). Never AI,
   *       never a fabricated cost or distance, never a booking. A search
   *       that finds zero matches returns `200` with empty arrays and
   *       full `searchMetadata`/counts, not a 404 — it is a normal,
   *       non-exceptional outcome, the same convention Part 2's own
   *       nearby-search endpoint already uses.
   *     tags: [Warehouse Intelligence]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cropId]
   *             properties:
   *               cropId: { type: string, format: uuid }
   *               latitude:
   *                 type: number
   *                 description: Must be provided together with longitude.
   *               longitude: { type: number }
   *               radiusKm:
   *                 type: number
   *                 description: Only used when latitude/longitude are given; defaults to 50 km, max 500 km.
   *               quantity:
   *                 type: number
   *                 description: Must be provided together with unit.
   *               unit: { type: string, enum: [KG, QTL, TONNE] }
   *               durationDays: { type: integer }
   *     responses:
   *       200: { description: Recommendation results, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid location, radius, quantity/unit pairing, or duration, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Crop not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/recommend", validateBody(recommendWarehousesBody), asyncHandler(controller.recommend));

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
   * /api/warehouses/{warehouseId}/suitability:
   *   get:
   *     summary: Check whether a warehouse is suitable for storing a crop
   *     description: >
   *       A deterministic compatibility check between the crop's explicitly
   *       configured storage requirements (CropStorageRequirement) and the
   *       warehouse's factual, configured storage-unit conditions
   *       (WarehouseStorageUnit) — never AI, never a spoilage prediction,
   *       never a storage guarantee. suitability.status is one of
   *       SUITABLE / CONDITIONALLY_SUITABLE / UNSUITABLE / UNKNOWN.
   *       UNKNOWN is returned honestly (not upgraded to SUITABLE) whenever
   *       the crop has no configured requirements, or the warehouse has no
   *       active storage units with condition data.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: cropId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Suitability result, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid crop id, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse or crop not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/:warehouseId/suitability",
    validateParams(warehouseIdParams),
    validateQuery(warehouseSuitabilityQuery),
    asyncHandler(controller.suitability),
  );

  /**
   * @openapi
   * /api/warehouses/{warehouseId}/storage-eligibility:
   *   get:
   *     summary: Combined capacity + suitability eligibility for a crop
   *     description: >
   *       Composes Part 2's capacity availability with Part 3's storage
   *       suitability, preserving both independently in the response —
   *       overallEligibility never hides whether a rejection came from
   *       capacity or from suitability. Never a booking or reservation.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: cropId
   *         required: true
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
   *           overallEligibility is one of ELIGIBLE / INSUFFICIENT_CAPACITY
   *           / UNSUITABLE / UNKNOWN.
   *         content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } }
   *       400: { description: Invalid crop id or quantity/unit pairing, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse or crop not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/:warehouseId/storage-eligibility",
    validateParams(warehouseIdParams),
    validateQuery(storageEligibilityQuery),
    asyncHandler(controller.storageEligibility),
  );

  /**
   * @openapi
   * /api/warehouses/{warehouseId}/suitability-analysis:
   *   get:
   *     summary: Deterministic suitability & risk analysis for a crop at a warehouse
   *     description: >
   *       Composes Part 2's capacity/crop-compatibility logic and Part 3's
   *       environmental storage-condition suitability with two new
   *       factors — configured maximum storage duration
   *       (WarehouseCropCapability.maxStorageDurationDays) and warehouse
   *       operational status — into one deterministic result with typed
   *       risks, typed constraints, a 0-100 suitabilityScore (weighted,
   *       with proportional rebalancing when a factor is omitted), and a
   *       confidence figure. suitability.status reuses Part 3's own
   *       SUITABLE / CONDITIONALLY_SUITABLE / UNSUITABLE / UNKNOWN values
   *       — UNKNOWN here plays the role of "insufficient data": it is
   *       returned whenever a critical factor (crop compatibility,
   *       capacity, or environmental suitability) could not be
   *       determined, and is never silently upgraded to SUITABLE. Never
   *       AI, never a spoilage prediction, never a booking.
   *     tags: [Warehouse Intelligence]
   *     parameters:
   *       - in: path
   *         name: warehouseId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: cropId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: quantity
   *         description: Must be provided together with `unit`.
   *         schema: { type: number, exclusiveMinimum: 0 }
   *       - in: query
   *         name: unit
   *         schema: { type: string, enum: [KG, QTL, TONNE] }
   *       - in: query
   *         name: durationDays
   *         description: Optional requested storage duration in days.
   *         schema: { type: integer, exclusiveMinimum: 0, maximum: 3650 }
   *     responses:
   *       200: { description: Suitability & risk analysis result, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid crop id, quantity/unit pairing, or duration, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse or crop not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/:warehouseId/suitability-analysis",
    validateParams(warehouseIdParams),
    validateQuery(suitabilityAnalysisQuery),
    asyncHandler(controller.suitabilityAnalysis),
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

  /**
   * @openapi
   * /api/warehouses/{warehouseId}/storage-units/{storageUnitId}/conditions:
   *   patch:
   *     summary: Update a storage unit's declared storage conditions
   *     description: >
   *       ADMIN, or the WAREHOUSE_OPERATOR who owns this warehouse. Updates
   *       temperature/humidity ranges and the five boolean capability
   *       flags (ventilation/cold storage/controlled atmosphere/pest
   *       control/moisture control) that Part 3's suitability engine
   *       compares crop requirements against. These are declared/
   *       configured capabilities, not real-time sensor telemetry. Any
   *       field omitted from the request body keeps its current value.
   *       Rejects an update that would make minTemperature > maxTemperature
   *       or minHumidity > maxHumidity.
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
   *               temperatureControlled: { type: boolean }
   *               minTemperature: { type: number, nullable: true }
   *               maxTemperature: { type: number, nullable: true }
   *               humidityControlled: { type: boolean }
   *               minHumidity: { type: number, nullable: true }
   *               maxHumidity: { type: number, nullable: true }
   *               ventilationAvailable: { type: boolean, nullable: true }
   *               coldStorageAvailable: { type: boolean, nullable: true }
   *               controlledAtmosphereAvailable: { type: boolean, nullable: true }
   *               pestControlAvailable: { type: boolean, nullable: true }
   *               moistureControlAvailable: { type: boolean, nullable: true }
   *     responses:
   *       200: { description: Updated storage unit, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid temperature/humidity range, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage this warehouse, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Warehouse or storage unit not found, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/:warehouseId/storage-units/:storageUnitId/conditions",
    requireAnyRole("WAREHOUSE_OPERATOR", "ADMIN"),
    validateParams(warehouseStorageUnitParams),
    validateBody(updateStorageConditionsBody),
    asyncHandler(controller.updateStorageConditions),
  );

  return router;
}
