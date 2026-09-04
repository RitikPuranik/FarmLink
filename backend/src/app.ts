import express, { Express } from "express";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { PrismaClient } from "@prisma/client";
import { corsMiddleware, securityHeaders } from "./middleware/security";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { swaggerSpec } from "./config/swagger";
import { AuthRepository } from "./modules/auth/auth.repository";
import { AuditService } from "./modules/audit/audit.service";
import { AuthService } from "./modules/auth/auth.service";
import { createAuthRouter } from "./modules/auth/auth.routes";
import { createUsersRouter } from "./modules/users/users.routes";
import { ReferenceDataRepository } from "./modules/reference-data/reference-data.repository";
import { ReferenceDataService } from "./modules/reference-data/reference-data.service";
import { createReferenceDataRouter } from "./modules/reference-data/reference-data.routes";
import { FarmerProfileRepository } from "./modules/farmers/farmer-profile.repository";
import { FarmerProfileResolver } from "./modules/farmers/farmer-profile.resolver";
import { FarmersService } from "./modules/farmers/farmers.service";
import { createFarmersRouter } from "./modules/farmers/farmers.routes";
import { FarmsRepository } from "./modules/farms/farms.repository";
import { FarmsService } from "./modules/farms/farms.service";
import { createFarmsRouter } from "./modules/farms/farms.routes";
import { FarmerCropRepository } from "./modules/crops/farmer-crop.repository";
import { CropsService } from "./modules/crops/crops.service";
import { createCropsRouter } from "./modules/crops/crops.routes";
import { FpoRepository } from "./modules/fpo/fpo.repository";
import { FpoAdminRepository } from "./modules/fpo/fpo-admin.repository";
import { FpoMembershipRepository } from "./modules/fpo/membership.repository";
import { AggregationGroupRepository } from "./modules/fpo/aggregation.repository";
import { FpoAuthorizationService } from "./modules/fpo/fpo.authorization";
import { FpoService } from "./modules/fpo/fpo.service";
import { FpoVerificationService } from "./modules/fpo/fpo-verification.service";
import { FpoAdminService } from "./modules/fpo/fpo-admin.service";
import { FpoMembershipService } from "./modules/fpo/membership.service";
import { FpoAggregationService } from "./modules/fpo/aggregation.service";
import { GovernmentFpoService } from "./modules/fpo/government-fpo.service";
import { NoopFpoNotificationHooks } from "./modules/fpo/notifications";
import { createFpoRouter } from "./modules/fpo/fpo.routes";
import { createMembershipActionsRouter, createMyFpoRouter } from "./modules/fpo/membership.routes";
import { createAdminFpoRouter } from "./modules/fpo/admin-fpo.routes";
import { createGovernmentFpoRouter } from "./modules/fpo/government.routes";
import { CropLotRepository } from "./modules/lots/lots.repository";
import { LotStatusService } from "./modules/lots/lot-status.service";
import { LotAuthorizationService } from "./modules/lots/lot.authorization";
import { SellStoreDecisionRepository } from "./modules/sell-vs-store/sell-vs-store.repository";
import { DecisionInputResolverService } from "./modules/sell-vs-store/sell-store-input-resolver.service";
import { DecisionEngineService } from "./modules/sell-vs-store/sell-store-decision-engine.service";
import { SellStoreOrchestrationService } from "./modules/sell-vs-store/sell-store-orchestration.service";
import { createSellStoreRouter } from "./modules/sell-vs-store/sell-vs-store.routes";
import { SellStoreAIProvider, UnavailableSellStoreAIProvider } from "./modules/sell-vs-store/ai/sell-store-ai.provider";
import { LotsService } from "./modules/lots/lots.service";
import { createFarmerLotsSummaryRouter, createFpoLotsRouter, createLotsRouter } from "./modules/lots/lots.routes";
import { QualityRepository, QualityStandardRepository } from "./modules/quality/quality.repository";
import { QualityStatusService } from "./modules/quality/quality-status.service";
import { QualityGradingService } from "./modules/quality/quality-grading.service";
import { QualityAuthorizationService } from "./modules/quality/quality.authorization";
import { QualityAIProvider, UnavailableQualityAIProvider } from "./modules/quality/ai/quality-ai.provider";
import { QualityService } from "./modules/quality/quality.service";
import {
  createFarmerQualitySummaryRouter,
  createLotQualityRouter,
  createQualityAssessmentRouter,
} from "./modules/quality/quality.routes";
import { env } from "./config/env";
import { MarketIntelligenceRepository } from "./modules/market-intelligence/market-intelligence.repository";
import { MarketIntelligenceService } from "./modules/market-intelligence/market-intelligence.service";
import { createMarketIntelligenceRouter } from "./modules/market-intelligence/market-intelligence.routes";
import { BuyerMatchingService } from "./modules/buyer-matching/buyer-matching.service";
import { createBuyerMatchingRouter } from "./modules/buyer-matching/buyer-matching.routes";
import { PrismaWarehouseRepository } from "./modules/warehouse-intelligence/warehouse.repository";
import { PrismaWarehouseStorageRepository } from "./modules/warehouse-intelligence/warehouse-storage.repository";
import { PrismaWarehouseCapabilityRepository } from "./modules/warehouse-intelligence/warehouse-capability.repository";
import { WarehouseAvailabilityService } from "./modules/warehouse-intelligence/warehouse-availability.service";
import { createWarehouseIntelligenceRouter } from "./modules/warehouse-intelligence/warehouse-intelligence.routes";

