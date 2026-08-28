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
  app.use("/api/farmers", createFarmersRouter(farmersService, deps.authRepository, deps.auditService));
  app.use("/api/farms", createFarmsRouter(farmsService, deps.authRepository, deps.auditService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  

  return app;
}
