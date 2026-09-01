import { createHash } from "node:crypto";
import { getRedis } from "../../config/redis";

const VERSION_KEY = "market-intelligence:version";
const ttlSeconds = 300;

function digest(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Redis is optional in FarmLink. Cache entries are versioned rather than
 * deleted one-by-one so an import/sync can invalidate the whole bounded
 * read model safely, without ever putting a coordinate into the key.
 */
export async function getMarketCache<T>(kind: string, parts: unknown[]): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = await redis.get(VERSION_KEY) ?? "0";
    const raw = await redis.get(`market-intelligence:${version}:${kind}:${digest(parts)}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

export async function setMarketCache(kind: string, parts: unknown[], value: unknown): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status === "wait") await redis.connect();
    const version = await redis.get(VERSION_KEY) ?? "0";
    await redis.set(`market-intelligence:${version}:${kind}:${digest(parts)}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch { /* caching must never break market reads */ }
}

export async function invalidateMarketCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try { if (redis.status === "wait") await redis.connect(); await redis.incr(VERSION_KEY); } catch { /* optional infrastructure */ }
}
