import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuditService } from "../audit/audit.service";
import { WarehouseSyncService } from "./warehouse-sync.service";
import { createWarehouseIngestionController } from "./warehouse-ingestion.controller";
import { triggerWarehouseSyncBody } from "./warehouse-ingestion.schemas";

/**
 * Warehouse Ecosystem Ingestion Layer — admin-only trigger for the
 * provider sync pipeline (Part 17/26 of the ingestion spec). Mounted at
 * /api/admin/warehouses (see app.ts). Deliberately its own router rather
 * than folded into warehouse-intelligence.routes.ts's /api/warehouses
 * router: everything in that router is reachable by
 * FARMER/FPO_ADMIN/WAREHOUSE_OPERATOR/ADMIN, whereas nothing here should
 * ever be reachable by anyone but ADMIN — a normal farmer must never be
 * able to trigger a global external-provider sync.
 */
export function createWarehouseIngestionRouter(syncService: WarehouseSyncService, authRepo: AuthRepository, audit: AuditService) {
  const router = Router();
  const controller = createWarehouseIngestionController(syncService);
  const { authenticate, requireAnyRole } = createAuthMiddleware(authRepo, audit);

  router.use(authenticate, requireAnyRole("ADMIN"));

  /**
   * @openapi
   * /api/admin/warehouses/sync:
   *   post:
   *     summary: Trigger the warehouse provider ingestion sync (ADMIN only)
   *     description: >
   *       Runs every registered warehouse data provider (FarmLink,
   *       Government, Private Partner), normalizes and validates whatever
   *       records they return, runs conservative duplicate detection, and
   *       upserts the result into the FarmLink warehouse database. One
   *       provider failing or being unconfigured never fails the whole
   *       run — see the per-provider `status` in the response. A
   *       malformed individual record is skipped, never rolled back
   *       against the rest of the run. Today, Government and Private
   *       Partner both report `UNAVAILABLE` (no real external source is
   *       configured) — this endpoint exists and is fully wired for when
   *       one is.
   *     tags: [Warehouse Ingestion]
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               updatedSince: { type: string, format: date-time }
   *     responses:
   *       200: { description: Sync summary, content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Not authenticated, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not an administrator, content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/sync", validateBody(triggerWarehouseSyncBody), asyncHandler(controller.triggerSync));

  return router;
}
