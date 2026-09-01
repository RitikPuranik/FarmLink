import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { sendSuccess } from "../../common/apiResponse";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { AuditService } from "../audit/audit.service";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { AuthRepository } from "../auth/auth.repository";
import { BuyerMatchingService } from "./buyer-matching.service";
import { buyerProfileBody, buyerProfileUpdateBody, counterBody, demandBody, demandUpdateBody, lotParams, offerBody, publicIdParams } from "./buyer-matching.schemas";

/**
 * @openapi
 * /api/buyer-matching/lots/{lotPublicId}/matches:
 *   get:
 *     summary: Get deterministic buyer-demand matches for an authorized lot
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Match score, confidence, factors used/omitted, reasons and warnings }
 *       401: { description: Authentication required }
 *       403: { description: Lot is not owned by the caller }
 * /api/buyer-demands:
 *   post:
 *     summary: Create a buyer demand in DRAFT status
 *     security: [{ bearerAuth: [] }]
 *   get:
 *     summary: List the authenticated buyer's demands
 *     security: [{ bearerAuth: [] }]
 * /api/trade-offers:
 *   post:
 *     summary: Send a digital offer; acceptance is not payment, logistics, or delivery completion
 *     security: [{ bearerAuth: [] }]
 *   get:
 *     summary: List offers the authenticated participant is allowed to see
 *     security: [{ bearerAuth: [] }]
 */

export function createBuyerMatchingRouter(service: BuyerMatchingService, authRepository: AuthRepository, audit: AuditService) {
  const router = Router();
  const { authenticate, requireAnyRole, requireRole } = createAuthMiddleware(authRepository, audit);
  router.use(authenticate);

  router.post("/buyers/profile", requireRole("BUYER"), validateBody(buyerProfileBody), asyncHandler(async (req, res) => sendSuccess(res, await service.createProfile(req.user!, req.body), "Buyer profile created.", 201)));
  router.get("/buyers/profile/me", requireRole("BUYER"), asyncHandler(async (req, res) => sendSuccess(res, await service.me(req.user!), "Buyer profile retrieved.")));
  router.patch("/buyers/profile/me", requireRole("BUYER"), validateBody(buyerProfileUpdateBody), asyncHandler(async (req, res) => sendSuccess(res, await service.updateProfile(req.user!, req.body), "Buyer profile updated.")));
  router.get("/buyers/:publicId", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.buyerByPublicId(req.params.publicId), "Buyer profile retrieved.")));
  for (const [path, status] of [["verify", "VERIFIED"], ["reject", "REJECTED"], ["suspend", "SUSPENDED"]] as const) router.post(`/admin/buyers/:publicId/${path}`, requireRole("ADMIN"), validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.verifyPublic(req.user!, req.params.publicId, status), `Buyer ${path}ed.`)));

  router.post("/buyer-demands", requireRole("BUYER"), validateBody(demandBody), asyncHandler(async (req, res) => sendSuccess(res, await service.createDemand(req.user!, req.body), "Buyer demand created.", 201)));
  router.get("/buyer-demands", requireRole("BUYER"), asyncHandler(async (req, res) => sendSuccess(res, await service.demands(req.user!), "Buyer demands retrieved.")));
  router.get("/buyer-demands/:publicId", requireRole("BUYER"), validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.demand(req.user!, req.params.publicId), "Buyer demand retrieved.")));
  router.patch("/buyer-demands/:publicId", requireRole("BUYER"), validateParams(publicIdParams), validateBody(demandUpdateBody), asyncHandler(async (req, res) => sendSuccess(res, await service.updateDemand(req.user!, req.params.publicId, req.body), "Buyer demand updated.")));
  for (const [path, status] of [["activate", "ACTIVE"], ["pause", "PAUSED"], ["cancel", "CANCELLED"]] as const) router.post(`/buyer-demands/:publicId/${path}`, requireRole("BUYER"), validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.transitionDemand(req.user!, req.params.publicId, status), `Buyer demand ${path}d.`)));

  router.get("/buyer-matching/lots/:lotPublicId/matches", requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN"), validateParams(lotParams), asyncHandler(async (req, res) => sendSuccess(res, await service.matches(req.user!, req.params.lotPublicId), "Buyer matches retrieved.")));
  router.post("/trade-offers", requireAnyRole("FARMER", "FPO_ADMIN", "BUYER"), validateBody(offerBody), asyncHandler(async (req, res) => sendSuccess(res, await service.createOffer(req.user!, req.body), "Trade offer sent.", 201)));
  router.get("/trade-offers", requireAnyRole("FARMER", "FPO_ADMIN", "BUYER", "ADMIN"), asyncHandler(async (req, res) => sendSuccess(res, await service.offers(req.user!), "Trade offers retrieved.")));
  router.get("/trade-offers/:publicId", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.offer(req.user!, req.params.publicId), "Trade offer retrieved.")));
  router.post("/trade-offers/:publicId/counter", validateParams(publicIdParams), validateBody(counterBody), asyncHandler(async (req, res) => sendSuccess(res, await service.counter(req.user!, req.params.publicId, req.body), "Trade offer countered.")));
  router.post("/trade-offers/:publicId/accept", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.accept(req.user!, req.params.publicId), "Trade offer accepted.")));
  router.post("/trade-offers/:publicId/reject", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.offerAction(req.user!, req.params.publicId, "REJECTED"), "Trade offer rejected.")));
  router.post("/trade-offers/:publicId/withdraw", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.offerAction(req.user!, req.params.publicId, "WITHDRAWN"), "Trade offer withdrawn.")));
  router.get("/trade-offers/:publicId/history", validateParams(publicIdParams), asyncHandler(async (req, res) => sendSuccess(res, await service.history(req.user!, req.params.publicId), "Trade offer history retrieved.")));
  return router;
}
