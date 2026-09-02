import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { captureException, initSentry } from "./config/sentry";
import { prisma } from "./config/prisma";
import { PrismaAuthRepository } from "./modules/auth/auth.repository";
import { PrismaAuditService } from "./modules/audit/audit.service";
import { PrismaReferenceDataRepository } from "./modules/reference-data/reference-data.repository";
import { PrismaFarmerProfileRepository } from "./modules/farmers/farmer-profile.repository";
import { PrismaFarmsRepository } from "./modules/farms/farms.repository";
import { PrismaFarmerCropRepository } from "./modules/crops/farmer-crop.repository";
import { PrismaFpoRepository } from "./modules/fpo/fpo.repository";
import { PrismaFpoAdminRepository } from "./modules/fpo/fpo-admin.repository";
import { PrismaFpoMembershipRepository } from "./modules/fpo/membership.repository";
import { PrismaAggregationGroupRepository } from "./modules/fpo/aggregation.repository";
import { PrismaCropLotRepository } from "./modules/lots/lots.repository";
import { PrismaQualityRepository, PrismaQualityStandardRepository } from "./modules/quality/quality.repository";
import cron, { ScheduledTask } from "node-cron";
import { getRedis } from "./config/redis";
import { DataGovMarketProvider } from "./modules/market-data/data-gov.provider";
import { MarketDataService } from "./modules/market-data/market-data.service";

async function main() {
  initSentry();

  const authRepository = new PrismaAuthRepository(prisma);
  const auditService = new PrismaAuditService(prisma);
  const referenceDataRepository = new PrismaReferenceDataRepository(prisma);
  const farmerProfileRepository = new PrismaFarmerProfileRepository(prisma);
  const farmsRepository = new PrismaFarmsRepository(prisma);
  const farmerCropRepository = new PrismaFarmerCropRepository(prisma);
  const fpoRepository = new PrismaFpoRepository(prisma);
  const fpoAdminRepository = new PrismaFpoAdminRepository(prisma);
  const fpoMembershipRepository = new PrismaFpoMembershipRepository(prisma);
  const aggregationGroupRepository = new PrismaAggregationGroupRepository(prisma);
  const cropLotRepository = new PrismaCropLotRepository(prisma);
  const qualityRepository = new PrismaQualityRepository(prisma);
  const qualityStandardRepository = new PrismaQualityStandardRepository(prisma);

  const app = createApp({
    authRepository,
    auditService,
    prisma,
    referenceDataRepository,
    farmerProfileRepository,
    farmsRepository,
    farmerCropRepository,
    fpoRepository,
    fpoAdminRepository,
    fpoMembershipRepository,
    aggregationGroupRepository,
    cropLotRepository,
    qualityRepository,
    qualityStandardRepository,
  });

  await prisma.$connect();
  logger.info("Database connection established");

  let marketSyncTask: ScheduledTask | null = null;
  const provider = new DataGovMarketProvider();
  if (env.MARKET_SYNC_ENABLED && provider.configured) {
    marketSyncTask = cron.schedule("0 2 * * *", async () => {
      const redis = getRedis(); const lockKey = "market-data:sync-lock"; const token = `${process.pid}:${Date.now()}`;
      try {
        if (redis && (await redis.set(lockKey, token, "PX", 30 * 60_000, "NX")) !== "OK") { logger.info("Market sync skipped: another instance owns the lock"); return; }
        const checkpoint = await prisma.marketDataSyncCheckpoint.findUnique({ where: { source: "data.gov.in" } });
        const sevenDaysAgo = new Date(); sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
        // Catch-up is always bounded to the last 7 days — never a silent
        // unbounded historical backfill. If the checkpoint is older than
        // that, the days between the checkpoint and sevenDaysAgo are a real
        // coverage gap that this sync will NOT fill; record it explicitly
        // (audit + log) rather than letting it pass unnoticed.
        if (checkpoint?.lastSuccessfulObservedDate && checkpoint.lastSuccessfulObservedDate < sevenDaysAgo) {
          const gapDays = Math.floor((sevenDaysAgo.getTime() - checkpoint.lastSuccessfulObservedDate.getTime()) / 86_400_000);
          logger.warn({ lastSuccessfulObservedDate: checkpoint.lastSuccessfulObservedDate, gapDays }, "Market sync checkpoint gap exceeds the 7-day catch-up window; older data will not be backfilled automatically");
          await auditService.record({ action: "MARKET_DATA_SYNC_GAP_DETECTED", entityType: "MarketDataSyncCheckpoint", entityId: "data.gov.in", metadata: { lastSuccessfulObservedDate: checkpoint.lastSuccessfulObservedDate.toISOString(), gapDays } });
        }
        const from = checkpoint?.lastSuccessfulObservedDate && checkpoint.lastSuccessfulObservedDate > sevenDaysAgo ? checkpoint.lastSuccessfulObservedDate : sevenDaysAgo;
        const result = await new MarketDataService(prisma).run(provider.records(from), "data.gov.in", "INCREMENTAL_SYNC");
        if (result.newestObservedDate) await prisma.marketDataSyncCheckpoint.upsert({ where: { source: "data.gov.in" }, create: { source: "data.gov.in", lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() }, update: { lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() } });
        await auditService.record({ action: "MARKET_DATA_SYNCED", entityType: "MarketDataImportRun", entityId: result.runId, metadata: { imported: result.imported, rejected: result.rejected } });
        logger.info({ result }, "Market data sync completed");
      } catch (err) { captureException(err, { module: "market_intelligence", operation: "sync" }); logger.error({ err }, "Market data sync failed"); }
      finally { if (redis && await redis.get(lockKey) === token) await redis.del(lockKey); }
    }, { timezone: "Asia/Kolkata" });
    logger.info("Market data sync scheduled for 02:00 Asia/Kolkata");
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`FarmLink auth service listening on ${env.BACKEND_URL} (port ${env.PORT})`);
    logger.info(`API docs available at ${env.BACKEND_URL}/api/docs`);
  });

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    marketSyncTask?.stop();
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
