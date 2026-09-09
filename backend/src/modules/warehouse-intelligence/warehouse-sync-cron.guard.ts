// ---------------------------------------------------------------------------
// Warehouse Ecosystem Ingestion Layer — automatic cron scheduling guard.
//
// Deliberately a tiny, pure, dependency-free predicate rather than logic
// inlined into server.ts: server.ts is this codebase's composition root
// (real DB connect, real Redis, real app.listen) and isn't otherwise unit
// tested anywhere, including the existing market-data cron it already
// schedules the same way. Extracting just the yes/no decision (not the
// cron job itself, not the sync logic, not the Redis lock) is the smallest
// change that makes the four required environment/provider combinations
// (Parts 16/17/27 of the ingestion spec) independently verifiable without
// pulling the whole server bootstrap into a test.
// ---------------------------------------------------------------------------

export const WAREHOUSE_SYNC_CRON_EXPRESSION = "30 2 * * *";
export const WAREHOUSE_SYNC_CRON_TIMEZONE = "Asia/Kolkata";
export const WAREHOUSE_SYNC_LOCK_KEY = "warehouse-data:sync-lock";

export type WarehouseSyncCronDecision =
  | { schedule: true }
  | { schedule: false; reason: "NOT_PRODUCTION" | "PROVIDER_DISABLED" };

/**
 * The automatic warehouse sync cron is scheduled if and only if the
 * process is running in production AND the government provider is
 * explicitly enabled — both conditions are required (Part 17: neither
 * alone is sufficient). Evaluated once at startup, before `cron.schedule`
 * is ever called, so a non-production/disabled process never registers a
 * scheduled task at all (Part 16) — it isn't merely a no-op inside the
 * callback.
 */
export function decideWarehouseSyncCronScheduling(params: {
  isProduction: boolean;
  governmentProviderEnabled: boolean;
}): WarehouseSyncCronDecision {
  if (!params.isProduction) return { schedule: false, reason: "NOT_PRODUCTION" };
  if (!params.governmentProviderEnabled) return { schedule: false, reason: "PROVIDER_DISABLED" };
  return { schedule: true };
}

/** Minimal shape server.ts's real ioredis client and any test double both
 * satisfy — deliberately not importing the ioredis type here so this stays
 * dependency-free and trivially fakeable in tests. */
export interface RedisLockClient {
  set(key: string, value: string, mode: "PX", ttlMs: number, flag: "NX"): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

/**
 * Runs `fn` only if the distributed lock at `key` can be acquired,
 * releasing it afterward — and never releasing a lock this call didn't
 * itself acquire (a slow run that outlives its own TTL must not delete a
 * newer instance's lock out from under it). A `null`/absent Redis client
 * (e.g. local development without Redis configured) always runs `fn`
 * directly: multi-instance concurrency protection is a production
 * concern, not a hard local dependency (Part 19 of the ingestion spec).
 *
 * Returns `{ ran: false }` when another instance already holds the lock —
 * this is the mechanism Test 12 (concurrent sync) exercises.
 */
export async function withRedisLock<T>(
  redis: RedisLockClient | null,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ ran: true; result: T } | { ran: false }> {
  if (!redis) return { ran: true, result: await fn() };

  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
  if (acquired !== "OK") return { ran: false };

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    if ((await redis.get(key)) === token) await redis.del(key);
  }
}
