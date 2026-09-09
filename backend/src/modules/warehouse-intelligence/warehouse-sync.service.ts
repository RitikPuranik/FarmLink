import crypto from "crypto";
import { Prisma, PrismaClient, WarehouseSourceType } from "@prisma/client";
import { logger } from "../../config/logger";
import { captureException } from "../../config/sentry";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { ExternalWarehouseRecord, WarehouseProviderStatus, WarehouseProviderType } from "./providers/warehouse-data-provider";
import { WarehouseProviderRegistry } from "./providers/warehouse-provider-registry";
import { normalizeExternalWarehouseRecord } from "./warehouse-normalization.service";
import { validateNormalizedWarehouseRecord } from "./warehouse-validation.service";
import { WarehouseDuplicateDetectionService } from "./warehouse-duplicate-detection.service";
import { WarehouseSourceReferenceRepository } from "./warehouse-source-reference.repository";

// ---------------------------------------------------------------------------
// Architecture (Part 13 of the ingestion spec):
//
//   WarehouseProviderRegistry -> Provider Results -> Normalization ->
//   Validation -> Duplicate Detection -> Warehouse Sync -> FarmLink Warehouse DB
//
// Every record is handled independently, in its own short transaction
// (Part 14: "a malformed record must NOT rollback an entire provider
// synchronization"). A provider-level failure (network error, disabled
// provider, unavailable source) never stops other providers from running
// (Part 19) and never throws out of this service — it only ever shows up
// as that provider's own status in the returned summary.
// ---------------------------------------------------------------------------

const SOURCE_UNIT_CODE = "SOURCE";

export interface ProviderSyncSummary {
  providerId: string;
  providerType: WarehouseProviderType;
  /** The provider's own fetch status — UNAVAILABLE/FAILED here means "we
   * never got records to work with", not "records failed to persist". */
  status: WarehouseProviderStatus;
  fetched: number;
  created: number;
  updated: number;
  /** Deterministically MATCHED to an existing warehouse: no fields were
   * overwritten, only a new WarehouseSourceReference was attached for
   * provenance (Part 15: never blindly overwrite data this sync doesn't
   * own). */
  linked: number;
  /** Created as an independent warehouse, but flagged because a
   * POSSIBLE_DUPLICATE candidate exists — never auto-merged (Part 11). */
  duplicatesFlagged: number;
  /** Failed validation (Part 9's INVALID level) — dropped, not created. */
  skipped: number;
  /** Threw an unexpected error while normalizing/persisting. */
  failed: number;
  /** Persisted (created/updated/linked) but with at least one non-fatal
   * normalization/validation warning attached (PARTIAL level) — e.g. an
   * unsupported capacity unit or an unrecognized status string. Distinct
   * from `skipped`: these records were NOT dropped. */
  warnings: number;
  errors?: string[];
}

export interface WarehouseSyncSummary {
  runId: string;
  startedAt: Date;
  completedAt: Date;
  providers: ProviderSyncSummary[];
  totals: {
    fetched: number;
    created: number;
    updated: number;
    linked: number;
    duplicatesFlagged: number;
    skipped: number;
    failed: number;
    warnings: number;
  };
}

function sumTotals(providers: ProviderSyncSummary[]): WarehouseSyncSummary["totals"] {
  return providers.reduce(
    (acc, p) => ({
      fetched: acc.fetched + p.fetched,
      created: acc.created + p.created,
      updated: acc.updated + p.updated,
      linked: acc.linked + p.linked,
      duplicatesFlagged: acc.duplicatesFlagged + p.duplicatesFlagged,
      skipped: acc.skipped + p.skipped,
      failed: acc.failed + p.failed,
      warnings: acc.warnings + p.warnings,
    }),
    { fetched: 0, created: 0, updated: 0, linked: 0, duplicatesFlagged: 0, skipped: 0, failed: 0, warnings: 0 },
  );
}

function toWarehouseSourceType(providerType: WarehouseProviderType): WarehouseSourceType {
  return providerType;
}

/** syncProviderRecords/persistOne are only ever reached for non-FarmLink
 * providers (see the guard in run() above) — narrowed here so `ownerType`
 * can be assigned directly from the provider type without a cast. */
