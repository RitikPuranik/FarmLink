import cron, { ScheduledTask } from "node-cron";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { captureException } from "../config/sentry";
import { getRedis } from "../config/redis";
import { DataGovMarketProvider } from "../modules/market-data/data-gov.provider";
import { MarketDataService } from "../modules/market-data/market-data.service";
import type { AuditService } from "../modules/audit/audit.service";

export interface MarketSyncJobDeps {
  prisma: PrismaClient;
  auditService: AuditService;
}

/**
 * Registers the daily market-data sync cron (02:00 Asia/Kolkata) if
 * MARKET_SYNC_ENABLED is set and the provider is configured. Returns null
 * (and schedules nothing) otherwise, so the caller can no-op on shutdown.
 */
export function registerMarketSyncJob({ prisma, auditService }: MarketSyncJobDeps): ScheduledTask | null {
  const provider = new DataGovMarketProvider();
  if (!env.MARKET_SYNC_ENABLED || !provider.configured) return null;

  const task = cron.schedule(
    "0 2 * * *",
    async () => {
      const redis = getRedis();
      const lockKey = "market-data:sync-lock";
      const token = `${process.pid}:${Date.now()}`;
      try {
        if (redis && (await redis.set(lockKey, token, "PX", 30 * 60_000, "NX")) !== "OK") {
          logger.info("Market sync skipped: another instance owns the lock");
          return;
        }
        const checkpoint = await prisma.marketDataSyncCheckpoint.findUnique({ where: { source: "data.gov.in" } });
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);
        // Catch-up is always bounded to the last 7 days — never a silent
        // unbounded historical backfill. If the checkpoint is older than
        // that, the days between the checkpoint and sevenDaysAgo are a real
        // coverage gap that this sync will NOT fill; record it explicitly
        // (audit + log) rather than letting it pass unnoticed.
        if (checkpoint?.lastSuccessfulObservedDate && checkpoint.lastSuccessfulObservedDate < sevenDaysAgo) {
          const gapDays = Math.floor(
            (sevenDaysAgo.getTime() - checkpoint.lastSuccessfulObservedDate.getTime()) / 86_400_000,
          );
          logger.warn(
            { lastSuccessfulObservedDate: checkpoint.lastSuccessfulObservedDate, gapDays },
            "Market sync checkpoint gap exceeds the 7-day catch-up window; older data will not be backfilled automatically",
          );
          await auditService.record({
            action: "MARKET_DATA_SYNC_GAP_DETECTED",
            entityType: "MarketDataSyncCheckpoint",
            entityId: "data.gov.in",
            metadata: { lastSuccessfulObservedDate: checkpoint.lastSuccessfulObservedDate.toISOString(), gapDays },
          });
        }
        const from =
          checkpoint?.lastSuccessfulObservedDate && checkpoint.lastSuccessfulObservedDate > sevenDaysAgo
            ? checkpoint.lastSuccessfulObservedDate
            : sevenDaysAgo;
        const result = await new MarketDataService(prisma).run(provider.records(from), "data.gov.in", "INCREMENTAL_SYNC");
        if (result.newestObservedDate) {
          await prisma.marketDataSyncCheckpoint.upsert({
            where: { source: "data.gov.in" },
            create: { source: "data.gov.in", lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() },
            update: { lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() },
          });
        }
        await auditService.record({
          action: "MARKET_DATA_SYNCED",
          entityType: "MarketDataImportRun",
          entityId: result.runId,
          metadata: { imported: result.imported, rejected: result.rejected },
        });
        logger.info({ result }, "Market data sync completed");
      } catch (err) {
        captureException(err, { module: "market_intelligence", operation: "sync" });
        logger.error({ err }, "Market data sync failed");
      } finally {
        if (redis && (await redis.get(lockKey)) === token) await redis.del(lockKey);
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  logger.info("Market data sync scheduled for 02:00 Asia/Kolkata");
  return task;
}
