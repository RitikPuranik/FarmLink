import { decideWarehouseSyncCronScheduling, withRedisLock, RedisLockClient } from "../../src/jobs/warehouse-sync-cron.guard";

/** In-memory stand-in for the one ioredis surface withRedisLock touches —
 * enough to exercise real NX-acquire/TTL/release semantics without a real
 * Redis server. */
function makeFakeRedis(): RedisLockClient {
  const store = new Map<string, string>();
  return {
    async set(key, value, _mode, _ttlMs, _flag) {
      if (store.has(key)) return null; // NX: refuse if already set
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

describe("decideWarehouseSyncCronScheduling", () => {
  it("schedules when production AND the government provider is enabled", () => {
    const decision = decideWarehouseSyncCronScheduling({ isProduction: true, governmentProviderEnabled: true });
    expect(decision).toEqual({ schedule: true });
  });

  it("does not schedule in development, even with the provider enabled", () => {
    const decision = decideWarehouseSyncCronScheduling({ isProduction: false, governmentProviderEnabled: true });
    expect(decision).toEqual({ schedule: false, reason: "NOT_PRODUCTION" });
  });

  it("does not schedule in production when the government provider is disabled", () => {
    const decision = decideWarehouseSyncCronScheduling({ isProduction: true, governmentProviderEnabled: false });
    expect(decision).toEqual({ schedule: false, reason: "PROVIDER_DISABLED" });
  });

  it("does not schedule outside production with the provider disabled either", () => {
    const decision = decideWarehouseSyncCronScheduling({ isProduction: false, governmentProviderEnabled: false });
    expect(decision).toEqual({ schedule: false, reason: "NOT_PRODUCTION" });
  });
});

describe("withRedisLock", () => {
  it("runs the function when the lock is free, then releases it", async () => {
    const redis = makeFakeRedis();
    const fn = jest.fn().mockResolvedValue("done");

    const outcome = await withRedisLock(redis, "warehouse-data:sync-lock", 30 * 60_000, fn);

    expect(outcome).toEqual({ ran: true, result: "done" });
    expect(fn).toHaveBeenCalledTimes(1);
    // Released afterward — a later call can acquire it again.
    expect(await redis.get("warehouse-data:sync-lock")).toBeNull();
  });

  it("does NOT run the function when another instance already holds the lock (Test 12: concurrent sync)", async () => {
    const redis = makeFakeRedis();
    // Simulate "Server Instance A" already holding the lock.
    await redis.set("warehouse-data:sync-lock", "instance-a-token", "PX", 30 * 60_000, "NX");

    const fn = jest.fn().mockResolvedValue("done");
    const outcome = await withRedisLock(redis, "warehouse-data:sync-lock", 30 * 60_000, fn);

    expect(outcome).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases the lock even when the wrapped function throws", async () => {
    const redis = makeFakeRedis();
    const fn = jest.fn().mockRejectedValue(new Error("sync failed"));

    await expect(withRedisLock(redis, "warehouse-data:sync-lock", 30 * 60_000, fn)).rejects.toThrow("sync failed");
    expect(await redis.get("warehouse-data:sync-lock")).toBeNull();
  });

  it("runs the function directly (no lock) when Redis is unavailable", async () => {
    const fn = jest.fn().mockResolvedValue("done");
    const outcome = await withRedisLock(null, "warehouse-data:sync-lock", 30 * 60_000, fn);

    expect(outcome).toEqual({ ran: true, result: "done" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never releases a lock it did not itself acquire (a slow run outliving its own TTL)", async () => {
    const redis = makeFakeRedis();
    // The lock expired and a different instance's token is now in place —
    // withRedisLock must not delete that instance's lock out from under it.
    let sawOtherInstancesTokenDuringRun = false;
    const fn = jest.fn().mockImplementation(async () => {
      await redis.del("warehouse-data:sync-lock");
      await redis.set("warehouse-data:sync-lock", "instance-b-token", "PX", 30 * 60_000, "NX");
      sawOtherInstancesTokenDuringRun = (await redis.get("warehouse-data:sync-lock")) === "instance-b-token";
    });

    await withRedisLock(redis, "warehouse-data:sync-lock", 30 * 60_000, fn);

    expect(sawOtherInstancesTokenDuringRun).toBe(true);
    // Instance B's token must survive — withRedisLock only deletes its own token.
    expect(await redis.get("warehouse-data:sync-lock")).toBe("instance-b-token");
  });
});
