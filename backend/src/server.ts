import { createApp } from "./app";
import { env, isProduction } from "./config/env";
import { logger } from "./config/logger";
import { captureException, initSentry } from "./config/sentry";
import { prisma } from "./config/prisma";
import { WarehouseProviderRegistry } from "./modules/warehouse-intelligence/providers/warehouse-provider-registry";
import { FarmLinkWarehouseProvider } from "./modules/warehouse-intelligence/providers/farmlink-warehouse-provider";
import { FciIisfmWarehouseProvider } from "./modules/warehouse-intelligence/providers/fci-iisfm-warehouse-provider";
import { UnavailablePartnerWarehouseProvider } from "./modules/warehouse-intelligence/providers/partner-warehouse-provider";
import { WarehouseDuplicateDetectionService } from "./modules/warehouse-intelligence/warehouse-duplicate-detection.service";
import { PrismaWarehouseSourceReferenceRepository } from "./modules/warehouse-intelligence/warehouse-source-reference.repository";
import { WarehouseSyncService } from "./modules/warehouse-intelligence/warehouse-sync.service";
import {
  decideWarehouseSyncCronScheduling,
  withRedisLock,
  WAREHOUSE_SYNC_CRON_EXPRESSION,
  WAREHOUSE_SYNC_CRON_TIMEZONE,
  WAREHOUSE_SYNC_LOCK_KEY,
} from "./modules/warehouse-intelligence/warehouse-sync-cron.guard";
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

  // Warehouse Ecosystem Ingestion Layer — automatic daily FCI/IISFM sync
  // (Module 9 ingestion spec, Parts 15-21/27/30-31). Deliberately built
  // from the same provider/registry/sync-service pieces app.ts wires for
  // the manual admin sync endpoint — there is exactly one warehouse
  // persistence algorithm, the cron below only decides *when* to call it.
  //
  // The production check happens here, before cron.schedule is ever
  // called — not inside the callback — so development/test never
  // registers a scheduled task in the first place (Part 16: "do not
  // schedule the cron in development and then immediately return from
  // the callback").
  let warehouseSyncTask: ScheduledTask | null = null;
  const warehouseCronDecision = decideWarehouseSyncCronScheduling({
    isProduction,
    governmentProviderEnabled: env.WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED,
  });

  if (warehouseCronDecision.schedule) {
    const warehouseProviderRegistry = new WarehouseProviderRegistry([
      new FarmLinkWarehouseProvider(),
      new FciIisfmWarehouseProvider(),
      new UnavailablePartnerWarehouseProvider(),
    ]);
    const warehouseSourceReferenceRepository = new PrismaWarehouseSourceReferenceRepository(prisma);
    const warehouseDuplicateDetectionService = new WarehouseDuplicateDetectionService(prisma);
    const warehouseSyncService = new WarehouseSyncService(
      prisma,
      warehouseProviderRegistry,
      warehouseSourceReferenceRepository,
      warehouseDuplicateDetectionService,
      auditService,
    );

    warehouseSyncTask = cron.schedule(
      WAREHOUSE_SYNC_CRON_EXPRESSION,
      async () => {
        try {
          // Redis distributed lock (Part 19): a safe TTL means a crashed
          // process can never leave the sync permanently locked out, even
          // though the sync itself is expected to finish well inside it.
          const outcome = await withRedisLock(getRedis(), WAREHOUSE_SYNC_LOCK_KEY, 30 * 60_000, async () => {
            logger.info(
              { provider: "fci-iisfm", syncType: "AUTOMATIC", startedAt: new Date().toISOString() },
              "Warehouse provider sync starting",
            );
            const summary = await warehouseSyncService.run();
            logger.info({ runId: summary.runId, totals: summary.totals }, "Warehouse provider sync completed");
          });
          if (!outcome.ran) {
            logger.info("Warehouse sync skipped: another instance owns the lock");
          }
        } catch (err) {
          captureException(err, { module: "warehouse_intelligence", operation: "sync" });
          logger.error({ err }, "Warehouse provider sync failed");
        }
      },
      { timezone: WAREHOUSE_SYNC_CRON_TIMEZONE },
    );
    logger.info("Warehouse sync cron scheduled for 02:30 Asia/Kolkata");
  } else if (warehouseCronDecision.reason === "NOT_PRODUCTION") {
    logger.info("Warehouse sync cron not scheduled outside production");
  } else {
    logger.info("Warehouse sync cron not scheduled because government provider is disabled");
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`FarmLink auth service listening on ${env.BACKEND_URL} (port ${env.PORT})`);
    logger.info(`API docs available at ${env.BACKEND_URL}/api/docs`);
  });

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down gracefully`);
    marketSyncTask?.stop();
    warehouseSyncTask?.stop();
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
