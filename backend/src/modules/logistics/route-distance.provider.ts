/**
 * Step 3 — Route calculation abstraction. Deliberately a small interface so
 * a real routing provider (Google Directions, OSRM, Mapbox, etc.) can
 * later implement the same contract without touching any caller
 * (LogisticsCostEstimator, LogisticsRequestService) — see the module doc
 * in Step 3 of the build spec: "Design the provider interface so a real
 * routing provider can later replace it."
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
  /** Always true for the deterministic fallback below — a future real
   * routing provider implementation would set this false. Surfaced in API
   * responses so a farmer never mistakes a straight-line estimate for an
   * actual road distance without being told (Step 3: "Clearly mark this
   * as estimated distance"). */
  isEstimated: boolean;
}

export interface RouteDistanceProvider {
  calculateDistance(origin: GeoPoint, destination: GeoPoint): Promise<number>;
  calculateDuration(distanceKm: number): Promise<number>;
  estimateRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteEstimate>;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Straight-line (great-circle) distance between two lat/lng points, per
 * the Haversine formula — the deterministic fallback required by Step 3.
 * Exported standalone (not just as a method) so it is trivially unit
 * testable against known point pairs.
 */
export function haversineDistanceKm(origin: GeoPoint, destination: GeoPoint): number {
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const lat1 = toRadians(origin.latitude);
  const lat2 = toRadians(destination.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Deterministic fallback RouteDistanceProvider (Step 3). Straight-line
 * Haversine distance scaled by a configurable road-distance multiplier
 * (real road networks are never a straight line) and converted to an
 * estimated duration using a configurable average speed. No third-party
 * maps API is required for this module to function end-to-end.
 */
export class HaversineRouteDistanceProvider implements RouteDistanceProvider {
  constructor(private readonly config: { roadDistanceMultiplier: number; averageSpeedKmph: number }) {}

  async calculateDistance(origin: GeoPoint, destination: GeoPoint): Promise<number> {
    const straightLineKm = haversineDistanceKm(origin, destination);
    return straightLineKm * this.config.roadDistanceMultiplier;
  }

  async calculateDuration(distanceKm: number): Promise<number> {
    if (this.config.averageSpeedKmph <= 0) return 0;
    const hours = distanceKm / this.config.averageSpeedKmph;
    return Math.round(hours * 60);
  }

  async estimateRoute(origin: GeoPoint, destination: GeoPoint): Promise<RouteEstimate> {
    const distanceKm = await this.calculateDistance(origin, destination);
    const durationMinutes = await this.calculateDuration(distanceKm);
    return { distanceKm, durationMinutes, isEstimated: true };
  }
}
