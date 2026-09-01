import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateBody } from "../../middleware/validateBody";
import { validateParams } from "../../middleware/validateParams";
import { validateQuery } from "../../middleware/validateQuery";
import { AuditService } from "../audit/audit.service";
import { AuthRepository } from "../auth/auth.repository";
import { createAuthMiddleware } from "../auth/auth.middleware";
import { createMarketIntelligenceController } from "./market-intelligence.controller";
import { compareQuery, cropIdParams, lotIdParams, mandiIdParams, nearbyQuery, radiusQuery, recommendationBody, snapshotQuery, trendQuery } from "./market-intelligence.schemas";
import { MarketIntelligenceService } from "./market-intelligence.service";
export function createMarketIntelligenceRouter(service: MarketIntelligenceService, authRepo: AuthRepository, audit: AuditService) { const router=Router(), c=createMarketIntelligenceController(service); const { authenticate, requireAnyRole }=createAuthMiddleware(authRepo,audit); router.use(authenticate,requireAnyRole("FARMER","FPO_ADMIN","ADMIN")); router.get("/crops/:cropId/snapshot",validateParams(cropIdParams),validateQuery(snapshotQuery),asyncHandler(c.snapshot)); router.get("/crops/:cropId/trends",validateParams(cropIdParams),validateQuery(trendQuery),asyncHandler(c.trends)); router.get("/crops/:cropId/compare",validateParams(cropIdParams),validateQuery(compareQuery),asyncHandler(c.compare)); router.get("/nearby",validateQuery(nearbyQuery),asyncHandler(c.nearby)); router.post("/recommend-market",validateBody(recommendationBody),asyncHandler(c.recommend)); router.get("/mandis/:mandiId/overview",validateParams(mandiIdParams),asyncHandler(c.overview)); router.get("/mandis/:mandiId/crops/:cropId",validateParams(mandiIdParams.merge(cropIdParams)),asyncHandler(c.mandiCrop)); router.post("/lots/:lotPublicId/recommend-market",validateParams(lotIdParams),validateQuery(radiusQuery),asyncHandler(c.lotRecommend)); return router; }
