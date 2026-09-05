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

/**
 * Module 9 Part 3 — centralized deterministic policy for the storage
 * suitability engine (storage-suitability.engine.ts). Every criticality
 * classification, confidence threshold, and explanation-code string used
 * by the engine/service is read from here — nothing is scattered as a
 * magic string/number at a call site, mirroring
 * WAREHOUSE_INTELLIGENCE_CONFIG's own single-source-of-config convention
 * above. This is a deterministic *data-completeness/severity* policy, not
 * a scientific claim about any crop — see the module doc for why
 * temperature/storage-type/cold-storage are treated as CRITICAL by
 * default while ventilation/pest-control/humidity/moisture are not.
 */
export const STORAGE_SUITABILITY_CONFIG = {
  /**
   * Requirement factors whose UNMET or UNKNOWN outcome is severe enough to
   * gate the whole result (UNMET -> UNSUITABLE, UNKNOWN -> UNKNOWN — see
   * evaluateStorageSuitability()). Kept as a plain Set of the engine's own
   * factor keys so adding/removing a factor from "critical" status is a
   * one-line config change, never a scattered if/else.
   */
  CRITICAL_FACTORS: new Set([
    "STORAGE_TYPE",
    "TEMPERATURE_RANGE",
    "COLD_STORAGE",
    "CONTROLLED_ATMOSPHERE",
  ]),

  /** Every other factor the engine can evaluate is non-critical: an unmet
   * or unknown outcome can only produce CONDITIONALLY_SUITABLE, never
   * UNSUITABLE/UNKNOWN on its own. */
  NON_CRITICAL_FACTORS: new Set(["HUMIDITY_RANGE", "VENTILATION", "PEST_CONTROL", "MOISTURE_CONTROL"]),

  /** A crop's preferred range only counts as PARTIAL_MATCH (rather than
   * FULL_MATCH) if the warehouse's supported range covers less than this
   * fraction of the crop's preferred range — see compareRange() in
   * storage-suitability.engine.ts. Below that overlap fraction the ranges
   * are treated the same as NO_MATCH for severity purposes but the raw
   * overlap outcome is still reported distinctly for transparency. */
  MIN_PARTIAL_OVERLAP_FRACTION: 0.000001,
} as const;

export type CriticalFactorKey =
  | "STORAGE_TYPE"
  | "TEMPERATURE_RANGE"
  | "COLD_STORAGE"
  | "CONTROLLED_ATMOSPHERE"
  | "HUMIDITY_RANGE"
  | "VENTILATION"
  | "PEST_CONTROL"
  | "MOISTURE_CONTROL";

export function isCriticalFactor(key: CriticalFactorKey): boolean {
  return STORAGE_SUITABILITY_CONFIG.CRITICAL_FACTORS.has(key);
}

/**
 * Module 9 Part 4 — centralized deterministic policy for the broader
 * Warehouse Suitability & Risk Analysis layer (warehouse-risk-analysis.
 * engine.ts). This composes Part 3's environmental-suitability engine
 * with crop compatibility (Part 1's WarehouseCropCapability), capacity
 * (Part 2), storage-duration limits (Part 1's
 * WarehouseCropCapability.maxStorageDurationDays), and warehouse
 * operational status into one deterministic score/risk/constraint
 * result. Every weight/threshold below is read by the engine, never
 * hardcoded at a call site.
 */
