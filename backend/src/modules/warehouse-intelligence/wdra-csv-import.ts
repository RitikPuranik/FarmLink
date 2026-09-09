import { prisma } from "../../config/prisma";
import { PrismaAuditService } from "../audit/audit.service";
import { ExternalWarehouseRecord, WarehouseDataProvider, WarehouseProviderResult } from "./providers/warehouse-data-provider";
import { WarehouseProviderRegistry } from "./providers/warehouse-provider-registry";
import { WarehouseDuplicateDetectionService } from "./warehouse-duplicate-detection.service";
import { PrismaWarehouseSourceReferenceRepository } from "./warehouse-source-reference.repository";
import { WarehouseSyncService } from "./warehouse-sync.service";
import { readCsvRows } from "./wdra-csv-parser";
import { mapWdraCsvRowToExternalRecord, WDRA_PROVIDER_ID } from "./wdra-record-mapper";

// ---------------------------------------------------------------------------
// One-time / re-runnable WDRA warehouse importer (Part 1 of the government
// warehouse ingestion spec).
//
//   npm run warehouse:import-wdra -- path/to/wdra.csv
//
// Deliberately does NOT touch Prisma directly beyond what WarehouseSyncService
// already does — this script's only job is CSV -> ExternalWarehouseRecord[]
// (via wdra-csv-parser.ts + wdra-record-mapper.ts), then handing that batch
// to a one-off in-memory WarehouseDataProvider so it flows through the exact
// same WarehouseProviderRegistry -> normalization -> validation -> duplicate
// detection -> WarehouseSyncService pipeline every other provider (including
// the live FCI/IISFM one) uses. This is what makes re-running it safe:
// idempotency comes entirely from WarehouseSyncService's existing
// WarehouseSourceReference upsert logic, not from anything WDRA-specific
// here — see warehouse-sync.service.ts's own comments on that.
// ---------------------------------------------------------------------------

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: npm run warehouse:import-wdra -- <path/to/wdra.csv>");
}

async function main() {
  await prisma.$connect();

  const records: ExternalWarehouseRecord[] = [];
  const statusCounts: Record<string, number> = {};
  let totalRows = 0;

  for await (const row of readCsvRows(file!)) {
    totalRows += 1;
    const record = mapWdraCsvRowToExternalRecord(row);
    records.push(record);
    const statusKey = (record.status ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
  }

  const wdraProvider: WarehouseDataProvider = {
    providerId: WDRA_PROVIDER_ID,
    providerType: "GOVERNMENT",
    fetchWarehouses: async (): Promise<WarehouseProviderResult> => ({
      provider: { id: WDRA_PROVIDER_ID, type: "GOVERNMENT" },
      status: "SUCCESS",
      warehouses: records,
      metadata: { fetchedAt: new Date(), recordCount: records.length },
    }),
  };

  const registry = new WarehouseProviderRegistry([wdraProvider]);
  const sourceReferenceRepository = new PrismaWarehouseSourceReferenceRepository(prisma);
  const duplicateDetection = new WarehouseDuplicateDetectionService(prisma);
  const auditService = new PrismaAuditService(prisma);
  const syncService = new WarehouseSyncService(prisma, registry, sourceReferenceRepository, duplicateDetection, auditService);

  const summary = await syncService.run();
  const wdraSummary = summary.providers.find((p) => p.providerId === WDRA_PROVIDER_ID);

  const report = {
    totalRows,
    created: wdraSummary?.created ?? 0,
    updated: wdraSummary?.updated ?? 0,
    linked: wdraSummary?.linked ?? 0,
    duplicatesFlagged: wdraSummary?.duplicatesFlagged ?? 0,
    invalidSkipped: wdraSummary?.skipped ?? 0,
    warnings: wdraSummary?.warnings ?? 0,
    failed: wdraSummary?.failed ?? 0,
    statusCounts,
    providerStatus: wdraSummary?.status,
    errors: wdraSummary?.errors,
  };

  await auditService.record({
    action: "WDRA_IMPORT_COMPLETED",
    entityType: "WarehouseSync",
    entityId: summary.runId,
    metadata: report,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
