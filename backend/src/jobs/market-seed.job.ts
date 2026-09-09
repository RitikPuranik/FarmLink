import cron, { ScheduledTask } from "node-cron";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { captureException } from "../config/sentry";
import { getRedis } from "../config/redis";
import { DataGovMarketProvider } from "../modules/market-data/data-gov.provider";
import { MarketDataService } from "../modules/market-data/market-data.service";
import type { AuditService } from "../modules/audit/audit.service";
import { withRedisLock } from "./warehouse-sync-cron.guard";

export interface MarketSeedJobDeps {
  prisma: PrismaClient;
  auditService: AuditService;
}

/** How far back the one-time seed pulls from data.gov.in. The nightly
 * incremental sync (market-sync.job.ts) takes over from here — it is
 * bounded to a 7-day catch-up window and is not meant to backfill years
 * of history on its own. */
const MARKET_SEED_LOOKBACK_DAYS = 365 * 5;
const MARKET_SEED_LOCK_KEY = "market-data:seed-lock";

/**
 * Registers a daily check (01:00 Asia/Kolkata — before the 02:00
 * incremental sync) that seeds the market price table with five years of
 * history from data.gov.in the first time it finds the table empty, then
 * becomes a permanent no-op. Safe to leave scheduled indefinitely: the
 * "already seeded?" check is a cheap count query, and a Redis lock (when
 * Redis is configured) keeps two instances from racing to seed at once.
 * Returns null (and schedules nothing) when market sync isn't enabled or
 * configured — matching the same guard the incremental sync uses.
 */
export function registerMarketSeedJob({ prisma, auditService }: MarketSeedJobDeps): ScheduledTask | null {
  const provider = new DataGovMarketProvider();
  if (!env.MARKET_SYNC_ENABLED || !provider.configured) return null;

  const task = cron.schedule(
    "0 1 * * *",
    async () => {
      try {
        const outcome = await withRedisLock(getRedis(), MARKET_SEED_LOCK_KEY, 60 * 60_000, async () => {
          const alreadySeeded = (await prisma.mandiPrice.count({ where: { source: "data.gov.in" } })) > 0;
          if (alreadySeeded) return;

          logger.info(
            { lookbackDays: MARKET_SEED_LOOKBACK_DAYS },
            "Market price table is empty — starting one-time historical seed",
          );
          const from = new Date();
          from.setUTCDate(from.getUTCDate() - MARKET_SEED_LOOKBACK_DAYS);

          const result = await new MarketDataService(prisma).run(provider.records(from), "data.gov.in", "HISTORICAL_IMPORT");

          if (result.newestObservedDate) {
            // Hands off a checkpoint so the incremental sync's first run
            // continues from where the seed left off instead of re-walking
            // the same year.
            await prisma.marketDataSyncCheckpoint.upsert({
              where: { source: "data.gov.in" },
              create: { source: "data.gov.in", lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() },
              update: { lastSuccessfulObservedDate: result.newestObservedDate, lastSuccessfulSyncAt: new Date() },
            });
          }
          await auditService.record({
            action: "MARKET_DATA_SEEDED",
            entityType: "MarketDataImportRun",
            entityId: result.runId,
            metadata: { imported: result.imported, rejected: result.rejected, lookbackDays: MARKET_SEED_LOOKBACK_DAYS },
          });
          logger.info({ result }, "Market data historical seed completed");
        });
        if (!outcome.ran) {
          logger.info("Market data seed skipped: another instance owns the lock");
        }
      } catch (err) {
        captureException(err, { module: "market_intelligence", operation: "seed" });
        logger.error({ err }, "Market data historical seed failed");
      }
    },
    { timezone: "Asia/Kolkata" },
  );

  logger.info("Market data seed check scheduled for 01:00 Asia/Kolkata (only acts while the price table is empty)");
  return task;
}