export interface AppDependencies {
  authRepository: AuthRepository;
  auditService: AuditService;
  /** Only used by the demo admin listing route (modules/users). */
  prisma: PrismaClient;
  // Module 2 — Farmer & Farm Profile Management. Injected the same way as
  // authRepository/auditService above so tests can supply in-memory fakes
  // instead of a live database (see tests/testUtils/).
  referenceDataRepository: ReferenceDataRepository;
  farmerProfileRepository: FarmerProfileRepository;
  farmsRepository: FarmsRepository;
  farmerCropRepository: FarmerCropRepository;
  // Module 3 — FPO Management & Farmer Aggregation. Same injection pattern.
  fpoRepository: FpoRepository;
  fpoAdminRepository: FpoAdminRepository;
  fpoMembershipRepository: FpoMembershipRepository;
  aggregationGroupRepository: AggregationGroupRepository;
  // Module 4 — Crop / Lot Management. Same injection pattern.
  cropLotRepository: CropLotRepository;
  // Module 5 — Quality Grading & Produce Assessment. Same injection pattern.
  qualityRepository: QualityRepository;
  qualityStandardRepository: QualityStandardRepository;
  // Optional — defaults to the honest-unavailable stub (see
  // UnavailableQualityAIProvider's own comment) when not supplied.
  // server.ts leaves this unset; tests can inject a fake "succeeds"/"low
  // confidence" provider to exercise paths the real default can't reach.
  qualityAiProvider?: QualityAIProvider;
  // Module 8 Part 6 — Sell vs Store AI Advisory Layer. Same optional/default
  // pattern as qualityAiProvider above: server.ts leaves this unset so the
  // app defaults to UnavailableSellStoreAIProvider, and tests can inject a
  // fake provider to exercise the success/failure advisory paths.
  sellStoreAiProvider?: SellStoreAIProvider;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Trust the first proxy hop (typical for Docker/behind a reverse proxy)
  // so req.ip reflects the real client for rate limiting/audit logs.
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(cookieParser());

  const authService = new AuthService(deps.authRepository, deps.auditService);

  const referenceDataService = new ReferenceDataService(deps.referenceDataRepository);
  const farmerProfileResolver = new FarmerProfileResolver(deps.farmerProfileRepository);
  const farmersService = new FarmersService(
    deps.farmerProfileRepository,
    farmerProfileResolver,
    deps.farmsRepository,
    deps.farmerCropRepository,
    referenceDataService,
    deps.auditService,
  );
  const farmsService = new FarmsService(
    deps.farmsRepository,
    farmerProfileResolver,
    referenceDataService,
    deps.auditService,
  );
  const cropsService = new CropsService(
    deps.farmerCropRepository,
    deps.farmsRepository,
    farmerProfileResolver,
    referenceDataService,
    deps.auditService,
  );

