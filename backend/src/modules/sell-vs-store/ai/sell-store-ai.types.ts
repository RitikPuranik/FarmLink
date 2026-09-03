import { SellStoreDecisionResult } from "@prisma/client";
import { DecisionFactor, InsufficiencyReason } from "../sell-store-decision-engine.types";

/**
 * Module 8 Part 6, build spec section 3: the only shape an AI provider is
 * ever handed. This is a small, explicit allow-list — never a raw Prisma
 * row, database ID, user name/phone/email/address, or precise coordinate.
 * Fields the resolver/engine did not actually produce are represented as
 * `null`, never invented (e.g. there is no 7-day/30-day price-change field
 * yet, so this shape doesn't include one — see sell-store-ai-context.builder.ts).
 */
export interface SellStoreAIContext {
  crop: {
    name: string;
    quantity: number;
    unit: string;
    qualityGrade: string | null;
  };
  market: {
    modalPrice: number | null;
    trend: "UP" | "DOWN" | "STABLE" | null;
    volatility: number | null;
    freshness: "FRESH" | "RECENT" | "STALE" | "OUTDATED" | null;
    confidence: number | null;
  };
  storage: {
    availability: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
    costPerUnit: number | null;
    durationDays: number | null;
    spoilageRisk: number | null;
    constraints: string[] | null;
  };
  deterministicDecision: {
    result: SellStoreDecisionResult;
    confidence: number;
    sellScore: number | null;
    storeScore: number | null;
    factorsUsed: DecisionFactor[];
    omittedFactors: DecisionFactor[];
    insufficiencyReasons: InsufficiencyReason[];
  };
}

/**
 * Module 8 Part 6, build spec section 6/9: the bounded, validated shape
 * every provider's output is normalized into before anything else in the
 * system sees it — never a raw provider payload. See
 * sell-store-ai-response.schema.ts for the Zod schema that enforces this
 * at runtime (max string lengths, max array sizes, no unknown fields).
 */
export interface SellStoreAdvisoryResult {
  summary: string;
  reasoning: string[];
  risks: string[];
  considerations: string[];
  dataLimitations: string[];
  advisoryAlignment: {
    agreesWithDeterministicDecision: boolean;
    explanation: string;
  };
}

/**
 * Module 8 Part 6, build spec section 7/10: a provider failure — no
 * provider configured, timeout, quota, network failure, or a response that
 * fails schema validation — is always a typed error, never a fabricated
 * advisory. The orchestrator catches this (and only this triggers
 * aiAdvisory: null); it must never mark the already-persisted deterministic
 * decision as FAILED.
 */
export class SellStoreAIProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SellStoreAIProviderError";
  }
}
