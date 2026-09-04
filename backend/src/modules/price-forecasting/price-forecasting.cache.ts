import { createHash } from "node:crypto";
import { getRedis } from "../../config/redis";

// Module 7 Part 6 — Redis caching for read-only forecast lookups.
//
// Deliberately mirrors market-intelligence/market-cache.ts's own shape
// (version-keyed invalidation, digest-based keys, Redis-optional) rather
// than a new caching design — build spec: "reuse existing Redis
// infrastructure. Do not create another Redis client architecture."
//
// Only ever caches *reads* (findLatestForecast/listForecasts) — never
// generation itself, so idempotency stays entirely the database's own
// (PriceForecastRepository's upsert-on-conflict), unaffected by whether a
// cache entry exists, is stale, or Redis is down.

const VERSION_KEY = "price-forecasting:version";
const ttlSeconds = 120; // short TTL: a fresh generation should show up promptly even if invalidation is ever missed

function digest(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Redis is optional in FarmLink — every function here degrades to "no
 *  cache" (a plain miss on read, a silent no-op on write) rather than
 *  ever failing the request it's supporting. */
export async function getForecastCache<T>(kind: string, parts: unknown[]): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = (await redis.get(VERSION_KEY)) ?? "0";
    const raw = await redis.get(`price-forecasting:${version}:${kind}:${digest(parts)}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setForecastCache(kind: string, parts: unknown[], value: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = (await redis.get(VERSION_KEY)) ?? "0";
    await redis.set(`price-forecasting:${version}:${kind}:${digest(parts)}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    /* caching must never break a forecast read */
  }
}

/** Called after a successful forecast generation (COMPLETED or
 *  INSUFFICIENT_DATA — both change what "latest"/"list" should return for
 *  that crop) so cached reads don't serve a stale answer. A single global
 *  version bump, same trade-off market-cache.ts makes for the same
 *  reason: simple and correct, at the cost of also invalidating other
 *  crops' cached reads — acceptable given the short TTL above. */
export async function invalidateForecastCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.incr(VERSION_KEY);
  } catch {
    /* optional infrastructure */
  }
}
