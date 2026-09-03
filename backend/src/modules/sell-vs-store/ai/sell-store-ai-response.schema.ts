import { z } from "zod";
import { SellStoreAdvisoryResult, SellStoreAIProviderError } from "./sell-store-ai.types";

// Module 8 Part 6, build spec section 6: bounded string/array sizes — kept
// generous enough for genuinely useful advisory text, but small enough that
// a provider cannot return an unbounded blob. Mirrors the bounding style
// already used for user input in quality.schemas.ts (e.g. notes.max(2000)).
const ADVISORY_STRING_MAX = 400;
const ADVISORY_LIST_MAX_ITEMS = 6;

const advisoryString = z.string().trim().min(1).max(ADVISORY_STRING_MAX);
const advisoryList = z.array(advisoryString).max(ADVISORY_LIST_MAX_ITEMS);

/**
 * `.strict()` at every object level: an AI response with unexpected extra
 * fields is rejected outright rather than silently accepted with the
 * unknown fields dropped — build spec section 6 is explicit that arbitrary
 * free-form JSON must not be accepted.
 */
export const sellStoreAdvisoryResponseSchema = z
  .object({
    summary: advisoryString,
    reasoning: advisoryList,
    risks: advisoryList,
    considerations: advisoryList,
    dataLimitations: advisoryList,
    advisoryAlignment: z
      .object({
        agreesWithDeterministicDecision: z.boolean(),
        explanation: advisoryString,
      })
      .strict(),
  })
  .strict();

/**
 * Module 8 Part 6, build spec section 6/13: the single validation gate
 * between a provider's raw output and the rest of the system. A response
 * that doesn't match this bounded shape — missing fields, wrong types,
 * oversized strings/arrays, or unexpected extra fields — is rejected
 * safely: it throws a typed SellStoreAIProviderError, the same failure
 * shape as a timeout or a missing API key, so the caller has exactly one
 * catch path and the deterministic decision is never affected.
 */
export function parseSellStoreAdvisoryResponse(raw: unknown): SellStoreAdvisoryResult {
  const parsed = sellStoreAdvisoryResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SellStoreAIProviderError(
      "AI_RESPONSE_INVALID",
      "The AI advisory response did not match the expected schema.",
    );
  }
  return parsed.data;
}
