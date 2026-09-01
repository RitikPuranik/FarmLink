import { QualityAiProviderError, QualityAnalysisRequest, QualityAnalysisResult } from "./quality-ai.types";

/**
 * Build spec section 19: the application depends on this interface only —
 * never on a specific vendor SDK. A real implementation (Gemini Vision, a
 * custom CV model, ...) can be dropped in later by implementing `analyze`
 * and wiring it in `app.ts` in place of `UnavailableQualityAIProvider`,
 * without touching quality.service.ts.
 */
export interface QualityAIProvider {
  readonly name: string;
  readonly modelVersion: string;
  analyze(request: QualityAnalysisRequest): Promise<QualityAnalysisResult>;
}

/**
 * Build spec section 21: "If AI provider is unavailable... do NOT return
 * Grade A, Confidence 95% with random/generated values." This codebase has
 * no AI vendor SDK, credentials, or endpoint configured — there is
 * genuinely nothing to call — so the honest behavior is to always report
 * unavailability with a stable error code, never a plausible-looking fake
 * result. This still exercises the entire pipeline for real: the PROCESSING
 * -> FAILED transition, error storage, and the retry endpoint all run
 * against this provider exactly as they would against a real one that
 * happened to be down.
 */
export class UnavailableQualityAIProvider implements QualityAIProvider {
  readonly name = "unavailable";
  readonly modelVersion = "n/a";

  async analyze(_request: QualityAnalysisRequest): Promise<QualityAnalysisResult> {
    throw new QualityAiProviderError(
      "AI_ANALYSIS_UNAVAILABLE",
      "No AI quality provider is currently configured for this deployment.",
    );
  }
}
