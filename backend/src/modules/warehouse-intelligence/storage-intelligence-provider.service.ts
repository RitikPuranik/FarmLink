import {
  StorageContextRequest,
  StorageDecisionContext,
  StorageIntelligenceProvider,
} from "./storage-intelligence-provider";
import { WarehouseRecommendationService } from "./warehouse-recommendation.service";

// ---------------------------------------------------------------------------
// Module 9 Part 6 — the real StorageIntelligenceProvider implementation.
// Deliberately thin: it calls Part 5's recommend() (which itself calls
// Part 4's analyzeSuitability() per candidate) and reshapes the result
// into StorageDecisionContext. No suitability/ranking logic is
// re-implemented here — this file's only job is normalization.
// ---------------------------------------------------------------------------

export class WarehouseStorageIntelligenceProvider implements StorageIntelligenceProvider {
  constructor(private readonly recommendations: WarehouseRecommendationService) {}

  async resolveStorageContext(request: StorageContextRequest): Promise<StorageDecisionContext> {
    const result = await this.recommendations.recommend(
      {
        cropId: request.cropId,
        latitude: request.latitude,
        longitude: request.longitude,
        radiusKm: request.radiusKm,
        quantity: request.quantity,
        unit: request.unit,
        durationDays: request.durationDays,
      },
      request.requestingUser as never, // AuthenticatedUserContext shape — see this file's own module doc.
    );

    const best = result.recommendations[0] ?? null;

    // --- Availability semantics (see StorageDecisionContext's own doc) ---
    // TRUE: at least one confirmed candidate.
    // FALSE: candidates were found and evaluated, and none came back
    //        genuinely unevaluable (empty unevaluableCandidates) — we can
    //        be confident it's a real "no", not a data gap; OR no
    //        candidate warehouse exists for this crop at all
    //        (evaluatedCandidateCount === 0), which is equally a known,
    //        confirmed "no warehouse supports this" fact.
    // NULL:  candidates existed but none could be confirmed suitable AND
    //        at least one came back genuinely unevaluable (insufficient
    //        data) — we cannot honestly call this "no storage exists",
    //        only "we don't know".
    let availability: boolean | null;
    if (result.recommendations.length > 0) {
      availability = true;
    } else if (result.evaluatedCandidateCount === 0) {
      availability = false;
    } else if (result.unevaluableCandidates.length > 0) {
      availability = null;
    } else {
      availability = false;
    }

    const feasibleDurationDays =
      best && request.durationDays !== undefined && !best.constraints.some((c) => c.code === "MAXIMUM_STORAGE_DURATION_EXCEEDED")
        ? request.durationDays
        : null;

    const costPerUnit =
      best?.estimatedStorageCost && best.estimatedStorageCost.quantityUsedKg > 0
        ? Math.round((best.estimatedStorageCost.amount / best.estimatedStorageCost.quantityUsedKg) * 100) / 100
        : null;

    return {
      availability,
      suitableWarehouseCount: result.suitableCandidateCount,
      bestWarehouseAvailable: best
        ? {
            warehousePublicId: best.warehouse.publicId,
            name: best.warehouse.name,
            distanceKm: best.distanceKm,
            suitabilityScore: best.suitabilityScore,
          }
        : null,
      estimatedCost: best?.estimatedStorageCost?.amount ?? null,
      costPerUnit,
      currency: best?.estimatedStorageCost?.currency ?? null,
      feasibleDurationDays,
      risks: best
        ? best.risks.map((r) => r.code)
        : availability === null
          ? result.unevaluableCandidates.flatMap((c) => c.explanationCodes)
          : [],
      constraints: best ? best.constraints.map((c) => c.code) : [],
      confidence: best?.confidence ?? null,
      dataTimestamp: new Date().toISOString(),
      factorsUsed: best?.factorsUsed ?? [],
      omittedFactors: best?.omittedFactors ?? [],
    };
  }
}
