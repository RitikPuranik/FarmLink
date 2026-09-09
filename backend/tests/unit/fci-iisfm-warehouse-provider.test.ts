import fixture from "../fixtures/fci-iisfm-depots-with-cap.fixture.json";

jest.mock("../../src/config/env", () => ({
  env: {
    NODE_ENV: "test",
    WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED: false,
    WAREHOUSE_GOVERNMENT_PROVIDER_TIMEOUT_MS: 5000,
    WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES: 2,
    FCI_IISFM_API_BASE_URL: "https://api.iisfm.nic.in",
    FCI_IISFM_DEPOTS_ENDPOINT: "/DepotsWithCap",
  },
  isProduction: false,
  isTest: true,
}));

import { env } from "../../src/config/env";
import { FciIisfmWarehouseProvider } from "../../src/modules/warehouse-intelligence/providers/fci-iisfm-warehouse-provider";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const text = JSON.stringify(body);
  return {
    ok: (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (key: string) => (init.headers ?? {})[key.toLowerCase()] ?? null },
    text: async () => text,
  } as unknown as Response;
}

describe("FciIisfmWarehouseProvider", () => {
  beforeEach(() => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = false;
    (global as any).fetch = jest.fn();
  });

  it("returns UNAVAILABLE (never attempts a request) when the provider is disabled", async () => {
    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("UNAVAILABLE");
    expect(result.warehouses).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("parses a successful response into normalized warehouses, dropping only rows missing a Depot Code", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(fixture));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("PARTIAL");
    expect(result.warehouses).toHaveLength(2);
    expect(result.warehouses.map((w) => w.externalId)).toEqual(["FCI-DL-001", "FCI-PB-014"]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("https://api.iisfm.nic.in/DepotsWithCap");
  });

  it("returns FAILED for a response with no recognizable depot array, without fabricating records", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ unexpected: "shape" }));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("FAILED");
    expect(result.warehouses).toHaveLength(0);
    expect(result.errors?.[0]?.code).toBe("FCI_IISFM_MALFORMED_RESPONSE");
  });

  it("returns FAILED for malformed (non-JSON) response bodies", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<html>not json</html>",
    });

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("FAILED");
    expect(result.errors?.[0]?.code).toBe("FCI_IISFM_FETCH_FAILED");
  });

  it("fails fast on a non-retryable 404 without exhausting all retries", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse({ error: "not found" }, { status: 404 }));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("FAILED");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 503 up to the configured bound, then succeeds if a later attempt works", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(fixture));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("PARTIAL");
  });

  it("gives up after WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES transient failures (bounded, not infinite)", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ error: "unavailable" }, { status: 503 }));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    // WAREHOUSE_GOVERNMENT_PROVIDER_MAX_RETRIES=2 in this suite's mocked
    // env -> 1 initial attempt + 2 retries = 3 total calls, then FAILED.
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("FAILED");
  });

  it("treats a timeout (AbortError) as a retryable failure and still eventually reports FAILED", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("FAILED");
    expect(result.errors?.[0]?.code).toBe("FCI_IISFM_FETCH_FAILED");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("refuses to parse a response declaring a content-length over the size cap", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(fixture, { headers: { "content-length": String(30 * 1024 * 1024) } }),
    );

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(result.status).toBe("FAILED");
    expect(result.errors?.[0]?.message).toMatch(/exceed/i);
  });

  it("never logs or exposes a payload/credential in its error output", async () => {
    (env as any).WAREHOUSE_GOVERNMENT_PROVIDER_ENABLED = true;
    (global.fetch as jest.Mock).mockRejectedValue(new Error("network down"));

    const provider = new FciIisfmWarehouseProvider();
    const result = await provider.fetchWarehouses({ requestedAt: new Date() } as any);

    expect(JSON.stringify(result)).not.toMatch(/api[_-]?key/i);
  });
});
