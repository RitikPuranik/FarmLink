export type TrendDirection = "STRONGLY_UP" | "UP" | "STABLE" | "DOWN" | "STRONGLY_DOWN";
export type VolatilityLevel = "LOW" | "MEDIUM" | "HIGH" | "UNAVAILABLE";
export type DataFreshness = "FRESH" | "RECENT" | "STALE" | "OUTDATED";
export type RecommendationConfidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";

export const MARKET_CONFIG = {
  maxRadiusKm: 500, maxDays: 365, trendStrong: 10, trend: 3,
  volatilityMedium: 0.1, volatilityHigh: 0.2,
  freshHours: 24, recentHours: 72, staleHours: 168,
} as const;

export interface PricePoint { date: Date; modalPrice: number; minPrice: number; maxPrice: number; arrivalQuantity: number | null; }
export interface MarketCandidate {
  mandi: { id: string; publicId: string; name: string; district: string; state: string; latitude: number | null; longitude: number | null };
  latest: PricePoint;
  history: PricePoint[];
  distanceKm?: number;
}
