import { createHash } from "node:crypto";
import { getRedis } from "../../config/redis";
import { WAREHOUSE_INTELLIGENCE_CONFIG } from "./warehouse-intelligence.config";

const VERSION_KEY = "warehouse-intelligence:version";

function digest(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Redis is optional in FarmLink (same convention as market-cache.ts) — a
 * missing/unreachable Redis must never break a warehouse read. Entries are
 * versioned rather than deleted one-by-one so a capacity change can
 * invalidate the whole bounded read model atomically via invalidate()
 * below, without ever having to enumerate which cached search results
 * might have included the affected warehouse.
 */
export async function getWarehouseCache<T>(kind: string, parts: unknown[]): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = (await redis.get(VERSION_KEY)) ?? "0";
    const raw = await redis.get(`warehouse-intelligence:${version}:${kind}:${digest(parts)}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setWarehouseCache(kind: string, parts: unknown[], value: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = (await redis.get(VERSION_KEY)) ?? "0";
    await redis.set(
      `warehouse-intelligence:${version}:${kind}:${digest(parts)}`,
      JSON.stringify(value),
      "EX",
      WAREHOUSE_INTELLIGENCE_CONFIG.CACHE_TTL_SECONDS,
    );
  } catch {
    /* caching must never break a warehouse read */
  }
}

/** Bumped whenever any warehouse's capacity, operational status, or crop
 * compatibility configuration changes — see
 * WarehouseAvailabilityService.updateStorageUnitCapacity(). */
export async function invalidateWarehouseCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    await redis.incr(VERSION_KEY);
  } catch {
    /* optional infrastructure */
  }
}

/** Rounds a coordinate to a fixed precision for use in a cache key only —
 * never for the actual Haversine distance calculation. Keeps a farmer's
 * precise location out of Redis key material (build spec: "cache keys
 * must not expose unnecessarily precise user location information"). */
export function roundCoordinateForCacheKey(value: number): number {
  const factor = 10 ** WAREHOUSE_INTELLIGENCE_CONFIG.CACHE_COORDINATE_PRECISION_DECIMALS;
  return Math.round(value * factor) / factor;
}
