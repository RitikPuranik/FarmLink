import { env } from "../../config/env";

/**
 * Module 16 — centralized, env-driven configuration. Nothing here is a
 * hardcoded "permanent business truth" (Step 4/9 of the build spec) — every
 * value is read from `env` (see config/env.ts's own defaults/comments) so
 * an operator can retune rates/weights per deployment without a code
 * change. Grouped into one object purely for convenient injection into
 * LogisticsCostEstimator / LogisticsOptimizationEngine constructors.
 */

export const LOGISTICS_ALGORITHM_VERSION = "v1";

export interface RouteConfig {
  roadDistanceMultiplier: number;
  averageSpeedKmph: number;
}

export function getRouteConfig(): RouteConfig {
  return {
    roadDistanceMultiplier: env.LOGISTICS_ROAD_DISTANCE_MULTIPLIER,
    averageSpeedKmph: env.LOGISTICS_AVERAGE_SPEED_KMPH,
  };
}

export interface CostConfig {
  baseCostInr: number;
  ratePerKmInr: number;
  minimumTripCostInr: number;
  loadingCostInr: number;
  unloadingCostInr: number;
  tollEstimatePerKmInr: number;
  refrigerationSurchargePercent: number;
}

export function getCostConfig(): CostConfig {
  return {
    baseCostInr: env.LOGISTICS_BASE_COST_INR,
    ratePerKmInr: env.LOGISTICS_RATE_PER_KM_INR,
    minimumTripCostInr: env.LOGISTICS_MINIMUM_TRIP_COST_INR,
    loadingCostInr: env.LOGISTICS_LOADING_COST_INR,
    unloadingCostInr: env.LOGISTICS_UNLOADING_COST_INR,
    tollEstimatePerKmInr: env.LOGISTICS_TOLL_ESTIMATE_PER_KM_INR,
    refrigerationSurchargePercent: env.LOGISTICS_REFRIGERATION_SURCHARGE_PERCENT,
  };
}

export interface OptimizationWeights {
  priceWeight: number;
  distanceWeight: number;
  timeWeight: number;
  capacityWeight: number;
  reliabilityWeight: number;
}

/**
 * Reads the five weights from env and normalizes them to sum to 1 — an
 * operator misconfiguring env (e.g. weights summing to 0.9 or 1.3) must
 * never silently skew the score's 0-100 scale; normalization keeps the
 * *relative* configured emphasis while guaranteeing a well-formed score.
 */
export function getOptimizationWeights(): OptimizationWeights {
  const raw = {
    priceWeight: env.LOGISTICS_WEIGHT_PRICE,
    distanceWeight: env.LOGISTICS_WEIGHT_DISTANCE,
    timeWeight: env.LOGISTICS_WEIGHT_TIME,
    capacityWeight: env.LOGISTICS_WEIGHT_CAPACITY,
    reliabilityWeight: env.LOGISTICS_WEIGHT_RELIABILITY,
  };
  const sum = raw.priceWeight + raw.distanceWeight + raw.timeWeight + raw.capacityWeight + raw.reliabilityWeight;
  if (sum <= 0) {
    // Never divide by zero / return NaN weights — fall back to the
    // documented starting defaults from the build spec (Step 9).
    return { priceWeight: 0.4, distanceWeight: 0.1, timeWeight: 0.2, capacityWeight: 0.15, reliabilityWeight: 0.15 };
  }
  return {
    priceWeight: raw.priceWeight / sum,
    distanceWeight: raw.distanceWeight / sum,
    timeWeight: raw.timeWeight / sum,
    capacityWeight: raw.capacityWeight / sum,
    reliabilityWeight: raw.reliabilityWeight / sum,
  };
}

export function getDefaultQuoteValidityHours(): number {
  return env.LOGISTICS_DEFAULT_QUOTE_VALIDITY_HOURS;
}

export function getRouteCacheTtlSeconds(): number {
  return env.LOGISTICS_ROUTE_CACHE_TTL_SECONDS;
}

export function getCostCacheTtlSeconds(): number {
  return env.LOGISTICS_COST_CACHE_TTL_SECONDS;
}
