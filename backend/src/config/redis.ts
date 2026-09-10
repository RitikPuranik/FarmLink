import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let redis: Redis | null = null;

function createClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null, // don't hang a command retrying forever
    // ioredis's own default here is 10_000ms. Four different cache modules
    // (market-intelligence, buyer-matching, price-forecasting, warehouse-
    // intelligence) block their request on `await redis.connect()` before
    // falling back to "no cache" — so with the 10s default, every single
    // click into Market / Forecasts / Warehouses (or any buyer-matching
    // call) would hang for a full 10 seconds whenever Redis is merely
    // *unreachable* (wrong host, paused cloud instance, firewalled network)
    // rather than actively refusing the connection outright. A short
    // timeout here means those code paths fail fast and fall back to an
    // uncached (but instant) response instead, exactly as the "Redis is
    // optional" comment below intends.
    connectTimeout: 300,
  });
  client.on("error", (err) => {
    logger.warn({ err: err.message }, "Redis connection error — falling back to in-memory limits");
  });
  return client;
}

/**
 * Redis is "where useful" per the spec — rate limiting benefits from a
 * shared store across processes, but the app must not hard-fail if Redis
 * is unavailable (e.g. during local development). getRedis() returns null
 * when it can't connect; callers fall back to in-memory behavior.
 *
 * retryStrategy above intentionally stops ioredis from auto-reconnecting
 * after a connection is lost — a single failed command should never hang
 * waiting to retry forever. The trade-off is that ioredis then leaves the
 * client permanently in "end" status; without the check below it would
 * stay dead for the rest of the process's life even after Redis recovers.
 * Recreating the client whenever the cached one has ended gives the next
 * caller a fresh lazy-connect attempt on its very next command — self-
 * healing on demand, with no background polling or retry loop.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;

  if (!redis || redis.status === "end") {
    redis = createClient(env.REDIS_URL);
  }

  return redis;
}
