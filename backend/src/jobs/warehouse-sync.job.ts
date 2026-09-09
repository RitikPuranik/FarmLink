import cron, { ScheduledTask } from "node-cron";
import { PrismaClient } from "@prisma/client";
import { isProduction, env } from "../config/env";
import { logger } from "../config/logger";
import { captureException } from "../config/sentry";
import { getRedis } from "../config/redis";
import { WarehouseProviderRegistry } from "../modules/warehouse-intelligence/providers/warehouse-provider-registry";
import { FarmLinkWarehouseProvider } from "../modules/warehouse-intelligence/providers/farmlink-warehouse-provider";
import { FciIisfmWarehouseProvider } from "../modules/warehouse-intelligence/providers/fci-iisfm-warehouse-provider";
import { UnavailablePartnerWarehouseProvider } from "../modules/warehouse-intelligence/providers/partner-warehouse-provider";
import { WarehouseDuplicateDetectionService } from "../modules/warehouse-intelligence/warehouse-duplicate-detection.service";
import { PrismaWarehouseSourceReferenceRepository } from "../modules/warehouse-intelligence/warehouse-source-reference.repository";
import { WarehouseSyncService } from "../modules/warehouse-intelligence/warehouse-sync.service";
import type { AuditService } from "../modules/audit/audit.service";
import {
  decideWarehouseSyncCronScheduling,
  withRedisLock,
  WAREHOUSE_SYNC_CRON_EXPRESSION,
  WAREHOUSE_SYNC_CRON_TIMEZONE,
  WAREHOUSE_SYNC_LOCK_KEY,
} from "./warehouse-sync-cron.guard";

export interface WarehouseSyncJobDeps {
  prisma: PrismaClient;
  auditService: AuditService;
}

/**
 * Registers the daily Warehouse Ecosystem Ingestion cron (02:30
 * Asia/Kolkata) — Module 9 ingestion spec, Parts 15-21/27/30-31.
 * Deliberately built from the same provider/registry/sync-service pieces
 * app.ts wires for the manual admin sync endpoint — there is exactly one
 * warehouse persistence algorithm, the cron here only decides *when* to
 * call it.
 *
 * The production/provider-enabled check happens before cron.schedule is
 * ever called — not inside the callback — so development/test never
 * registers a scheduled task in the first place (Part 16: "do not
 * schedule the cron in development and then immediately return from the
 * callback"). Returns null (and schedules nothing) when the guard says no.
 */
export function registerWarehouseSyncJob({ prisma, auditService }: WarehouseSyncJobDeps): ScheduledTask | null {
  const decision = decideWarehouseSyncCronScheduling({
    isProduction,
    governmentProviderEnabled: env.WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED,
  });

  if (!decision.schedule) {
    if (decision.reason === "NOT_PRODUCTION") {
      logger.info("Warehouse sync cron not scheduled outside production");
    } else {
      logger.info("Warehouse sync cron not scheduled because government provider is disabled");
    }
    return null;
  }

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

  const task = cron.schedule(
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
  return task;
}
