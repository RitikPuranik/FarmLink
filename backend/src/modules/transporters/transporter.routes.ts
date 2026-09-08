import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { TransporterController } from "./transporter.controller";
import { TransporterService } from "./transporter.service";
import {
  addServiceAreaBody,
  createTransporterProfileBody,
  listTransportersQuery,
  serviceAreaIdParams,
  transporterPublicIdParams,
  updateTransporterProfileBody,
} from "./transporter.schemas";

/**
 * Registers transporter profile, discovery, and service-area routes
 * (Module 15, Part P). Mounted at "/api" by app.ts — same shape
 * net-realization.routes.ts uses for its own multi-path router.
 */
export function createTransporterRouter(
  transporterService: TransporterService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = new TransporterController(transporterService);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  /**
   * @openapi
   * /api/transporter-profiles:
   *   post:
   *     tags: [Transporters]
   *     summary: Create the authenticated user's transporter profile
   *     description: |
   *       A TRANSPORTER may create exactly one profile for their account. Always
   *       starts with verificationStatus PENDING — never auto-verified. A
   *       transporter profile represents a transport *provider* — an
   *       individual owner-operator, a small business, a company, a
   *       cooperative, or a logistics provider — which may go on to
   *       register any number of vehicles (see POST /api/vehicles). One
   *       provider profile is not one vehicle.
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerType: { type: string, enum: [INDIVIDUAL, BUSINESS, COMPANY, COOPERATIVE, LOGISTICS_PROVIDER], default: INDIVIDUAL }
   *               businessName: { type: string }
   *               legalName: { type: string }
   *               contactName: { type: string }
   *               contactPhone: { type: string }
   *               contactEmail: { type: string, format: email }
   *     responses:
   *       201: { description: Profile created., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Only a TRANSPORTER account may create a transporter profile., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: A transporter profile already exists for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/transporter-profiles",
    authMw,
    requireAnyRole("TRANSPORTER"),
    validateBody(createTransporterProfileBody),
    asyncHandler(controller.createProfile),
  );

  /**
   * @openapi
   * /api/transporter-profiles/me:
   *   get:
   *     tags: [Transporters]
   *     summary: Get the authenticated transporter's own profile
   *     responses:
   *       200: { description: Profile retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     tags: [Transporters]
   *     summary: Update the authenticated transporter's own profile
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               providerType: { type: string, enum: [INDIVIDUAL, BUSINESS, COMPANY, COOPERATIVE, LOGISTICS_PROVIDER] }
   *               businessName: { type: string }
   *               legalName: { type: string }
   *               contactName: { type: string }
   *               contactPhone: { type: string }
   *               contactEmail: { type: string, format: email }
   *     responses:
   *       200: { description: Profile updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/transporter-profiles/me", authMw, requireAnyRole("TRANSPORTER"), asyncHandler(controller.getMyProfile));
  router.patch(
    "/transporter-profiles/me",
    authMw,
    requireAnyRole("TRANSPORTER"),
    validateBody(updateTransporterProfileBody),
    asyncHandler(controller.updateMyProfile),
  );

  /**
   * @openapi
   * /api/transporter-profiles/me/service-areas:
   *   get:
   *     tags: [Transporters]
   *     summary: List the authenticated transporter's own service areas
   *     responses:
   *       200: { description: Service areas retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   post:
   *     tags: [Transporters]
   *     summary: Add a service area for the authenticated transporter
   *     description: |
   *       Administrative/geographic only — never a route, radius, or GPS
   *       coordinate. STATE requires state; DISTRICT requires state+district;
   *       CITY requires state+district+city; PINCODE requires pincode.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [areaType]
   *             properties:
   *               areaType: { type: string, enum: [STATE, DISTRICT, CITY, PINCODE] }
   *               state: { type: string }
   *               district: { type: string }
   *               city: { type: string }
   *               pincode: { type: string }
   *     responses:
   *       201: { description: Service area added., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: This exact service area was already added., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Invalid area hierarchy (e.g. DISTRICT without state)., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/transporter-profiles/me/service-areas",
    authMw,
    requireAnyRole("TRANSPORTER"),
    asyncHandler(controller.listMyServiceAreas),
  );
  router.post(
    "/transporter-profiles/me/service-areas",
    authMw,
    requireAnyRole("TRANSPORTER"),
    validateBody(addServiceAreaBody),
    asyncHandler(controller.addServiceArea),
  );

  /**
   * @openapi
   * /api/transporter-profiles/me/service-areas/{id}:
   *   delete:
   *     tags: [Transporters]
   *     summary: Remove a service area belonging to the authenticated transporter
   *     parameters:
   *       - name: id
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Service area removed., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Service area not found, or does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.delete(
    "/transporter-profiles/me/service-areas/:id",
    authMw,
    requireAnyRole("TRANSPORTER"),
    validateParams(serviceAreaIdParams),
    asyncHandler(controller.removeServiceArea),
  );

  /**
   * @openapi
   * /api/transporters:
   *   get:
   *     tags: [Transporters]
   *     summary: Discover transporters (Part N)
   *     description: |
   *       Pure filtering, never ranking or price/route optimization — that is
   *       Module 16's job. AVAILABLE only means the transporter marked a
   *       vehicle available, never a confirmed booking.
   *     parameters:
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *       - name: state
   *         in: query
   *         schema: { type: string }
   *       - name: district
   *         in: query
   *         schema: { type: string }
   *       - name: vehicleType
   *         in: query
   *         schema: { type: string, enum: [MINI_TRUCK, PICKUP, LIGHT_TRUCK, MEDIUM_TRUCK, HEAVY_TRUCK, TRACTOR_TROLLEY, REFRIGERATED_TRUCK, OTHER] }
   *       - name: minimumCapacity
   *         in: query
   *         schema: { type: number }
   *       - name: minimumCapacityUnit
   *         in: query
   *         schema: { type: string, enum: [KG, QTL, TONNE], default: KG }
   *       - name: refrigerated
   *         in: query
   *         schema: { type: string, enum: [true, false] }
   *       - name: availability
   *         in: query
   *         schema: { type: string, enum: [AVAILABLE, UNAVAILABLE] }
   *       - name: verified
   *         in: query
   *         schema: { type: string, enum: [true, false] }
   *     responses:
   *       200: { description: Paginated transporter results., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/transporters",
    authMw,
    requireAnyRole("FARMER", "FPO_ADMIN", "BUYER", "TRANSPORTER", "ADMIN"),
    validateQuery(listTransportersQuery),
    asyncHandler(controller.listTransporters),
  );

  /**
   * @openapi
   * /api/transporters/{publicId}:
   *   get:
   *     tags: [Transporters]
   *     summary: Get a transporter's PII-safe public profile
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Transporter retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Transporter not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/transporters/:publicId",
    authMw,
    requireAnyRole("FARMER", "FPO_ADMIN", "BUYER", "TRANSPORTER", "ADMIN"),
    validateParams(transporterPublicIdParams),
    asyncHandler(controller.getByPublicId),
  );

  return router;
}
