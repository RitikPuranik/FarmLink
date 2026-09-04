/**
 * Module 9 Part 2 — centralized, configurable thresholds for the capacity
 * domain logic. Nothing in warehouse-capacity.ts, warehouse-availability.
 * service.ts, or warehouse-intelligence.routes.ts hardcodes a magic number
 * for these — they all read from here, mirroring
 * sell-store-decision-engine.config.ts's own single-source-of-config
 * convention for Module 8.
 */
export const WAREHOUSE_INTELLIGENCE_CONFIG = {
  /**
   * Utilization percentage (occupied / total * 100) at or above which a
   * warehouse/storage unit with remaining capacity is reported as LIMITED
   * rather than AVAILABLE. Below this, and with capacity remaining, it is
   * AVAILABLE. At 100% remaining capacity is zero, which is always FULL
   * regardless of this threshold — see capacityStatus() in
   * warehouse-capacity.ts.
   */
  LIMITED_UTILIZATION_THRESHOLD_PERCENT: 80,

  /** Hard ceiling on nearby-search radius (build spec: "500 km unless
   * repository conventions specify otherwise" — Module 6 already uses
   * this exact ceiling for market search, see market-intelligence.
   * schemas.ts's own radiusKm.max(500)). */
  MAX_RADIUS_KM: 500,

  /** Applied when the caller omits radiusKm. */
  DEFAULT_RADIUS_KM: 50,

  /**
   * Bounding-box candidate cap before the exact Haversine pass. Keeps a
   * single dense metro area from turning "nearby warehouses" into an
   * unbounded scan — see the Repository Performance requirement to never
   * "load every warehouse in the database and calculate distance
   * blindly".
   */
  NEAREST_CANDIDATE_LIMIT: 200,

  /** Cache TTL for nearby-search and availability reads. Short by design
   * (build spec: "use short TTL") — capacity is factual, live data, not
   * something a stale cache should authoritatively answer for long. */
  CACHE_TTL_SECONDS: 120,

  /** Coordinate rounding applied only to Redis cache *keys* (~1.1 km at
   * the equator), never to the distance calculation itself, so a cache
   * key never stores a farmer's precise location (build spec: "cache keys
   * must not expose unnecessarily precise user location information"). */
  CACHE_COORDINATE_PRECISION_DECIMALS: 2,
} as const;
