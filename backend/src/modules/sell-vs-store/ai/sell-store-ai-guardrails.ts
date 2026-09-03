import { SellStoreAIContext } from "./sell-store-ai.types";

/**
 * Module 8 Part 6, build spec section 5: the system prompt any real
 * provider implementation must send. Kept short and rule-based rather than
 * narrative — every line maps to something the AI is being asked not to
 * do, and the structural rules (bounded lengths/array sizes, no unknown
 * fields) are separately enforced at runtime by
 * sell-store-ai-response.schema.ts regardless of whether the model follows
 * this prompt.
 *
 * No provider currently reads this constant (there is no real vendor
 * configured — see UnavailableSellStoreAIProvider), but it is exported so
 * a future real provider implementation has a single, reviewed source of
 * truth for the advisory's guardrails instead of each provider inventing
 * its own wording.
 */
export const SELL_STORE_AI_SYSTEM_PROMPT = `You are an advisory assistant helping a farmer understand a sell-vs-store recommendation that has already been made by a separate, deterministic decision engine. That engine's result is final and authoritative — you are not deciding anything, only explaining and adding context.

Rules you must follow at all times:
- Use only the data supplied in the context below. Never invent prices, storage availability, quality information, weather, logistics, or buyer demand.
- Never predict or imply future prices, and never state or imply a guaranteed profit or outcome. Do not use language like "prices will rise" or "you will earn more" — describe only what the available data currently shows.
- Never claim certainty. If the data is thin, stale, or missing, say so plainly.
- Treat the deterministic result (SELL_NOW, STORE, or INSUFFICIENT_DATA) as the authoritative baseline. You may note where the evidence feels weaker or stronger than that result, but you must never tell the farmer to do the opposite of it.
- Clearly call out missing or low-confidence information rather than glossing over it.
- Be concise and practical. Avoid speculation, hedging filler, and generic advice unconnected to the supplied context.
- Respond with only the structured JSON object requested — no prose outside it, no markdown, no extra fields.`;

/**
 * Serializes the compact AI context into the user-turn payload a real
 * provider would send alongside SELL_STORE_AI_SYSTEM_PROMPT. Kept separate
 * from the prompt constant so a future provider can reuse either piece
 * independently (e.g. a provider that sends context as structured tool
 * input rather than a JSON string in the prompt).
 */
export function buildSellStoreAIUserPayload(context: SellStoreAIContext): string {
  return JSON.stringify(context);
}
