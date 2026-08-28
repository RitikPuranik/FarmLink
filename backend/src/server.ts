import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { initSentry } from "./config/sentry";
import { prisma } from "./config/prisma";
import { PrismaAuthRepository } from "./modules/auth/auth.repository";
import { PrismaAuditService } from "./modules/audit/audit.service";
import { PrismaReferenceDataRepository } from "./modules/reference-data/reference-data.repository";
import { PrismaFarmerProfileRepository } from "./modules/farmers/farmer-profile.repository";
import { PrismaFarmsRepository } from "./modules/farms/farms.repository";
import { PrismaFarmerCropRepository } from "./modules/crops/farmer-crop.repository";

async function main() {
  initSentry();

  const authRepository = new PrismaAuthRepository(prisma);
  const auditService = new PrismaAuditService(prisma);
  const referenceDataRepository = new PrismaReferenceDataRepository(prisma);
  const farmerProfileRepository = new PrismaFarmerProfileRepository(prisma);
  const farmsRepository = new PrismaFarmsRepository(prisma);
  const farmerCropRepository = new PrismaFarmerCropRepository(prisma);

  const app = createApp({
    authRepository,
    auditService,
    prisma,
    referenceDataRepository,
    farmerProfileRepository,
    farmsRepository,
    farmerCropRepository,
  });

  await prisma.$connect();
  logger.info("Database connection established");

  const server = app.listen(env.PORT, () => {
    logger.info(`FarmLink auth service listening on ${env.BACKEND_URL} (port ${env.PORT})`);
    logger.info(`API docs available at ${env.BACKEND_URL}/api/docs`);
  });

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    // Force-exit if graceful shutdown hangs.
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
