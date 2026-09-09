const mockEnv: { REDIS_URL?: string } = {};

// This project's convention: unit-test a config module by mocking
// config/env entirely rather than parsing real process.env (see
// fci-iisfm-warehouse-provider.test.ts). isProduction/isTest are included
// because config/logger.ts — imported transitively by config/redis.ts —
// reads them too.
jest.mock("../../src/config/env", () => ({
  env: mockEnv,
  isProduction: false,
  isTest: true,
}));

import { getRedis } from "../../src/config/redis";

describe("getRedis", () => {
  afterEach(() => {
    delete mockEnv.REDIS_URL;
  });

  it("returns null when REDIS_URL is not configured", () => {
    expect(getRedis()).toBeNull();
  });

  it("returns the same client across calls while the connection is alive", () => {
    mockEnv.REDIS_URL = "redis://127.0.0.1:6399";
    const first = getRedis();
    const second = getRedis();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  /**
   * config/redis.ts sets retryStrategy: () => null so a single failed
   * command never hangs waiting to retry forever. ioredis's own behavior
   * for that is to stop reconnecting permanently and leave the client in
   * "end" status. Without the fix in getRedis(), that dead client would be
   * the module-level singleton for the rest of the process's life — every
   * cache and every cron lock would silently stop working until a restart,
   * even after Redis itself recovered. getRedis() must recreate the client
   * once it detects "end", not hand back the same dead one.
   */
  it("recreates the client once it has permanently ended, instead of staying dead for the rest of the process", () => {
    mockEnv.REDIS_URL = "redis://127.0.0.1:6399";
    const first = getRedis();
    first!.disconnect(); // simulates retryStrategy giving up after a lost connection
    expect(first!.status).toBe("end");

    const second = getRedis();
    expect(second).not.toBe(first);
    expect(second!.status).not.toBe("end");

    // And the new client is itself now the stable singleton going forward.
    const third = getRedis();
    expect(third).toBe(second);
  });
});
