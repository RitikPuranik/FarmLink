// Bypass expired SSL certificate on api.iisfm.nic.in (government site)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Increase rate-limit delay and retries for bulk historical pull (avoids 429s)
process.env.MARKET_DATA_GOV_RATE_LIMIT_MS = process.env.MARKET_DATA_GOV_RATE_LIMIT_MS || "2000";
process.env.MARKET_DATA_GOV_MAX_RETRIES = process.env.MARKET_DATA_GOV_MAX_RETRIES || "5";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "warn";

async function syncLocationCatalog(prisma: any) {
  console.log("\n==========================================");
  console.log("  Step 3: Populating State & District Catalog");
  console.log("==========================================");

  const [mandis, warehouses] = await Promise.all([
    prisma.mandi.findMany({ select: { state: true, district: true }, distinct: ["state", "district"] }),
    prisma.warehouse.findMany({ select: { state: true, district: true }, distinct: ["state", "district"] }),
  ]);

  const toTitleCase = (s: string) =>
    s
      .toLowerCase()
      .split(/[\s_]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
      .trim();

  const stateDistrictsMap = new Map<string, Set<string>>();
  for (const item of [...mandis, ...warehouses]) {
    if (!item.state || !item.district) continue;
    const cleanState = toTitleCase(item.state);
    const cleanDistrict = toTitleCase(item.district);
    if (!cleanState || !cleanDistrict) continue;

    if (!stateDistrictsMap.has(cleanState)) {
      stateDistrictsMap.set(cleanState, new Set());
    }
    stateDistrictsMap.get(cleanState)!.add(cleanDistrict);
  }

  // 1. Bulk insert all new states
  const stateNames = Array.from(stateDistrictsMap.keys());
  if (stateNames.length > 0) {
    await prisma.state.createMany({
      data: stateNames.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  // 2. Fetch all states to get their IDs
  const allStates = await prisma.state.findMany({ select: { id: true, name: true } });
  const stateIdByName = new Map(allStates.map((s: any) => [s.name, s.id]));

  // 3. Prepare districts to insert
  const districtsToInsert: { stateId: string; name: string }[] = [];
  for (const [stateName, districtSet] of stateDistrictsMap.entries()) {
    const stateId = stateIdByName.get(stateName);
    if (!stateId) continue;
    for (const districtName of districtSet) {
      districtsToInsert.push({ stateId, name: districtName });
    }
  }

  if (districtsToInsert.length > 0) {
    await prisma.district.createMany({
      data: districtsToInsert,
      skipDuplicates: true,
    });
  }

  const totalStates = await prisma.state.count();
  const totalDistricts = await prisma.district.count();
  console.log(`✅ State & District catalog updated: ${totalStates} States and ${totalDistricts} Districts available in database.`);
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const { DataGovMarketProvider } = await import("../modules/market-data/data-gov.provider");
  const { MarketDataService } = await import("../modules/market-data/market-data.service");
  const { WarehouseSyncService } = await import("../modules/warehouse-intelligence/warehouse-sync.service");
  const { WarehouseProviderRegistry } = await import("../modules/warehouse-intelligence/providers/warehouse-provider-registry");
  const { PrismaWarehouseSourceReferenceRepository } = await import("../modules/warehouse-intelligence/warehouse-source-reference.repository");
  const { WarehouseDuplicateDetectionService } = await import("../modules/warehouse-intelligence/warehouse-duplicate-detection.service");
  const { PrismaAuditService } = await import("../modules/audit/audit.service");
  const { FarmLinkWarehouseProvider } = await import("../modules/warehouse-intelligence/providers/farmlink-warehouse-provider");
  const { FciIisfmWarehouseProvider } = await import("../modules/warehouse-intelligence/providers/fci-iisfm-warehouse-provider");
  const { UnavailablePartnerWarehouseProvider } = await import("../modules/warehouse-intelligence/providers/partner-warehouse-provider");
  const { logger } = await import("../config/logger");
  logger.level = "warn";

  const prisma = new PrismaClient();
  const auditService = new PrismaAuditService(prisma);

  // 1. Run Warehouse Sync
  console.log("\n==========================================");
  console.log("  Step 1: Running Warehouse Sync          ");
  console.log("==========================================");
  const registry = new WarehouseProviderRegistry([
    new FarmLinkWarehouseProvider(),
    new FciIisfmWarehouseProvider(),
    new UnavailablePartnerWarehouseProvider(),
  ]);
  const sourceRefs = new PrismaWarehouseSourceReferenceRepository(prisma);
  const dupDetection = new WarehouseDuplicateDetectionService(prisma);
  const warehouseSync = new WarehouseSyncService(prisma, registry, sourceRefs, dupDetection, auditService);

  const isFull = process.argv.includes("--full") || process.env.SYNC_FULL === "true";
  const maxWarehouses = isFull ? undefined : (parseInt(process.env.WAREHOUSE_SYNC_MAX_RECORDS || "50", 10) || 50);

  try {
    console.log(`Starting warehouse sync (mode: ${isFull ? "full dataset" : `bounded batch of ${maxWarehouses} records`})...`);
    const whResult = await warehouseSync.run({ maxRecords: maxWarehouses });
    console.log("✅ Warehouse Sync completed successfully!");
    console.log(
      `   Totals -> Fetched: ${whResult.totals.fetched}, Created: ${whResult.totals.created}, ` +
      `Updated: ${whResult.totals.updated}, Unchanged: ${whResult.totals.unchanged}`
    );
  } catch (err) {
    console.error("❌ Warehouse Sync failed:", err);
  }

  // 3. Run Market Data Seed
  console.log("\n==========================================");
  console.log("  Step 2: Running Market Data Seed        ");
  console.log("==========================================");
  const marketProvider = new DataGovMarketProvider();
  if (marketProvider.configured) {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 365 * 5);

    // Limit records for CLI run if specified, or default to 500 records for fast seeding
    // Set MARKET_SEED_MAX_RECORDS=0 or pass --full to pull full dataset
    const isFull = process.argv.includes("--full") || process.env.MARKET_SEED_MAX_RECORDS === "0";
    const maxRecords = isFull ? undefined : (parseInt(process.env.MARKET_SEED_MAX_RECORDS || "500", 10) || 500);

    console.log(`Starting seed (mode: ${isFull ? "unbounded full 5-year pull" : `bounded batch of ${maxRecords} records`})...`);

    try {
      const result = await new MarketDataService(prisma).run(
        marketProvider.records(from, maxRecords),
        "data.gov.in",
        "HISTORICAL_IMPORT"
      );
      console.log("✅ Market Data Seed completed successfully!");
      console.log(`   Records -> Read: ${result.read}, Imported: ${result.imported}, Rejected: ${result.rejected}`);
      if (result.newestObservedDate) {
        console.log(`   Newest Observed Date: ${result.newestObservedDate.toISOString().slice(0, 10)}`);
      }
    } catch (err) {
      console.error("❌ Market Data Seed failed:", err);
    }
  } else {
    console.log("⚠️ Market Data provider is not configured. Skipping.");
  }

  // 4. Populate State and District catalog from ingested warehouses and mandis
  await syncLocationCatalog(prisma);

  await prisma.$disconnect();
  console.log("\n✨ All synchronization tasks finished.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal Error:", e);
  process.exit(1);
});
