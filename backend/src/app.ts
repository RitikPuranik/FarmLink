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

export interface AppDependencies {
  authRepository: AuthRepository;
  auditService: AuditService;
  /** Only used by the demo admin listing route (modules/users). */
  prisma: PrismaClient;
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

  app.get("/health", (_req, res) => res.status(200).json({ success: true, data: { status: "ok" } }));

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get("/api/docs.json", (_req, res) => res.json(swaggerSpec));
  app.get("/debug-sentry", function mainHandler(req, res) {
    throw new Error("My first Sentry error!");
  });

  app.use("/api/auth", createAuthRouter(authService, deps.authRepository, deps.auditService));
  app.use("/api/admin", createUsersRouter(deps.prisma, deps.authRepository, deps.auditService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  

  return app;
}
