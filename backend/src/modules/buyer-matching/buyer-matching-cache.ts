import { createHash } from "node:crypto";
import { getRedis } from "../../config/redis";

const versionKey = "buyer-matching:version";
const keyFor = (lotPublicId: string, version: string) => `buyer-matching:${version}:${createHash("sha256").update(lotPublicId).digest("hex")}`;

export async function getLotMatchesCache<T>(lotPublicId: string): Promise<T | null> {
  const redis = getRedis(); if (!redis) return null;
  try { if (redis.status === "wait") await redis.connect(); const version = await redis.get(versionKey) ?? "0"; const value = await redis.get(keyFor(lotPublicId, version)); return value ? JSON.parse(value) as T : null; } catch { return null; }
}
export async function setLotMatchesCache(lotPublicId: string, value: unknown): Promise<void> {
  const redis = getRedis(); if (!redis) return;
  try { if (redis.status === "wait") await redis.connect(); const version = await redis.get(versionKey) ?? "0"; await redis.set(keyFor(lotPublicId, version), JSON.stringify(value), "EX", 180); } catch { /* optional cache */ }
}
export async function invalidateBuyerMatchingCache(): Promise<void> {
  const redis = getRedis(); if (!redis) return;
  try { if (redis.status === "wait") await redis.connect(); await redis.incr(versionKey); } catch { /* optional cache */ }
}
