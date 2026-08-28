import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

let redis: Redis | null = null;

/**
 * Redis is "where useful" per the spec — rate limiting benefits from a
 * shared store across processes, but the app must not hard-fail if Redis
 * is unavailable (e.g. during local development). getRedis() returns null
 * when it can't connect; callers fall back to in-memory behavior.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;

  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null, // don't hang the process retrying forever
    });
    redis.on("error", (err) => {
      logger.warn({ err: err.message }, "Redis connection error — falling back to in-memory limits");
    });
  }

  return redis;
}
