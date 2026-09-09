import { WarehouseSyncService } from "../../src/modules/warehouse-intelligence/warehouse-sync.service";
import { WarehouseProviderRegistry } from "../../src/modules/warehouse-intelligence/providers/warehouse-provider-registry";
import { WarehouseDuplicateDetectionService } from "../../src/modules/warehouse-intelligence/warehouse-duplicate-detection.service";
import { PrismaWarehouseSourceReferenceRepository } from "../../src/modules/warehouse-intelligence/warehouse-source-reference.repository";
import { WarehouseDataProvider, WarehouseProviderResult } from "../../src/modules/warehouse-intelligence/providers/warehouse-data-provider";
import { mapWdraCsvRowToExternalRecord, WDRA_PROVIDER_ID } from "../../src/modules/warehouse-intelligence/wdra-record-mapper";

/**
 * Same minimal in-memory PrismaClient stand-in as
 * warehouse-sync.service.test.ts's own makeFakePrisma — kept as a local
 * copy here rather than imported from that test file, since Jest test
 * files aren't meant to be modules other test files depend on.
 */
function makeFakePrisma() {
  let idSeq = 0;
  const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

  const warehouses = new Map<string, any>();
  const sourceRefs = new Map<string, any>();
  const sourceRefsByKey = new Map<string, string>();
  const storageUnits = new Map<string, any>();

  const warehouseTable = {
    findUnique: async ({ where }: any) => warehouses.get(where.id) ?? null,
    create: async ({ data }: any) => {
      const id = nextId("wh");
      const row = { id, address: null, pincode: null, latitude: null, longitude: null, ...data };
      warehouses.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = warehouses.get(where.id);
      Object.assign(row, data);
      return row;
    },
    findFirst: async ({ where }: any) => {
      for (const row of warehouses.values()) {
        if (where.name && where.state && where.district) {
          if (
            row.name?.toLowerCase() === where.name.equals.toLowerCase() &&
            row.state?.toLowerCase() === where.state.equals.toLowerCase() &&
            row.district?.toLowerCase() === where.district.equals.toLowerCase()
          ) {
            return row;
          }
          continue;
        }
        if (where.name) {
          if (row.name?.toLowerCase() === where.name.equals.toLowerCase()) return row;
        }
      }
      return null;
    },
  };

  const sourceReferenceTable = {
    findUnique: async ({ where }: any) => {
      const key = `${where.providerId_externalId.providerId}::${where.providerId_externalId.externalId}`;
      const id = sourceRefsByKey.get(key);
      return id ? sourceRefs.get(id) : null;
    },
    create: async ({ data }: any) => {
      const id = nextId("ref");
      const row = { id, ...data };
      sourceRefs.set(id, row);
      sourceRefsByKey.set(`${data.providerId}::${data.externalId}`, id);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = sourceRefs.get(where.id);
      Object.assign(row, data);
      return row;
    },
  };

  const storageUnitTable = {
    findUnique: async ({ where }: any) => {
      const key = where.warehouseId_code;
      for (const row of storageUnits.values()) {
        if (row.warehouseId === key.warehouseId && row.code === key.code) return row;
      }
      return null;
    },
    create: async ({ data }: any) => {
      const id = nextId("su");
      const row = { id, ...data };
      storageUnits.set(id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = storageUnits.get(where.id);
      Object.assign(row, data);
      return row;
    },
  };

  const tx = { warehouse: warehouseTable, warehouseSourceReference: sourceReferenceTable, warehouseStorageUnit: storageUnitTable };
  const prisma: any = {
    warehouse: warehouseTable,
    warehouseSourceReference: sourceReferenceTable,
    warehouseStorageUnit: storageUnitTable,
    $transaction: async (fn: any) => fn(tx),
  };
  return { prisma, warehouses, sourceRefs, storageUnits };
}

function fakeAuditService() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function providerFromCsvRows(rows: Record<string, string | undefined>[]): WarehouseDataProvider {
  const records = rows.map(mapWdraCsvRowToExternalRecord);
  return {
    providerId: WDRA_PROVIDER_ID,
    providerType: "GOVERNMENT",
    fetchWarehouses: async (): Promise<WarehouseProviderResult> => ({
      provider: { id: WDRA_PROVIDER_ID, type: "GOVERNMENT" },
      status: "SUCCESS",
      warehouses: records,
      metadata: { fetchedAt: new Date(), recordCount: records.length },
    }),
  };
}

function runSync(prisma: any, rows: Record<string, string | undefined>[]) {
  const registry = new WarehouseProviderRegistry([providerFromCsvRows(rows)]);
  const sourceReferenceRepository = new PrismaWarehouseSourceReferenceRepository(prisma);
  const duplicateDetection = new WarehouseDuplicateDetectionService(prisma);
  const service = new WarehouseSyncService(prisma, registry, sourceReferenceRepository, duplicateDetection, fakeAuditService() as any);
  return service.run();
}

const activeRow = {
  "WHM Name": "ABC Warehousing Corp",
  "WH Name": "ABC Cold Storage",
  "WH ID": "WDRA-100",
  Address: "Plot 12, MIDC",
  District: "Nashik",
  State: "Maharashtra",
  "Capacity(in MT)": "500",
  "Registration Date": "2020-04-01",
  "Registration Valid Upto": "2027-03-31",
  "Contact No.": "9999999999",
  Status: "Active",
  Remarks: "",
};

describe("WDRA CSV import through the shared warehouse sync pipeline", () => {
  it("creates a warehouse + source reference from a mapped CSV row, with capacity converted MT -> KG", async () => {
    const { prisma, warehouses, sourceRefs } = makeFakePrisma();
    await runSync(prisma, [activeRow]);

    expect(warehouses.size).toBe(1);
    const warehouse = [...warehouses.values()][0];
    expect(warehouse).toMatchObject({ name: "ABC Cold Storage", status: "ACTIVE", isActive: true });
    expect(sourceRefs.size).toBe(1);
    expect([...sourceRefs.values()][0]).toMatchObject({
      providerId: "wdra",
      externalId: "WDRA-100",
      warehouseId: warehouse.id,
      metadata: { whmName: "ABC Warehousing Corp", contactNo: "9999999999" },
    });
  });

  it("is idempotent across two separate CSV import runs of the same WH ID (re-running the importer)", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    await runSync(prisma, [activeRow]);
    await runSync(prisma, [activeRow]);

    expect(warehouses.size).toBe(1);
  });

  it("updates the warehouse's status/isActive when a later CSV export shows the WH ID went inactive", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    await runSync(prisma, [activeRow]);
    await runSync(prisma, [{ ...activeRow, Status: "Inactive" }]);

    expect(warehouses.size).toBe(1);
    expect([...warehouses.values()][0]).toMatchObject({ status: "INACTIVE", isActive: false });
  });

  it("collapses a duplicate WH ID within one CSV file into a single warehouse (second row updates, not creates)", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    const summary = await runSync(prisma, [activeRow, { ...activeRow, Remarks: "Duplicate row in the export" }]);

    expect(warehouses.size).toBe(1);
    const providerSummary = summary.providers.find((p) => p.providerId === "wdra");
    expect(providerSummary).toMatchObject({ created: 1, updated: 1 });
  });

  it("skips a row with a missing WH ID as invalid without stopping the rest of the import", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    const summary = await runSync(prisma, [activeRow, { ...activeRow, "WH ID": "", "WH Name": "No ID Warehouse" }]);

    expect(warehouses.size).toBe(1);
    const providerSummary = summary.providers.find((p) => p.providerId === "wdra");
    expect(providerSummary).toMatchObject({ created: 1, skipped: 1 });
  });
});
