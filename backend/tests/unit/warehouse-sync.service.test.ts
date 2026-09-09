import { WarehouseSyncService } from "../../src/modules/warehouse-intelligence/warehouse-sync.service";
import { WarehouseProviderRegistry } from "../../src/modules/warehouse-intelligence/providers/warehouse-provider-registry";
import { WarehouseDuplicateDetectionService } from "../../src/modules/warehouse-intelligence/warehouse-duplicate-detection.service";
import { PrismaWarehouseSourceReferenceRepository } from "../../src/modules/warehouse-intelligence/warehouse-source-reference.repository";
import { ExternalWarehouseRecord, WarehouseDataProvider, WarehouseProviderResult } from "../../src/modules/warehouse-intelligence/providers/warehouse-data-provider";

/**
 * Minimal in-memory stand-in for PrismaClient covering exactly the tables
 * warehouse-sync.service.ts touches. $transaction runs the callback
 * against the same in-memory store synchronously-in-sequence (mirroring
 * how sequential, already-committed-before-the-next-record-starts
 * transactions behave in real Postgres — see persistOne()'s own comment on
 * why duplicate detection is safe to query outside the current
 * transaction).
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
        if (where.latitude !== undefined) {
          if (row.latitude === where.latitude && row.longitude === where.longitude) return row;
          continue;
        }
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
          continue;
        }
        if (where.pincode) {
          if (row.pincode === where.pincode) return row;
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

function externalRecord(overrides: Partial<ExternalWarehouseRecord> = {}): ExternalWarehouseRecord {
  return {
    externalId: "wdra-1",
    source: { providerId: "government-wdra", providerType: "GOVERNMENT" },
    name: "ABC Cold Storage",
    location: { address: "Plot 12", village: null, district: "Nashik", state: "Maharashtra", pincode: "422001", latitude: 20, longitude: 73.7 },
    contact: { phone: null, email: null },
    storage: { totalCapacity: "500", availableCapacity: "200", capacityUnit: "TONNE", storageType: "cold storage" },
    sourceUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function providerReturning(id: string, warehouses: ExternalWarehouseRecord[], status: WarehouseProviderResult["status"] = "SUCCESS"): WarehouseDataProvider {
  return {
    providerId: id,
    providerType: "GOVERNMENT",
    fetchWarehouses: async () => ({
      provider: { id, type: "GOVERNMENT" },
      status,
      warehouses,
      metadata: { fetchedAt: new Date(), recordCount: warehouses.length },
    }),
  };
}

function buildService(prisma: any, providers: WarehouseDataProvider[], audit = fakeAuditService()) {
  const registry = new WarehouseProviderRegistry(providers);
  const sourceReferenceRepository = new PrismaWarehouseSourceReferenceRepository(prisma);
  const duplicateDetection = new WarehouseDuplicateDetectionService(prisma);
  const service = new WarehouseSyncService(prisma, registry, sourceReferenceRepository, duplicateDetection, audit as any);
  return { service, audit };
}

describe("WarehouseSyncService", () => {
  it("creates a new warehouse + storage unit + source reference for an unmatched record", async () => {
    const { prisma, warehouses, sourceRefs, storageUnits } = makeFakePrisma();
    const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()])]);

    const summary = await service.run();

    expect(summary.totals).toMatchObject({ created: 1, updated: 0, linked: 0, duplicatesFlagged: 0, skipped: 0, failed: 0 });
    expect(warehouses.size).toBe(1);
    const warehouse = [...warehouses.values()][0];
    expect(warehouse.ownerType).toBe("GOVERNMENT");
    expect(warehouse.ownerUserId).toBeNull();
    expect(storageUnits.size).toBe(1);
    expect([...storageUnits.values()][0]).toMatchObject({ totalCapacity: 500_000, availableCapacity: 200_000, capacityUnit: "KG" });
    expect(sourceRefs.size).toBe(1);
    expect([...sourceRefs.values()][0]).toMatchObject({ providerId: "government-wdra", externalId: "wdra-1", warehouseId: warehouse.id });
  });

  it("is idempotent: running the same record twice updates instead of duplicating", async () => {
    const { prisma, warehouses, sourceRefs } = makeFakePrisma();
    const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()])]);

    await service.run();
    const summary2 = await service.run();

    expect(warehouses.size).toBe(1);
    expect(sourceRefs.size).toBe(1);
    expect(summary2.totals).toMatchObject({ created: 0, updated: 1, linked: 0 });
  });

  it("refreshes source-owned fields on update without nulling out fields the new fetch omitted", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()])]);
    await service.run();

    const { service: service2 } = buildService(prisma, [
      providerReturning("government-wdra", [
        externalRecord({ name: "ABC Cold Storage (renamed)", location: { ...externalRecord().location, address: null } }),
      ]),
    ]);
    await service2.run();

    const warehouse = [...warehouses.values()][0];
    expect(warehouse.name).toBe("ABC Cold Storage (renamed)");
    // address omitted on the second fetch — must keep its previous value,
    // never be nulled out (Part 15/16).
    expect(warehouse.address).toBe("Plot 12");
  });

  it("links (never overwrites) when a record deterministically matches an existing warehouse", async () => {
    const { prisma, warehouses, sourceRefs } = makeFakePrisma();
    // Pre-seed an existing FarmLink-owned warehouse at the exact same coordinates.
    warehouses.set("existing-farmlink-wh", {
      id: "existing-farmlink-wh",
      ownerType: "FPO",
      ownerFpoId: "fpo-1",
      ownerUserId: null,
      name: "Original FarmLink Name",
      warehouseType: "AMBIENT",
      state: "Maharashtra",
      district: "Nashik",
      address: "Original address",
      pincode: null,
      latitude: 20,
      longitude: 73.7,
    });

    const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()])]);
    const summary = await service.run();

    expect(summary.totals).toMatchObject({ created: 0, updated: 0, linked: 1 });
    expect(warehouses.size).toBe(1); // no new warehouse created
    const warehouse = warehouses.get("existing-farmlink-wh");
    // Untouched — this sync run does not own a FarmLink warehouse's fields.
    expect(warehouse.name).toBe("Original FarmLink Name");
    expect(warehouse.address).toBe("Original address");
    expect(sourceRefs.size).toBe(1);
    expect([...sourceRefs.values()][0].warehouseId).toBe("existing-farmlink-wh");
  });

  it("creates an independent warehouse but flags a POSSIBLE_DUPLICATE rather than merging", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    warehouses.set("other-wh", {
      id: "other-wh",
      ownerType: "FPO",
      ownerFpoId: "fpo-1",
      ownerUserId: null,
      name: "ABC Cold Storage",
      warehouseType: "AMBIENT",
      state: "Gujarat", // different state/district — name-only match
      district: "Surat",
      address: null,
      pincode: null,
      latitude: null,
      longitude: null,
    });

    const { service } = buildService(prisma, [
      providerReturning("government-wdra", [externalRecord({ location: { ...externalRecord().location, latitude: null, longitude: null } })]),
    ]);
    const summary = await service.run();

    expect(summary.totals).toMatchObject({ created: 1, duplicatesFlagged: 1, linked: 0 });
    expect(warehouses.size).toBe(2); // independent row created, not merged
  });

  it("skips (never persists) a record that fails validation, and keeps processing the rest", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    const { service } = buildService(prisma, [
      providerReturning("government-wdra", [
        externalRecord({ externalId: "bad-1", name: null }), // invalid: missing name
        externalRecord({ externalId: "good-1" }),
      ]),
    ]);

    const summary = await service.run();
    expect(summary.totals).toMatchObject({ skipped: 1, created: 1 });
    expect(warehouses.size).toBe(1);
  });

  it("isolates one provider's UNAVAILABLE/FAILED status from the others", async () => {
    const { prisma } = makeFakePrisma();
    const unavailableProvider: WarehouseDataProvider = {
      providerId: "partner-x",
      providerType: "PRIVATE_PARTNER",
      fetchWarehouses: async () => ({
        provider: { id: "partner-x", type: "PRIVATE_PARTNER" },
        status: "UNAVAILABLE",
        warehouses: [],
        errors: [{ code: "PARTNER_WAREHOUSE_SOURCE_NOT_CONFIGURED", message: "not configured" }],
      }),
    };
    const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()]), unavailableProvider]);

    const summary = await service.run();
    const govSummary = summary.providers.find((p) => p.providerId === "government-wdra");
    const partnerSummary = summary.providers.find((p) => p.providerId === "partner-x");
    expect(govSummary?.status).toBe("SUCCESS");
    expect(govSummary?.created).toBe(1);
    expect(partnerSummary?.status).toBe("UNAVAILABLE");
    expect(summary.totals.created).toBe(1);
  });

  it("never persists FarmLink-provider records through this path even if it returned any", async () => {
    const { prisma, warehouses } = makeFakePrisma();
    const farmlinkProvider: WarehouseDataProvider = {
      providerId: "farmlink",
      providerType: "FARMLINK",
      fetchWarehouses: async () => ({
        provider: { id: "farmlink", type: "FARMLINK" },
        status: "SUCCESS",
        warehouses: [externalRecord({ source: { providerId: "farmlink", providerType: "FARMLINK" } })],
      }),
    };
    const { service } = buildService(prisma, [farmlinkProvider]);
    const summary = await service.run();

    expect(warehouses.size).toBe(0);
    expect(summary.totals).toMatchObject({ created: 0, updated: 0, linked: 0 });
  });

  it("records audit events for sync initiation and completion", async () => {
    const { prisma } = makeFakePrisma();
    const { service, audit } = buildService(prisma, [providerReturning("government-wdra", [externalRecord()])]);
    await service.run();

    const actions = audit.record.mock.calls.map((call: any[]) => call[0].action);
    expect(actions).toEqual(["WAREHOUSE_PROVIDER_SYNC_INITIATED", "WAREHOUSE_PROVIDER_SYNC_COMPLETED"]);
  });

  describe("status/isActive (WDRA Active/Inactive/Suspended mapping)", () => {
    it("applies ACTIVE status + isActive:true on create when the source reports it", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Active" })])]);
      await service.run();

      expect([...warehouses.values()][0]).toMatchObject({ status: "ACTIVE", isActive: true });
    });

    it("applies INACTIVE status + isActive:false on create", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Inactive" })])]);
      await service.run();

      expect([...warehouses.values()][0]).toMatchObject({ status: "INACTIVE", isActive: false });
    });

    it("applies SUSPENDED status + isActive:false on create", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Suspended" })])]);
      await service.run();

      expect([...warehouses.values()][0]).toMatchObject({ status: "SUSPENDED", isActive: false });
    });

    it("falls back to the schema's ACTIVE/isActive:true default on create when no status is supplied", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: undefined })])]);
      await service.run();

      expect([...warehouses.values()][0]).toMatchObject({ status: "ACTIVE", isActive: true });
    });

    it("updates status/isActive on a re-import when the source status changed", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service: firstRun } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Active" })])]);
      await firstRun.run();
      expect([...warehouses.values()][0]).toMatchObject({ status: "ACTIVE", isActive: true });

      const { service: secondRun } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Suspended" })])]);
      await secondRun.run();

      expect(warehouses.size).toBe(1);
      expect([...warehouses.values()][0]).toMatchObject({ status: "SUSPENDED", isActive: false });
    });

    it("leaves the existing status/isActive untouched on update when the re-fetch reports no status", async () => {
      const { prisma, warehouses } = makeFakePrisma();
      const { service: firstRun } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: "Suspended" })])]);
      await firstRun.run();

      const { service: secondRun } = buildService(prisma, [providerReturning("government-wdra", [externalRecord({ status: undefined, name: "ABC Cold Storage Renamed" })])]);
      await secondRun.run();

      expect([...warehouses.values()][0]).toMatchObject({ status: "SUSPENDED", isActive: false, name: "ABC Cold Storage Renamed" });
    });
  });

  it("counts a PARTIAL (warned-but-persisted) record in the provider summary's warnings total", async () => {
    const { prisma } = makeFakePrisma();
    const { service } = buildService(prisma, [
      providerReturning("government-wdra", [externalRecord({ storage: { totalCapacity: "not-a-number", availableCapacity: null, capacityUnit: "TONNE", storageType: "cold storage" } })]),
    ]);
    const summary = await service.run();

    const providerSummary = summary.providers.find((p) => p.providerId === "government-wdra");
    expect(providerSummary?.warnings).toBe(1);
    expect(providerSummary?.created).toBe(1);
    expect(providerSummary?.skipped).toBe(0);
  });
});
