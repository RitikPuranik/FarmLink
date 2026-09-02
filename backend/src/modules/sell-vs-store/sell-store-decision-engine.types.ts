import { SellStoreDecisionResult } from "@prisma/client";

export type InsufficiencyReason =
  | "MISSING_MARKET_DATA"
  | "STALE_MARKET_DATA"
  | "CONFLICTING_MARKET_SIGNALS"
  | "LOW_CONFIDENCE"
  | "MISSING_CRITICAL_QUALITY_DATA"
  | "UNKNOWN_STORAGE_FEASIBILITY";

export type DecisionFactor =
  | "MARKET_TREND"
  | "VOLATILITY"
  | "STORAGE_RISK"
  | "QUALITY_CONSTRAINTS";

export interface DecisionEngineResult {
  result: SellStoreDecisionResult;
  sellScore: number | null;
  storeScore: number | null;
  confidence: number;
  factorsUsed: DecisionFactor[];
  omittedFactors: DecisionFactor[];
  insufficiencyReasons: InsufficiencyReason[];
}
