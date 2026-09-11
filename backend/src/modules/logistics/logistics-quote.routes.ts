import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { LogisticsQuoteController } from "./logistics-quote.controller";
import { LogisticsQuoteService } from "./logistics-quote.service";
import {
  listLogisticsQuotesQuery,
  listMyLogisticsQuotesQuery,
  logisticsQuotePublicIdParams,
  logisticsRequestPublicIdParams,
  submitLogisticsQuoteBody,
  updateLogisticsQuoteBody,
} from "./logistics.schemas";

/**
 * Step 7/8 — Provider Quote API. Mounted at "/api" by app.ts. Submitting a
 * quote (and every write on a quote you own) is TRANSPORTER-only;
 * accepting/rejecting a quote is FARMER/FPO_ADMIN/ADMIN-only (the
 * requester side) — ADMIN may do either. Reading is open to every
 * authenticated role; LogisticsQuoteService itself enforces exactly what
 * each caller may see (a provider never sees a competitor's amount —
 * Step 15).
 */
export function createLogisticsQuoteRouter(
  quoteService: LogisticsQuoteService,
  authRepo: AuthRepository,
  auditService: AuditService,
): Router {
  const router = Router();
  const controller = new LogisticsQuoteController(quoteService);
  const { authenticate: authMw, requireAnyRole } = createAuthMiddleware(authRepo, auditService);

  router.use(authMw);

  const transporterOnly = requireAnyRole("TRANSPORTER", "ADMIN");
  const requesterOnly = requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN");

  /**
   * @openapi
   * /api/logistics/requests/{publicId}/quotes:
   *   post:
   *     tags: [Logistics]
   *     summary: Submit a quote against a logistics request, for one of the caller's own vehicles
   *     description: |
   *       Step 7/15 — the vehicle must belong to the calling transporter's
   *       own profile (re-verified server-side, never trusted from the
   *       body) and must pass VehicleEligibilityService (capacity,
   *       refrigeration, capabilities, active/verified, no conflicting
   *       accepted quote).
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
   *             required: [vehicleId, quotedAmount]
   *             properties:
   *               vehicleId: { type: string, format: uuid }
   *               quotedAmount: { type: number }
   *               currency: { type: string, default: INR }
   *               estimatedPickupTime: { type: string, format: date-time }
   *               estimatedDeliveryTime: { type: string, format: date-time }
   *               notes: { type: string }
   *               validUntil: { type: string, format: date-time }
   *     responses:
   *       201: { description: Quote submitted., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: The vehicle does not belong to this transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request or vehicle not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: The request is not open, or the vehicle is not eligible., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   get:
   *     tags: [Logistics]
   *     summary: List quotes on a logistics request
   *     description: The requester (or ADMIN) sees every quote; a TRANSPORTER sees only their own.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - name: status
   *         in: query
   *         schema: { type: string, enum: [DRAFT, SUBMITTED, EXPIRED, WITHDRAWN, ACCEPTED, REJECTED] }
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated quote list., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Logistics request not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/requests/:publicId/quotes",
    transporterOnly,
    validateParams(logisticsRequestPublicIdParams),
    validateBody(submitLogisticsQuoteBody),
    asyncHandler(controller.submitQuote),
  );
  router.get(
    "/logistics/requests/:publicId/quotes",
    validateParams(logisticsRequestPublicIdParams),
    validateQuery(listLogisticsQuotesQuery),
    asyncHandler(controller.listQuotesForRequest),
  );

  /**
   * @openapi
   * /api/logistics/quotes/mine:
   *   get:
   *     tags: [Logistics]
   *     summary: List the authenticated transporter's own quotes across every request
   *     parameters:
   *       - name: status
   *         in: query
   *         schema: { type: string, enum: [DRAFT, SUBMITTED, EXPIRED, WITHDRAWN, ACCEPTED, REJECTED] }
   *       - name: page
   *         in: query
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - name: limit
   *         in: query
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200: { description: Paginated quote list., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: No transporter profile exists yet for this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get(
    "/logistics/quotes/mine",
    requireAnyRole("TRANSPORTER"),
    validateQuery(listMyLogisticsQuotesQuery),
    asyncHandler(controller.listMyQuotes),
  );

  /**
   * @openapi
   * /api/logistics/quotes/{publicId}:
   *   get:
   *     tags: [Logistics]
   *     summary: Get a quote
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Quote retrieved., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not visible to this account., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Quote not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *   patch:
   *     tags: [Logistics]
   *     summary: Update a submitted quote (owning transporter only)
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Quote updated., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not the owning transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Quote not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Only a submitted quote can be updated., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.get("/logistics/quotes/:publicId", validateParams(logisticsQuotePublicIdParams), asyncHandler(controller.getQuote));
  router.patch(
    "/logistics/quotes/:publicId",
    transporterOnly,
    validateParams(logisticsQuotePublicIdParams),
    validateBody(updateLogisticsQuoteBody),
    asyncHandler(controller.updateQuote),
  );

  /**
   * @openapi
   * /api/logistics/quotes/{publicId}/withdraw:
   *   post:
   *     tags: [Logistics]
   *     summary: Withdraw a submitted quote (owning transporter only)
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Quote withdrawn., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not the owning transporter., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Quote not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Only a submitted quote can be withdrawn., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/quotes/:publicId/withdraw",
    transporterOnly,
    validateParams(logisticsQuotePublicIdParams),
    asyncHandler(controller.withdrawQuote),
  );

  /**
   * @openapi
   * /api/logistics/quotes/{publicId}/accept:
   *   post:
   *     tags: [Logistics]
   *     summary: Accept a quote (requester side only)
   *     description: |
   *       Step 11 — runs as one atomic DB transaction: verifies the request
   *       is still OPEN and the quote still SUBMITTED and unexpired,
   *       accepts the quote, rejects every other competing quote on the
   *       same request, and marks the request QUOTE_ACCEPTED. Two
   *       concurrent accept attempts against the same request can never
   *       both succeed.
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Quote accepted., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage the underlying request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Quote not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: The quote has expired, was already decided, or the request is no longer open., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/quotes/:publicId/accept",
    requesterOnly,
    validateParams(logisticsQuotePublicIdParams),
    asyncHandler(controller.acceptQuote),
  );

  /**
   * @openapi
   * /api/logistics/quotes/{publicId}/reject:
   *   post:
   *     tags: [Logistics]
   *     summary: Reject a single quote without accepting another (requester side only)
   *     parameters:
   *       - name: publicId
   *         in: path
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200: { description: Quote rejected., content: { application/json: { schema: { $ref: '#/components/schemas/SuccessResponse' } } } }
   *       401: { description: Unauthorized., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       403: { description: Not authorized to manage the underlying request., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       404: { description: Quote not found., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   *       422: { description: Only a submitted quote can be rejected., content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
   */
  router.post(
    "/logistics/quotes/:publicId/reject",
    requesterOnly,
    validateParams(logisticsQuotePublicIdParams),
    asyncHandler(controller.rejectQuote),
  );

  return router;
}