type ExternalWarehouseProviderType = Exclude<WarehouseProviderType, "FARMLINK">;

export class WarehouseSyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: WarehouseProviderRegistry,
    private readonly sourceReferences: WarehouseSourceReferenceRepository,
    private readonly duplicateDetection: WarehouseDuplicateDetectionService,
    private readonly auditService: AuditService,
  ) {}

  async run(options: { updatedSince?: Date; actorUserId?: string } = {}): Promise<WarehouseSyncSummary> {
    const runId = crypto.randomUUID();
    const startedAt = new Date();

    await this.auditService.record({
      action: "WAREHOUSE_PROVIDER_SYNC_INITIATED",
      entityType: "WarehouseSync",
      entityId: runId,
      actorUserId: options.actorUserId ?? null,
    });
    trackEvent("warehouse_provider_sync_requested", options.actorUserId ?? "system", { runId });

    const providerResults = await this.registry.fetchAll({ updatedSince: options.updatedSince });

    const providerSummaries: ProviderSyncSummary[] = [];
    for (const result of providerResults) {
      // FarmLink records never flow through this ingestion path at all —
      // FarmLink is already the canonical store for its own warehouses
      // (see FarmLinkWarehouseProvider's own doc comment). Guarded here
      // too so a future accidental change to that provider can't silently
      // start mutating FarmLink-owned rows through the external-source
      // persistence path below.
      if (result.provider.type === "FARMLINK") {
        providerSummaries.push({
          providerId: result.provider.id,
          providerType: result.provider.type,
          status: result.status,
          fetched: result.warehouses.length,
          created: 0,
          updated: 0,
          linked: 0,
          duplicatesFlagged: 0,
          skipped: 0,
          failed: 0,
          warnings: 0,
        });
        continue;
      }

      if (result.status === "UNAVAILABLE" || result.status === "FAILED") {
        if (result.status === "FAILED") {
          trackEvent("warehouse_provider_failed", options.actorUserId ?? "system", {
            providerId: result.provider.id,
            providerType: result.provider.type,
          });
        }
        providerSummaries.push({
          providerId: result.provider.id,
          providerType: result.provider.type,
          status: result.status,
          fetched: 0,
          created: 0,
          updated: 0,
          linked: 0,
          duplicatesFlagged: 0,
          skipped: 0,
          failed: 0,
          warnings: 0,
          errors: result.errors?.map((e) => `${e.code}: ${e.message}`),
        });
        continue;
      }

      const summary = await this.syncProviderRecords(
        { id: result.provider.id, type: result.provider.type as ExternalWarehouseProviderType },
        result.warehouses,
        options.actorUserId,
      );
      providerSummaries.push(summary);

      if (summary.status === "PARTIAL" || summary.skipped > 0 || summary.failed > 0) {
        trackEvent("warehouse_provider_sync_partial", options.actorUserId ?? "system", {
          providerId: result.provider.id,
          skipped: summary.skipped,
          failed: summary.failed,
        });
      }
    }

    const completedAt = new Date();
    const totals = sumTotals(providerSummaries);

    await this.auditService.record({
      action: "WAREHOUSE_PROVIDER_SYNC_COMPLETED",
      entityType: "WarehouseSync",
      entityId: runId,
      actorUserId: options.actorUserId ?? null,
      metadata: { totals, providers: providerSummaries.map((p) => ({ providerId: p.providerId, status: p.status })) },
    });
    trackEvent("warehouse_provider_sync_completed", options.actorUserId ?? "system", { runId, totals });

    logger.info({ runId, totals }, "Warehouse provider sync completed");

    return { runId, startedAt, completedAt, providers: providerSummaries, totals };
  }

  private async syncProviderRecords(
    provider: { id: string; type: ExternalWarehouseProviderType },
    records: ExternalWarehouseRecord[],
    actorUserId: string | undefined,
  ): Promise<ProviderSyncSummary> {
    let created = 0;
    let updated = 0;
    let linked = 0;
    let duplicatesFlagged = 0;
    let skipped = 0;
    let failed = 0;
    let warnings = 0;
    const errors: string[] = [];

    for (const raw of records) {
      try {
        const normalized = normalizeExternalWarehouseRecord(raw);
        const validation = validateNormalizedWarehouseRecord(normalized);

        if (validation.level === "INVALID") {
          skipped += 1;
          trackEvent("warehouse_record_validation_failed", actorUserId ?? "system", {
            providerId: provider.id,
            externalId: raw.externalId,
            errors: validation.errors.map((e) => e.code),
          });
          continue;
        }
        if (validation.level === "PARTIAL") {
          warnings += 1;
        }
        if (validation.warnings.some((w) => w.code === "UNSUPPORTED_CAPACITY_UNIT" || w.code === "UNPARSEABLE_NUMBER")) {
          trackEvent("warehouse_record_normalization_failed", actorUserId ?? "system", {
            providerId: provider.id,
            externalId: raw.externalId,
            warnings: validation.warnings.map((w) => w.code),
          });
        }

        const outcome = await this.persistOne(provider, validation.record);
        if (outcome === "CREATED") created += 1;
        else if (outcome === "UPDATED") updated += 1;
        else if (outcome === "LINKED") linked += 1;
        else if (outcome === "CREATED_POSSIBLE_DUPLICATE") {
          created += 1;
          duplicatesFlagged += 1;
        }
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : "Unknown error persisting warehouse record.";
        errors.push(`${raw.externalId}: ${message}`);
        logger.error({ err, providerId: provider.id, externalId: raw.externalId }, "Failed to persist warehouse record");
        captureException(err, { module: "warehouse_ingestion", operation: "sync_persist", providerId: provider.id });
      }
    }

    const status: WarehouseProviderStatus = failed > 0 || skipped > 0 ? "PARTIAL" : "SUCCESS";
    return {
      providerId: provider.id,
      providerType: provider.type,
      status,
      fetched: records.length,
      created,
      updated,
      linked,
      duplicatesFlagged,
      skipped,
      failed,
      warnings,
      errors: errors.length ? errors.slice(0, 50) : undefined,
    };
  }

  /**
   * Persists exactly one already-validated record. Each call is its own
   * transaction: one record's failure must never touch another (Part 14).
   */
  private async persistOne(
    provider: { id: string; type: ExternalWarehouseProviderType },
    record: ReturnType<typeof normalizeExternalWarehouseRecord>,
  ): Promise<"CREATED" | "UPDATED" | "LINKED" | "CREATED_POSSIBLE_DUPLICATE"> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingReference = await this.sourceReferences.findByProviderExternalId(provider.id, record.externalId);

      if (existingReference) {
        // Same source, same external id as a previous run: this provider
        // owns these fields, so it's safe to refresh them — but only ever
        // with a value the source actually supplied this time (`?? existing`
        // below), never nulling out a previously-known value just because
        // this particular fetch happened not to include it again.
        const warehouse = await tx.warehouse.findUnique({ where: { id: existingReference.warehouseId } });
        if (warehouse) {
          await tx.warehouse.update({
            where: { id: warehouse.id },
            data: {
              name: record.name ?? warehouse.name,
              warehouseType: record.storageType ?? warehouse.warehouseType,
              state: record.location.state ?? warehouse.state,
              district: record.location.district ?? warehouse.district,
              address: record.location.address ?? warehouse.address,
              pincode: record.location.pincode ?? warehouse.pincode,
              latitude: record.location.latitude ?? warehouse.latitude,
              longitude: record.location.longitude ?? warehouse.longitude,
              // Same "only overwrite with what THIS fetch actually
              // supplied" rule as every other field above: a source that
              // reported no status this run leaves the warehouse's
              // existing status/isActive untouched rather than resetting
              // it to a default.
              status: record.status ?? warehouse.status,
              isActive: record.status ? record.status === "ACTIVE" : warehouse.isActive,
            },
          });
          await this.upsertSourceStorageUnit(tx, warehouse.id, record);
        }

        await this.sourceReferences.update(
          existingReference.id,
          {
            sourceUpdatedAt: record.sourceUpdatedAt,
            lastSyncedAt: new Date(),
            metadata: (record.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
          tx,
        );
        return "UPDATED";
      }

      const duplicate = await this.duplicateDetection.detect(record);

      if (duplicate.state === "MATCHED" && duplicate.warehouseId) {
        // Deterministic match to an existing warehouse (possibly
        // FarmLink-owned, possibly from another provider): attach
        // provenance only. Never touch the existing warehouse's fields or
        // storage units — this sync run does not own that data (Part 15).
        await this.sourceReferences.create(
          {
            warehouseId: duplicate.warehouseId,
            sourceType: toWarehouseSourceType(provider.type),
            providerId: provider.id,
            externalId: record.externalId,
            sourceUpdatedAt: record.sourceUpdatedAt,
            lastSyncedAt: new Date(),
            metadata: (record.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          },
          tx,
        );
        return "LINKED";
      }

      // UNMATCHED or POSSIBLE_DUPLICATE both create an independent
      // warehouse — a POSSIBLE_DUPLICATE is reported (duplicatesFlagged
      // above), never silently merged into the candidate (Part 11).
      if (!record.name || !record.location.state || !record.location.district) {
        // Validation should already have rejected this — defensive guard
        // only, never expected to trigger.
        throw new Error("Record passed validation without required identity fields.");
      }

      const warehouse = await tx.warehouse.create({
        data: {
          ownerType: provider.type,
          ownerUserId: null,
          ownerFpoId: null,
          name: record.name,
          warehouseType: record.storageType ?? "AMBIENT",
          state: record.location.state,
          district: record.location.district,
          address: record.location.address,
          pincode: record.location.pincode,
          latitude: record.location.latitude,
          longitude: record.location.longitude,
          // A source that reports no status at all falls back to the
          // schema's own ACTIVE/isActive:true defaults (exactly what
          // every other new Warehouse row already gets) — never a
          // fabricated INACTIVE/SUSPENDED guess.
          status: record.status ?? "ACTIVE",
          isActive: record.status ? record.status === "ACTIVE" : true,
        },
      });

      await this.upsertSourceStorageUnit(tx, warehouse.id, record);

      await this.sourceReferences.create(
        {
          warehouseId: warehouse.id,
          sourceType: toWarehouseSourceType(provider.type),
          providerId: provider.id,
          externalId: record.externalId,
          sourceUpdatedAt: record.sourceUpdatedAt,
          lastSyncedAt: new Date(),
          metadata: (record.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
        tx,
      );

      return duplicate.state === "POSSIBLE_DUPLICATE" ? "CREATED_POSSIBLE_DUPLICATE" : "CREATED";
    });
  }

  /**
   * Creates or refreshes the single "declared capacity from source" unit
   * for an externally-sourced warehouse. Never invents capacity: if the
   * record has none this time, an existing unit is left untouched rather
   * than zeroed out (Part 16 — a provider temporarily omitting a field is
   * not the same fact as the warehouse no longer having capacity).
   */
  private async upsertSourceStorageUnit(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    record: ReturnType<typeof normalizeExternalWarehouseRecord>,
  ): Promise<void> {
    if (!record.capacity || record.capacity.totalKg === null) return;

    const totalCapacity = record.capacity.totalKg;
    const availableCapacity = record.capacity.availableKg ?? totalCapacity;

    const existing = await tx.warehouseStorageUnit.findUnique({
      where: { warehouseId_code: { warehouseId, code: SOURCE_UNIT_CODE } },
    });

    if (existing) {
      await tx.warehouseStorageUnit.update({
        where: { id: existing.id },
        data: {
          storageType: record.storageType ?? existing.storageType,
          totalCapacity,
          availableCapacity,
          capacityUnit: "KG",
          temperatureControlled: record.temperatureControlled ?? existing.temperatureControlled,
          minTemperature: record.minTemperatureC ?? existing.minTemperature,
          maxTemperature: record.maxTemperatureC ?? existing.maxTemperature,
        },
      });
      return;
    }

    await tx.warehouseStorageUnit.create({
      data: {
        warehouseId,
        code: SOURCE_UNIT_CODE,
        storageType: record.storageType ?? "AMBIENT",
        totalCapacity,
        availableCapacity,
        capacityUnit: "KG",
        temperatureControlled: record.temperatureControlled ?? false,
        minTemperature: record.minTemperatureC,
        maxTemperature: record.maxTemperatureC,
      },
    });
  }
}
