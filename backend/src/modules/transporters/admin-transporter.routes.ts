import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { TransporterController } from "./transporter.controller";
import { TransporterService } from "./transporter.service";
import { VehicleController } from "./vehicle.controller";
import { VehicleService } from "./vehicle.service";
import { adminVerificationBody, transporterPublicIdParams } from "./transporter.schemas";
import { adminVehicleVerificationBody, vehiclePublicIdParams } from "./vehicle.schemas";

/**
 * Admin-only Module 15 verification routes, mounted at "/api/admin" by
 * app.ts — same split as fpo.routes.ts/admin-fpo.routes.ts.
 */
export function createAdminTransporterRouter(
  transporterService: TransporterService,
  vehicleService: VehicleService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const transporterController = new TransporterController(transporterService);
  const vehicleController = new VehicleController(vehicleService);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  router.use(authMw, requireAnyRole("ADMIN"));

  /**
   * @openapi
   * /api/admin/transporters/{publicId}/verification:
   *   patch:
   *     tags: [Admin - Transporters]
   *     summary: Set a transporter's verification status
   *     description: |
   *       "Verified" means verified per FarmLink's own administrative
   *       workflow, not a claim of government/RTO verification. Allowed
   *       transitions: PENDING -> VERIFIED/REJECTED, VERIFIED -> SUSPENDED,
   *       SUSPENDED -> VERIFIED. REJECTED is terminal.
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
   *               status: { type: string, enum: [PENDING, VERIFIED, REJECTED, SUSPENDED] }
   *     responses:
   *       200: { description: Verification status updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Admin role required., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Transporter not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Invalid verification transition., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/transporters/:publicId/verification",
    validateParams(transporterPublicIdParams),
    validateBody(adminVerificationBody),
    asyncHandler(transporterController.setVerificationStatus),
  );

  /**
   * @openapi
   * /api/admin/vehicles/{publicId}/verification:
   *   patch:
   *     tags: [Admin - Vehicles]
   *     summary: Set a vehicle's verification status
   *     description: |
   *       "Verified" means verified per FarmLink's own administrative
   *       workflow only — this module does not integrate with any external
   *       RTO/government registry, so this is never a claim that the
   *       registration number has been government-verified. Allowed
   *       transitions: PENDING -> VERIFIED/REJECTED only.
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
   *               status: { type: string, enum: [PENDING, VERIFIED, REJECTED] }
   *     responses:
   *       200: { description: Verification status updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Admin role required., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Vehicle not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       409: { description: Invalid verification transition., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.patch(
    "/vehicles/:publicId/verification",
    validateParams(vehiclePublicIdParams),
    validateBody(adminVehicleVerificationBody),
    asyncHandler(vehicleController.setVerificationStatus),
  );

  return router;
}
