import { FarmLinkWarehouseProvider } from "../../src/modules/warehouse-intelligence/providers/farmlink-warehouse-provider";
import { UnavailableGovernmentWarehouseProvider } from "../../src/modules/warehouse-intelligence/providers/government-warehouse-provider";
import { UnavailablePartnerWarehouseProvider } from "../../src/modules/warehouse-intelligence/providers/partner-warehouse-provider";
import { WarehouseProviderRegistry } from "../../src/modules/warehouse-intelligence/providers/warehouse-provider-registry";
import { WarehouseDataProvider, WarehouseProviderResult } from "../../src/modules/warehouse-intelligence/providers/warehouse-data-provider";

describe("FarmLinkWarehouseProvider", () => {
  it("always succeeds with zero records — FarmLink is already canonical", async () => {
    const result = await new FarmLinkWarehouseProvider().fetchWarehouses({});
    expect(result.status).toBe("SUCCESS");
    expect(result.warehouses).toEqual([]);
  });
});

describe("UnavailableGovernmentWarehouseProvider / UnavailablePartnerWarehouseProvider", () => {
  it("report UNAVAILABLE with a NOT_CONFIGURED error, never fabricated data", async () => {
    const gov = await new UnavailableGovernmentWarehouseProvider().fetchWarehouses({});
    expect(gov.status).toBe("UNAVAILABLE");
    expect(gov.warehouses).toEqual([]);
    expect(gov.errors?.[0].code).toBe("GOVERNMENT_WAREHOUSE_SOURCE_NOT_CONFIGURED");

    const partner = await new UnavailablePartnerWarehouseProvider().fetchWarehouses({});
    expect(partner.status).toBe("UNAVAILABLE");
    expect(partner.warehouses).toEqual([]);
    expect(partner.errors?.[0].code).toBe("PARTNER_WAREHOUSE_SOURCE_NOT_CONFIGURED");
  });
});

function fakeProvider(id: string, result: WarehouseProviderResult | (() => Promise<WarehouseProviderResult>)): WarehouseDataProvider {
  return {
    providerId: id,
    providerType: "GOVERNMENT",
    fetchWarehouses: async () => (typeof result === "function" ? result() : result),
  };
}

describe("WarehouseProviderRegistry", () => {
  it("isolates one provider's failure — others still return their own results", async () => {
    const okResult: WarehouseProviderResult = {
      provider: { id: "ok", type: "GOVERNMENT" },
      status: "SUCCESS",
      warehouses: [],
      metadata: { fetchedAt: new Date(), recordCount: 0 },
    };
    const registry = new WarehouseProviderRegistry([
      fakeProvider("ok", okResult),
      fakeProvider("boom", () => {
        throw new Error("network exploded");
      }),
    ]);

    const results = await registry.fetchAll({});
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.provider.id === "ok")?.status).toBe("SUCCESS");
    const failed = results.find((r) => r.provider.id === "boom");
    expect(failed?.status).toBe("FAILED");
    expect(failed?.errors?.[0].code).toBe("PROVIDER_FETCH_FAILED");
  });

  it("never throws out of fetchAll even if every provider fails", async () => {
    const registry = new WarehouseProviderRegistry([
      fakeProvider("a", () => {
        throw new Error("a failed");
      }),
      fakeProvider("b", () => {
        throw new Error("b failed");
      }),
    ]);
    const results = await registry.fetchAll({});
    expect(results.every((r) => r.status === "FAILED")).toBe(true);
  });
});
