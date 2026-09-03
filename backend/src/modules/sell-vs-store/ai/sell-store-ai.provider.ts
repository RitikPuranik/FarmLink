import { SellStoreAIContext, SellStoreAIProviderError } from "./sell-store-ai.types";

/**
 * Module 8 Part 6, build spec section 2: the application depends on this
 * interface only — never on a specific vendor SDK. Mirrors
 * QualityAIProvider (src/modules/quality/ai/quality-ai.provider.ts)
 * exactly, including the "swap one line in app.ts" story: a real
 * implementation (a Gemini REST call, or any other provider) can be
 * dropped in later by implementing `analyze` and wiring it in `app.ts` in
 * place of `UnavailableSellStoreAIProvider`, without touching
 * sell-store-orchestration.service.ts.
 *
 * `analyze` intentionally returns `Promise<unknown>` rather than the
 * normalized `SellStoreAdvisoryResult` — a provider hands back whatever it
 * received (e.g. parsed JSON from a REST response body), and that payload
 * is treated as untrusted until it passes through
 * parseSellStoreAdvisoryResponse (sell-store-ai-response.schema.ts). This
 * keeps "the provider said something" and "we validated what it said" as
 * two separate, both-required steps — a provider can never bypass
 * validation just by returning a value that happens to satisfy the
 * TypeScript type at compile time.
 */
export interface SellStoreAIProvider {
  readonly name: string;
  readonly modelVersion: string;
  analyze(context: SellStoreAIContext): Promise<unknown>;
}

/**
 * Module 8 Part 6, build spec section 2/10/11: this codebase has no AI
 * vendor SDK, credentials, or endpoint configured for sell/store advisory —
 * the same situation as UnavailableQualityAIProvider, and the same honest
 * behavior applies: always report unavailability with a stable error code,
 * never a plausible-looking fake summary or a guessed recommendation. This
 * still exercises the full advisory pipeline for real — context building,
 * the failure path, and the "aiAdvisory: null" fallback — exactly as it
 * would run against a real provider that happened to be down.
 */
export class UnavailableSellStoreAIProvider implements SellStoreAIProvider {
  readonly name = "unavailable";
  readonly modelVersion = "n/a";

  async analyze(_context: SellStoreAIContext): Promise<unknown> {
    throw new SellStoreAIProviderError(
      "AI_ADVISORY_UNAVAILABLE",
      "No AI sell/store advisory provider is currently configured for this deployment.",
    );
  }
}
