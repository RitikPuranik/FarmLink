import { SellStoreInputSnapshot } from "./sell-vs-store.types";

export type MissingDecisionInput = "QUALITY_GRADE" | "MARKET_DATA" | "STORAGE_DATA";

export interface ResolvedDecisionInput {
  snapshot: SellStoreInputSnapshot;
  availability: {
    market: boolean;
    quality: boolean;
    storage: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  };
  missingInputs: MissingDecisionInput[];
  timestamps: {
    marketDataTimestamp: Date | null;
    storageDataTimestamp: Date | null;
  };
}