  // Module 3 — FPO Management & Farmer Aggregation.
  const fpoAuthorization = new FpoAuthorizationService(deps.fpoAdminRepository);
  const fpoNotifications = new NoopFpoNotificationHooks();
  const fpoService = new FpoService(
    deps.fpoRepository,
    deps.fpoAdminRepository,
    deps.fpoMembershipRepository,
    referenceDataService,
    fpoAuthorization,
    deps.auditService,
  );
  const fpoVerificationService = new FpoVerificationService(
    deps.fpoRepository,
    deps.fpoMembershipRepository,
    deps.auditService,
    fpoNotifications,
  );
  const fpoAdminService = new FpoAdminService(deps.fpoRepository, deps.fpoAdminRepository, deps.authRepository, deps.auditService);
  const fpoMembershipService = new FpoMembershipService(
    deps.fpoMembershipRepository,
    deps.fpoRepository,
    farmerProfileResolver,
    fpoAuthorization,
    deps.auditService,
    fpoNotifications,
  );
  const fpoAggregationService = new FpoAggregationService(
    deps.fpoRepository,
    deps.fpoMembershipRepository,
    deps.farmerCropRepository,
    deps.farmerProfileRepository,
    deps.aggregationGroupRepository,
    referenceDataService,
    fpoAuthorization,
    deps.auditService,
  );
  const governmentFpoService = new GovernmentFpoService(
    deps.fpoRepository,
    deps.fpoMembershipRepository,
    deps.farmerCropRepository,
  );

  // Module 4 — Crop / Lot Management.
  const lotStatusService = new LotStatusService();
  const lotAuthorization = new LotAuthorizationService(fpoAuthorization);
  const lotsService = new LotsService(
    deps.cropLotRepository,
    deps.farmsRepository,
    deps.farmerCropRepository,
    farmerProfileResolver,
    deps.fpoRepository,
    referenceDataService,
    lotStatusService,
    lotAuthorization,
    deps.auditService,
    env.FRONTEND_URL,
  );

  // Module 5 — Quality Grading & Produce Assessment.
  const qualityStatusService = new QualityStatusService();
  const qualityGradingService = new QualityGradingService(deps.qualityStandardRepository);
  const qualityAuthorization = new QualityAuthorizationService(lotAuthorization, fpoAuthorization);
  // Build spec section 19/21: no real AI vendor is configured in this
  // codebase — see UnavailableQualityAIProvider's own comment. Swap this
  // one line for a real provider implementation later without touching
  // QualityService.
  const qualityAiProvider = deps.qualityAiProvider ?? new UnavailableQualityAIProvider();
  const qualityService = new QualityService(
    deps.qualityRepository,
    deps.cropLotRepository,
    farmerProfileResolver,
    qualityGradingService,
    qualityStatusService,
    qualityAuthorization,
    qualityAiProvider,
    deps.auditService,
  );

  // Module 6 — read-only intelligence over the shared market-data store.
  // Shared with Module 8's DecisionInputResolverService below — this is a
  // thin, stateless wrapper over `deps.prisma` (see
  // market-intelligence.repository.ts), so one instance is safe and
  // avoids constructing a second identical object for the same data.
  const marketIntelligenceRepository = new MarketIntelligenceRepository(deps.prisma);
  const marketIntelligenceService = new MarketIntelligenceService(
    marketIntelligenceRepository,
    deps.cropLotRepository,
    lotAuthorization,
    farmerProfileResolver,
    deps.auditService,
  );
  const buyerMatchingService = new BuyerMatchingService(
    deps.prisma,
    deps.cropLotRepository,
    lotAuthorization,
    farmerProfileResolver,
    deps.auditService,
  );

  // Module 9 Part 2 — Warehouse Intelligence. Same "thin wrapper over
  // deps.prisma, constructed inline" pattern as marketIntelligenceRepository
  // above rather than an AppDependencies field, since Part 1 established
  // these as plain Prisma-backed repositories with no test-fake need yet.
  const warehouseRepository = new PrismaWarehouseRepository(deps.prisma);
  const warehouseStorageRepository = new PrismaWarehouseStorageRepository(deps.prisma);
  const warehouseCapabilityRepository = new PrismaWarehouseCapabilityRepository(deps.prisma);
  const warehouseAvailabilityService = new WarehouseAvailabilityService(
    warehouseRepository,
    warehouseStorageRepository,
    warehouseCapabilityRepository,
    referenceDataService,
    deps.auditService,
  );

  app.get("/health", (_req, res) => res.status(200).json({ success: true, data: { status: "ok" } }));

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/docs.json", (_req, res) => res.json(swaggerSpec));
  app.get("/debug-sentry", function mainHandler(req, res) {
    throw new Error("My first Sentry error!");
  });

