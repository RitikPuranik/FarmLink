import { getRedis } from "../../config/redis";
import { logger } from "../../config/logger";
import { getCostCacheTtlSeconds, getRouteCacheTtlSeconds } from "./logistics.config";

/**
 * Step 14 — Redis caching, "where useful" and never load-bearing (same
 * convention as config/redis.ts's own getRedis(): every call here degrades
 * to a cache miss, never an error, when Redis is unavailable). Only route
 * and cost *estimates* are cached — quote acceptance and every
 * eligibility/availability check always hit the database directly (Step
 * 14: "Do not allow stale cache data to bypass availability/eligibility
 * checks").
 */

function roundCoord(value: number): number {
  // ~11m precision at the equator — enough to dedupe repeated estimate
  // calls for effectively the same two points without smearing genuinely
  // different pickup/destination pairs together.
  return Math.round(value * 10000) / 10000;
}

export function routeCacheKey(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }): string {
  return [
    "logistics:route",
    roundCoord(origin.latitude),
    roundCoord(origin.longitude),
    roundCoord(destination.latitude),
    roundCoord(destination.longitude),
  ].join(":");
}

export function costCacheKey(routeKey: string, vehicleTypeOrClass: string, configVersion: string): string {
  return `logistics:cost:${routeKey}:${vehicleTypeOrClass}:${configVersion}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, key }, "Logistics cache read failed — falling back to a live calculation");
    return null;
  }
}

export async function setCachedRoute<T>(key: string, value: T): Promise<void> {
  await setCached(key, value, getRouteCacheTtlSeconds());
}

export async function setCachedCost<T>(key: string, value: T): Promise<void> {
  await setCached(key, value, getCostCacheTtlSeconds());
}

async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis || ttlSeconds <= 0) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, "Logistics cache write failed — continuing without caching this result");
  }
}
