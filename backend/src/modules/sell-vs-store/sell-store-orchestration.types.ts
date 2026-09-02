import { SellStoreDecisionStatus, SellStoreDecisionResult } from "@prisma/client";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";
import { DecisionFactor, InsufficiencyReason } from "./sell-store-decision-engine.types";

export interface DecisionMetadata {
  engineVersion: string;
  factorsUsed: DecisionFactor[];
  omittedFactors: DecisionFactor[];
  insufficiencyReasons: InsufficiencyReason[];
  sellScore: number | null;
  storeScore: number | null;
}

export interface SellStoreDecisionDTO {
  publicId: string;
  lotId: string;
  cropId: string;
  requestedByUserId: string | null;
  status: SellStoreDecisionStatus;
  result: SellStoreDecisionResult | null;
  confidenceScore: number | null;
  inputSnapshot: SellStoreInputSnapshot | null;
  decisionMetadata: DecisionMetadata | null;
  marketDataTimestamp: Date | null;
  storageDataTimestamp: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
