import { getRedis } from "../../src/config/redis";

jest.mock("../../src/config/redis", () => ({
  getRedis: jest.fn(),
}));

import { getForecastCache, invalidateForecastCache, setForecastCache } from "../../src/modules/price-forecasting/price-forecasting.cache";

const mockedGetRedis = getRedis as jest.Mock;

function makeFakeRedis(store: Map<string, string> = new Map()) {
  return {
    status: "ready",
    connect: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    incr: jest.fn(async (key: string) => {
      const current = Number(store.get(key) ?? "0");
      store.set(key, String(current + 1));
      return current + 1;
    }),
  };
}

describe("price-forecasting.cache — Redis available", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    mockedGetRedis.mockReturnValue(makeFakeRedis(store));
  });

  it("is a cache miss when nothing has been set", async () => {
    const result = await getForecastCache("latest", ["crop-1"]);
    expect(result).toBeNull();
  });

  it("is a cache hit after setForecastCache with the same key parts", async () => {
    await setForecastCache("latest", ["crop-1", { type: "CROP_WIDE" }], { forecastPublicId: "abc" });
    const result = await getForecastCache<{ forecastPublicId: string }>("latest", ["crop-1", { type: "CROP_WIDE" }]);
    expect(result).toEqual({ forecastPublicId: "abc" });
  });

  it("misses for a different key (different crop, scope, or kind)", async () => {
    await setForecastCache("latest", ["crop-1", { type: "CROP_WIDE" }], { forecastPublicId: "abc" });

    expect(await getForecastCache("latest", ["crop-2", { type: "CROP_WIDE" }])).toBeNull();
    expect(await getForecastCache("latest", ["crop-1", { type: "MANDI", mandiId: "m1" }])).toBeNull();
    expect(await getForecastCache("list", ["crop-1", { type: "CROP_WIDE" }])).toBeNull();
  });

  it("invalidation makes a previously-cached entry a miss again", async () => {
    await setForecastCache("latest", ["crop-1"], { forecastPublicId: "abc" });
    expect(await getForecastCache("latest", ["crop-1"])).not.toBeNull();

    await invalidateForecastCache();

    expect(await getForecastCache("latest", ["crop-1"])).toBeNull();
  });
});

describe("price-forecasting.cache — Redis unavailable", () => {
  beforeEach(() => {
    mockedGetRedis.mockReturnValue(null);
  });

  it("getForecastCache returns null without throwing", async () => {
    await expect(getForecastCache("latest", ["crop-1"])).resolves.toBeNull();
  });

  it("setForecastCache resolves without throwing", async () => {
    await expect(setForecastCache("latest", ["crop-1"], { any: "value" })).resolves.toBeUndefined();
  });

  it("invalidateForecastCache resolves without throwing", async () => {
    await expect(invalidateForecastCache()).resolves.toBeUndefined();
  });
});

describe("price-forecasting.cache — Redis errors", () => {
  it("degrades to a miss (never throws) when redis.get rejects", async () => {
    mockedGetRedis.mockReturnValue({
      status: "ready",
      connect: jest.fn(),
      get: jest.fn().mockRejectedValue(new Error("connection reset")),
      set: jest.fn(),
      incr: jest.fn(),
    });

    await expect(getForecastCache("latest", ["crop-1"])).resolves.toBeNull();
  });

  it("write failures never throw (caching must never break a forecast read)", async () => {
    mockedGetRedis.mockReturnValue({
      status: "ready",
      connect: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockRejectedValue(new Error("connection reset")),
      incr: jest.fn(),
    });

    await expect(setForecastCache("latest", ["crop-1"], { any: "value" })).resolves.toBeUndefined();
  });
});
