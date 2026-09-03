import { ResolvedDecisionInput } from "../sell-store-input-resolver.types";
import { DecisionEngineResult } from "../sell-store-decision-engine.types";
import { SellStoreAIContext } from "./sell-store-ai.types";

/**
 * Module 8 Part 6, build spec section 3: builds the compact, token-efficient
 * context handed to an AI provider from data the deterministic pipeline has
 * already resolved and computed.
 *
 * This function is a hard allow-list boundary: it only ever reads the
 * specific named fields below, and never spreads or forwards its inputs
 * wholesale. `ResolvedDecisionInput.snapshot` and `DecisionEngineResult`
 * never contain database IDs, user identity, or precise coordinates to
 * begin with (see sell-vs-store.types.ts / sell-store-decision-engine.types.ts),
 * so there is nothing of that kind for this builder to accidentally leak —
 * but the explicit field-by-field mapping keeps that true even if those
 * upstream shapes grow new fields later; new fields never automatically
 * flow through to the AI context.
 *
 * Missing information is represented as `null` (or an empty array where the
 * snapshot itself uses one) exactly as the resolver/engine produced it —
 * never invented, never defaulted to a "plausible" value. Storage is
 * currently never resolved by DecisionInputResolverService (Module 8 Part
 * 2 does not yet implement a storage data source), so every storage field
 * here is consistently null/"UNKNOWN" until that changes.
 */
export function buildSellStoreAIContext(
  input: ResolvedDecisionInput,
  decision: DecisionEngineResult,
): SellStoreAIContext {
  return {
    crop: {
      name: input.snapshot.lot.cropName,
      quantity: input.snapshot.lot.quantity,
      unit: input.snapshot.lot.unit,
      qualityGrade: input.snapshot.lot.qualityGrade,
    },
    market: {
      modalPrice: input.snapshot.market.modalPrice,
      trend: input.snapshot.market.trend,
      volatility: input.snapshot.market.volatility,
      freshness: input.snapshot.market.freshness,
      confidence: input.snapshot.market.confidence,
    },
    storage: {
      availability: input.availability.storage,
      costPerUnit: input.snapshot.storage.costPerUnit,
      durationDays: input.snapshot.storage.durationDays,
      spoilageRisk: input.snapshot.storage.spoilageRisk,
      constraints: input.snapshot.storage.constraints,
    },
    deterministicDecision: {
      result: decision.result,
      confidence: decision.confidence,
      sellScore: decision.sellScore,
      storeScore: decision.storeScore,
      factorsUsed: decision.factorsUsed,
      omittedFactors: decision.omittedFactors,
      insufficiencyReasons: decision.insufficiencyReasons,
    },
  };
}
