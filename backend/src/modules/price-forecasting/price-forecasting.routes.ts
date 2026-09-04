import { Router } from "express";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { createPriceForecastingController } from "./price-forecasting.controller";
import {
  cropIdParams,
  forecastPublicIdParams,
  generateForecastBody,
  latestForecastQuery,
  listForecastsQuery,
} from "./price-forecasting.schemas";
import { PriceForecastingService } from "./price-forecasting.service";

/**
 * Registers routes for the Price Forecasting API (Module 7 Part 5).
 *
 * RBAC mirrors Market Intelligence (Module 6) rather than Sell vs Store
 * (Module 8): forecasts are crop/market-level analytical data, not
 * scoped to a specific lot or farmer's own records, so there is no
 * per-resource ownership check to layer on top of the coarse role gate —
 * every route below shares the same "authenticated FARMER/FPO_ADMIN/ADMIN"
 * requirement, generation included, matching the build spec's "at
 * minimum support FARMER, FPO_ADMIN, ADMIN" with no separate
 * generation-vs-read distinction (this codebase draws that distinction
 * only where a resource has an owner to protect — a forecast doesn't).
 */
export function createPriceForecastingRouter(
  service: PriceForecastingService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = createPriceForecastingController(service);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  router.use(authMw, requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"));

  /**
   * @openapi
   * /api/price-forecasting/generate:
   *   post:
   *     tags: [Price Forecasting]
   *     summary: Generate or retrieve a deterministic baseline price forecast
   *     description: |
   *       Generates a forecast for a crop/scope/horizon, or transparently returns an
   *       equivalent one already generated (same crop, scope, target date, and model
   *       version) rather than recomputing. Forecasting is a deterministic statistical
   *       baseline (weighted moving average + damped trend) — never an LLM or ML model.
   *       `INSUFFICIENT_DATA` is returned as a normal, successful result (never HTTP 500)
   *       when the underlying historical data does not support a confident prediction.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [cropId, scope]
   *             properties:
   *               cropId: { type: string, format: uuid }
   *               scope:
   *                 oneOf:
   *                   - type: object
   *                     required: [type, mandiId]
   *                     properties: { type: { type: string, enum: [MANDI] }, mandiId: { type: string, format: uuid } }
   *                   - type: object
   *                     required: [type, state]
   *                     properties: { type: { type: string, enum: [REGIONAL] }, state: { type: string }, district: { type: string } }
   *                   - type: object
   *                     required: [type]
   *                     properties: { type: { type: string, enum: [CROP_WIDE] } }
   *               horizonDays: { type: integer, minimum: 1, description: "Defaults to PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS; capped at MAX_HORIZON_DAYS." }
   *     responses:
   *       200: { description: Forecast generated or reused successfully (including INSUFFICIENT_DATA outcomes)., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid request body, scope combination, or horizon., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Crop or mandi not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Domain error (e.g. CROP_NOT_FOUND, MANDI_NOT_FOUND)., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       500: { description: Unexpected failure — the forecast is marked FAILED and captured in Sentry., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post("/generate", validateBody(generateForecastBody), asyncHandler(controller.generate));

  /**
   * @openapi
   * /api/price-forecasting/crops/{cropId}/latest:
   *   get:
   *     tags: [Price Forecasting]
   *     summary: Get the latest valid (COMPLETED, unexpired) forecast for a crop and scope
   *     description: Never recomputes. Returns 404 if no valid forecast has been generated yet for this crop/scope. Scope defaults to CROP_WIDE when no scope query parameters are given.
   *     parameters:
   *       - name: cropId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - name: scopeType
   *         in: query
   *         schema: { type: string, enum: [MANDI, REGIONAL, CROP_WIDE], default: CROP_WIDE }
   *       - name: mandiId
   *         in: query
   *         description: Required when scopeType=MANDI.
   *         schema: { type: string, format: uuid }
   *       - name: state
   *         in: query
   *         description: Required when scopeType=REGIONAL.
   *         schema: { type: string }
   *       - name: district
   *         in: query
   *         schema: { type: string }
   *     responses:
   *       200: { description: Latest valid forecast retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid scope combination., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Crop/mandi not found, or no valid forecast exists yet., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/crops/:cropId/latest",
    validateParams(cropIdParams),
    validateQuery(latestForecastQuery),
    asyncHandler(controller.latestForCrop),
  );

  /**
   * @openapi
   * /api/price-forecasting/crops/{cropId}:
   *   get:
   *     tags: [Price Forecasting]
   *     summary: List forecasts for a crop
   *     description: Bounded, most-recent-first. Never recomputes. Filters are applied to an indexed, bounded result set — see `limit` (maximum 200).
   *     parameters:
   *       - name: cropId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - name: scopeType
   *         in: query
   *         schema: { type: string, enum: [MANDI, REGIONAL, CROP_WIDE] }
   *       - name: mandiId
   *         in: query
   *         schema: { type: string, format: uuid }
   *       - name: startDate
   *         in: query
   *         schema: { type: string, format: date }
   *       - name: endDate
   *         in: query
   *         schema: { type: string, format: date }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 200 }
   *     responses:
   *       200: { description: Forecasts retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid filter combination., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Crop or mandi not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/crops/:cropId", validateParams(cropIdParams), validateQuery(listForecastsQuery), asyncHandler(controller.listForCrop));

  /**
   * @openapi
   * /api/price-forecasting/{forecastPublicId}:
   *   get:
   *     tags: [Price Forecasting]
   *     summary: Get a persisted forecast by its public ID
   *     description: Retrieves a forecast exactly as it was generated. Never recomputes — historical forecasts are immutable.
   *     parameters:
   *       - name: forecastPublicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Forecast retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       400: { description: Invalid forecastPublicId format., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Role is not permitted to use this endpoint., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Forecast not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/:forecastPublicId", validateParams(forecastPublicIdParams), asyncHandler(controller.getByPublicId));

  return router;
}