  app.use("/api/auth", createAuthRouter(authService, deps.authRepository, deps.auditService));
  app.use("/api/admin", createUsersRouter(deps.prisma, deps.authRepository, deps.auditService));

  app.use("/api/reference", createReferenceDataRouter(referenceDataService, deps.authRepository, deps.auditService));
  app.use("/api/farmers/me/crops", createCropsRouter(cropsService, deps.authRepository, deps.auditService));
  app.use("/api/farmers/me/fpo", createMyFpoRouter(fpoMembershipService, deps.authRepository, deps.auditService));
  app.use("/api/farmers", createFarmersRouter(farmersService, deps.authRepository, deps.auditService));
  app.use("/api/farms", createFarmsRouter(farmsService, deps.authRepository, deps.auditService));

  // Module 3 — FPO Management & Farmer Aggregation.
  app.use(
    "/api/fpos",
    createFpoRouter(fpoService, fpoMembershipService, fpoAggregationService, deps.authRepository, deps.auditService),
  );
  app.use(
    "/api/fpo-memberships",
    createMembershipActionsRouter(fpoMembershipService, deps.authRepository, deps.auditService),
  );
  app.use(
    "/api/admin",
    createAdminFpoRouter(fpoService, fpoVerificationService, fpoAdminService, deps.authRepository, deps.auditService),
  );
  app.use("/api/government", createGovernmentFpoRouter(governmentFpoService, deps.authRepository, deps.auditService));

  // Module 4 — Crop / Lot Management.
  app.use("/api/lots", createLotsRouter(lotsService, deps.authRepository, deps.auditService));
  app.use("/api/farmers/me/lots", createFarmerLotsSummaryRouter(lotsService, deps.authRepository, deps.auditService));
  // Mounted at the same /api/fpos prefix as Module 3's own router (fpo.routes.ts)
  // — a second, separate router at the same prefix, not a change to that file.
  app.use("/api/fpos", createFpoLotsRouter(lotsService, deps.authRepository, deps.auditService));

  // Module 5 — Quality Grading & Produce Assessment.
  // Mounted at the same /api/lots prefix as Module 4's own router, same
  // reasoning as /api/fpos above — createLotsRouter has no route matching
  // "quality-assessments"/"quality-summary" as a second path segment, so
  // Express falls through to this router untouched.
  app.use("/api/lots", createLotQualityRouter(qualityService, deps.authRepository, deps.auditService));
  app.use("/api/quality-assessments", createQualityAssessmentRouter(qualityService, deps.authRepository, deps.auditService));
  app.use(
    "/api/farmers/me/quality-summary",
    createFarmerQualitySummaryRouter(qualityService, deps.authRepository, deps.auditService),
  );

  app.use(
    "/api/market-intelligence",
    createMarketIntelligenceRouter(marketIntelligenceService, deps.authRepository, deps.auditService),
  );
  app.use("/api", createBuyerMatchingRouter(buyerMatchingService, deps.authRepository, deps.auditService));
  app.use(
    "/api/warehouses",
    createWarehouseIntelligenceRouter(warehouseAvailabilityService, deps.authRepository, deps.auditService),
  );

  // Module 8 — Sell vs Store Decision Engine
  const sellStoreDecisionRepository = new SellStoreDecisionRepository(deps.prisma);
  const decisionInputResolverService = new DecisionInputResolverService(
    deps.cropLotRepository,
    deps.qualityRepository,
    marketIntelligenceRepository // Reusing the same instance Module 6 uses above
  );
  const decisionEngineService = new DecisionEngineService();
  // Module 8 Part 6: no real AI vendor is configured in this codebase —
  // see UnavailableSellStoreAIProvider's own comment. Swap this one line
  // for a real provider implementation later without touching
  // SellStoreOrchestrationService.
  const sellStoreAiProvider = deps.sellStoreAiProvider ?? new UnavailableSellStoreAIProvider();
  const sellStoreOrchestrationService = new SellStoreOrchestrationService(
    deps.cropLotRepository,
    sellStoreDecisionRepository,
    decisionInputResolverService,
    decisionEngineService,
    sellStoreAiProvider,
    deps.auditService
  );

  app.use(
    "/api/sell-vs-store",
    createSellStoreRouter(
      sellStoreOrchestrationService,
      deps.cropLotRepository,
      lotAuthorization,
      farmerProfileResolver,
      deps.authRepository,
      deps.auditService
    )
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  

  return app;
}
