import { SellStoreDecisionStatus, SellStoreDecisionResult } from "@prisma/client";
import { SellStoreInputSnapshot } from "./sell-vs-store.types";
import { DecisionFactor, InsufficiencyReason } from "./sell-store-decision-engine.types";
import { SellStoreAdvisoryResult } from "./ai/sell-store-ai.types";

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
  /**
   * Module 8 Part 6: additive, advisory-only, and never persisted (build
   * spec section 8/9) — always null for historical decisions retrieved via
   * getDecisionByPublicId/getDecisionsForLot, since no AI advisory is ever
   * stored. Populated only on a fresh generateDecision call, and only when
   * a configured AI provider returned a response that passed validation.
   */
  aiAdvisory: SellStoreAdvisoryResult | null;
}
