import { QualityDefectSeverity, QualityGrade } from "@prisma/client";

/** Build spec section 19: what any provider implementation is handed —
 * never provider-specific request shapes leaking into quality.service.ts. */
export interface QualityAnalysisRequest {
  assessmentPublicId: string;
  cropName: string;
  images: { externalId: string; secureUrl: string; imageType: string }[];
}

/** Build spec section 22: the normalized shape every provider must
 * produce. `providerMetadata` is stored (sanitized) in
 * QualityAIAnalysis.rawResultJson for debugging, but section 22/43 is
 * explicit that this normalized shape — never a raw provider payload — is
 * what the rest of the system (and any client) ever sees. */
export interface QualityAnalysisResult {
  confidence: number;
  suggestedGrade?: QualityGrade;
  metrics: { code: string; name: string; value: number; unit?: string; confidence?: number }[];
  detectedDefects?: { code: string; name: string; severity: QualityDefectSeverity; affectedPercentage?: number; confidence?: number }[];
  providerMetadata?: Record<string, unknown>;
}

/** Build spec section 21/67: a provider failure (including "no provider is
 * configured at all") is a typed error, never a fabricated result — the
 * caller stores `code`/message on the QualityAIAnalysis row and moves the
 * assessment to FAILED. */
export class QualityAiProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "QualityAiProviderError";
  }
}
