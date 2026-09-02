export interface SellStoreInputSnapshot {
  market: {
    modalPrice: number | null;
    trend: "UP" | "DOWN" | "STABLE" | null;
    volatility: number | null;
    freshness: "FRESH" | "RECENT" | "STALE" | "OUTDATED" | null;
    confidence: number | null;
    sourceTimestamp: string | null;
  };
  lot: {
    quantity: number;
    unit: string;
    cropName: string;
    qualityGrade: string | null;
  };
  storage: {
    availability: boolean | null;
    costPerUnit: number | null;
    durationDays: number | null;
    constraints: string[] | null;
    spoilageRisk: number | null;
  };
}