export const WAREHOUSE_RISK_ANALYSIS_CONFIG = {
  /**
   * Score weights (0-100 scale, sum to 100 when every factor is
   * evaluated). "Data completeness" is deliberately not a sixth scored
   * factor here — it is already expressed through `confidence`, and
   * scoring it a second time would double-count the same
   * data-availability signal under two different names.
   */
  SCORE_WEIGHTS: {
    CROP_COMPATIBILITY: 25,
    CAPACITY_FEASIBILITY: 25,
    ENVIRONMENTAL_COMPATIBILITY: 25,
    WAREHOUSE_OPERATIONAL_STATUS: 15,
    DURATION_COMPATIBILITY: 10,
  },

  /** Per-outcome score contribution (0-100) for each factor — see
   * warehouse-risk-analysis.engine.ts's own scoreForFactor(). LIMITED
   * capacity/CONDITIONALLY_SUITABLE environmental compatibility are
   * scored partway rather than as a full pass, since they are real,
   * documented constraints, not perfect fits. */
  CAPACITY_STATUS_SCORE: { AVAILABLE: 100, LIMITED: 70, FULL: 0, UNAVAILABLE: null as number | null },
  ENVIRONMENTAL_STATUS_SCORE: { SUITABLE: 100, CONDITIONALLY_SUITABLE: 70, UNSUITABLE: 0, UNKNOWN: null as number | null },

  /**
   * Factors whose outcome being genuinely UNKNOWN (not merely "omitted
   * because it wasn't requested") forces the whole analysis to
   * UNKNOWN/INSUFFICIENT_DATA rather than a scored SUITABLE/
   * CONDITIONALLY_SUITABLE — mirrors STORAGE_SUITABILITY_CONFIG.
   * CRITICAL_FACTORS' role for Part 3. Duration compatibility is
   * deliberately excluded: a crop with no requested duration, or a
   * warehouse with no configured maximum, is a normal "not applicable"
   * case, not a data gap serious enough to block the whole assessment.
   */
  CRITICAL_ANALYSIS_FACTORS: new Set(["CROP_COMPATIBILITY", "CAPACITY_FEASIBILITY", "ENVIRONMENTAL_COMPATIBILITY"]),

  /** Below this confidence, a WAREHOUSE_DATA_INCOMPLETE risk is added
   * even when no single factor was decisive enough on its own to add a
   * more specific risk — a general "treat this result cautiously"
   * signal, LOW severity, never blocking. */
  LOW_CONFIDENCE_THRESHOLD: 0.6,
} as const;

export type AnalysisFactorKey = keyof typeof WAREHOUSE_RISK_ANALYSIS_CONFIG.SCORE_WEIGHTS;

export function isCriticalAnalysisFactor(key: AnalysisFactorKey): boolean {
  return WAREHOUSE_RISK_ANALYSIS_CONFIG.CRITICAL_ANALYSIS_FACTORS.has(key);
}

/**
 * Module 9 Part 5 — centralized deterministic policy for the Warehouse
 * Recommendation & Ranking Engine (warehouse-recommendation.engine.ts).
 * Ranking factor weights are the build spec's own worked example
 * (distance 30 / suitability 30 / capacity 20 / cost 20, summing to
 * 100), adopted rather than invented, since the spec offered them as a
 * concrete, intentional default.
 */
export const WAREHOUSE_RECOMMENDATION_CONFIG = {
  RANKING_WEIGHTS: {
    DISTANCE: 30,
    SUITABILITY_SCORE: 30,
    CAPACITY_HEADROOM: 20,
    STORAGE_COST: 20,
  },

  /**
   * Upper bound on how many candidates receive a full Part 4 suitability
   * analysis per recommendation request. Part 4's own analysis makes
   * several sequential reads per warehouse (see its own module doc's
   * "N+1 / query-count note"); running it against an unbounded candidate
   * set would turn one recommendation request into an unbounded number
   * of database round trips. Candidates beyond this cap are reported in
   * `evaluatedCandidateCount` accounting but never silently dropped
   * without being counted.
   */
  MAX_EVALUATED_CANDIDATES: 20,

  /**
   * Capacity-headroom ranking score (distinct from Part 4's binary
   * canAccommodate 0/100 feasibility score — this one differentiates
   * *how much* room a candidate has, for ranking among several
   * already-accommodating warehouses): exactly enough capacity scores
   * 50; capacity at or above (1 + this ratio) times the requested
   * quantity saturates at 100.
   */
  CAPACITY_HEADROOM_SATURATION_RATIO: 1,

  /** Default duration (days) used only for a cost estimate when a
   * candidate has an applicable rate but the caller didn't request a
   * specific duration — never applied to suitability/duration-limit
   * checks (that stays Part 4's job), only to give a same-basis cost
   * comparison across candidates when nobody asked for a specific
   * number of days. Set to null (rather than a fabricated default) to
   * keep cost honestly omitted unless the caller actually requested a
   * duration — see warehouse-recommendation.engine.ts's own comment. */
  DEFAULT_COST_DURATION_DAYS: null as number | null,
} as const;

export type RankingFactorKey = keyof typeof WAREHOUSE_RECOMMENDATION_CONFIG.RANKING_WEIGHTS;
