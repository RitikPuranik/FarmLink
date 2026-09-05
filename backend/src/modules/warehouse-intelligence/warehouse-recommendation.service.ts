import { QuantityUnit, StorageRateType, WarehouseStatus } from "@prisma/client";
import { AuthenticatedUserContext } from "../auth/auth.types";
import { trackEvent } from "../../config/posthog";
import { haversineKm } from "../market-intelligence/analytics";
import { ReferenceDataService } from "../reference-data/reference-data.service";
import { computeBoundingBox, toKg } from "./warehouse-capacity";
import { WAREHOUSE_INTELLIGENCE_CONFIG, WAREHOUSE_RECOMMENDATION_CONFIG } from "./warehouse-intelligence.config";
import {
  buildRecommendationExplanation,
  compareForRanking,
  computeRankingScore,
  estimateStorageCost,
  scoreCapacityHeadroom,
  scoreCostsRelatively,
  scoreDistance,
} from "./warehouse-recommendation.engine";
import {
  RECOMMENDATION_DISCLAIMER,
  RecommendationSearchInput,
  UnevaluableCandidateDTO,
  WarehouseRecommendationResponse,
  WarehouseRecommendationResult,
} from "./warehouse-recommendation.types";
import { WarehouseSuitabilityAnalysisService } from "./warehouse-risk-analysis.service";
import { StorageRateRepository } from "./storage-rate.repository";
import { WarehouseRepository } from "./warehouse.repository";
import { toWarehouseDTO, WarehouseWithCapacity } from "./warehouse.types";
import { getWarehouseCache, roundCoordinateForCacheKey, setWarehouseCache } from "./warehouse-cache";

// Mirrors WarehouseAvailabilityService's own visibility rule exactly (see
// that file's own comment) — the same small local copy this module has
// already established in Parts 3 and 4 rather than a shared export.
function visibilityFilter(actor: AuthenticatedUserContext): { status?: WarehouseStatus; isActiveOnly: boolean } {
  if (actor.role === "ADMIN") return { isActiveOnly: false };
  return { status: "ACTIVE", isActiveOnly: true };
}

/**
 * Picks the most specific applicable StorageRate row: a crop-specific
 * rate (cropId matches) overrides a warehouse-wide one (cropId null),
 * mirroring the identical specific-overrides-general resolution order
 * warehouse-capacity.ts's resolveCropCompatibility()/
 * resolveMaxStorageDurationDays() already use. Storage-unit-scoped rate
 * overrides are not resolved here — Part 4's suitability analysis
 * already picks the *best* storage unit internally without exposing
 * which one, so there is no single storage unit id to key a rate
 * override against at this layer without re-deriving that choice
 * (exactly the "do not duplicate suitability logic" this part is told
 * to avoid). This is a documented simplification, not silent.
 */
function resolveApplicableRate<T extends { cropId: string | null }>(rows: T[], cropId: string): T | null {
  return rows.find((r) => r.cropId === cropId) ?? rows.find((r) => r.cropId === null) ?? null;
}

/**
 * Module 9 Part 5 — Warehouse Recommendation & Ranking Engine. Discovers
 * bounded candidates, evaluates each through Part 4's
 * WarehouseSuitabilityAnalysisService (never re-implementing suitability
 * itself), then ranks the SUITABLE/CONDITIONALLY_SUITABLE ones with
 * warehouse-recommendation.engine.ts's deterministic scoring — no AI, no
 * fabricated distances or costs.
 */
export class WarehouseRecommendationService {
  constructor(
    private readonly warehouses: WarehouseRepository,
    private readonly suitabilityAnalysis: WarehouseSuitabilityAnalysisService,
    private readonly storageRates: StorageRateRepository,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /** POST /api/warehouses/recommend */
  async recommend(input: RecommendationSearchInput, actor: AuthenticatedUserContext): Promise<WarehouseRecommendationResponse> {
    const crop = await this.referenceData.getActiveCropOrThrow(input.cropId);

    const hasLocation = input.latitude !== undefined && input.longitude !== undefined;
    const radiusKm = hasLocation ? input.radiusKm ?? WAREHOUSE_INTELLIGENCE_CONFIG.DEFAULT_RADIUS_KM : null;

    const cacheKey = [
      "recommend",
      crop.id,
      hasLocation ? roundCoordinateForCacheKey(input.latitude!) : null,
      hasLocation ? roundCoordinateForCacheKey(input.longitude!) : null,
      radiusKm,
      input.quantity ?? null,
      input.unit ?? null,
      input.durationDays ?? null,
      actor.role,
    ];
    const cached = await getWarehouseCache<WarehouseRecommendationResponse>("recommend", cacheKey);
    if (cached) return cached;

    const visibility = visibilityFilter(actor);

    trackEvent("warehouse_recommendation_requested", actor.id, { hasLocation, cropId: crop.id });

    // --- Candidate discovery (bounded, indexed — never an unbounded scan) ---
    let candidates: Array<WarehouseWithCapacity & { distanceKm: number | null }>;
    if (hasLocation) {
      const bbox = computeBoundingBox(input.latitude!, input.longitude!, radiusKm!);
      const raw = await this.warehouses.findNearbyCandidates(
        {
          minLatitude: bbox.minLatitude,
          maxLatitude: bbox.maxLatitude,
          minLongitude: bbox.minLongitude,
          maxLongitude: bbox.maxLongitude,
          status: visibility.status,
          isActiveOnly: visibility.isActiveOnly,
          cropId: crop.id,
        },
        WAREHOUSE_INTELLIGENCE_CONFIG.NEAREST_CANDIDATE_LIMIT,
      );
      candidates = raw
        .filter((w) => w.latitude !== null && w.longitude !== null)
        .map((w) => ({ ...w, distanceKm: haversineKm(input.latitude!, input.longitude!, w.latitude!, w.longitude!) }))
        .filter((w) => w.distanceKm <= radiusKm!)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    } else {
      const raw = await this.warehouses.findCandidatesByCrop(
        crop.id,
        { status: visibility.status, isActiveOnly: visibility.isActiveOnly },
        WAREHOUSE_INTELLIGENCE_CONFIG.NEAREST_CANDIDATE_LIMIT,
      );
      candidates = raw.map((w) => ({ ...w, distanceKm: null }));
    }

    // Deterministic, bounded pre-cap before the expensive per-candidate
    // Part 4 analysis (see WAREHOUSE_RECOMMENDATION_CONFIG.
    // MAX_EVALUATED_CANDIDATES's own comment) — sorted by distance when
    // known, otherwise the repository's own deterministic createdAt order
    // is already preserved by the slice below.
    const evaluated = candidates.slice(0, WAREHOUSE_RECOMMENDATION_CONFIG.MAX_EVALUATED_CANDIDATES);

    const quantityRequested = input.quantity !== undefined && input.unit !== undefined;
    const requestedKg = quantityRequested ? toKg(input.quantity!, input.unit!) : null;

    // --- Suitability analysis (Part 4, reused — never re-derived) --------
    const analyses = await Promise.all(
      evaluated.map(async (candidate) => {
        const analysis = await this.suitabilityAnalysis.analyzeSuitability(
          candidate.publicId,
          { cropId: input.cropId, quantity: input.quantity, unit: input.unit, durationDays: input.durationDays },
          actor,
        );
        return { candidate, analysis };
      }),
    );

    const unevaluableCandidates: UnevaluableCandidateDTO[] = [];
    let excludedCandidateCount = 0;

    type Rankable = (typeof analyses)[number] & { costEstimate: ReturnType<typeof estimateStorageCost> };
    const rankable: Rankable[] = [];

    for (const entry of analyses) {
      if (entry.analysis.suitability === "UNSUITABLE") {
        excludedCandidateCount += 1;
        continue;
      }
      if (entry.analysis.suitability === "UNKNOWN") {
        unevaluableCandidates.push({
          warehouse: toWarehouseDTO(entry.candidate),
          reason: "INSUFFICIENT_DATA",
          explanationCodes: entry.analysis.risks.map((r) => r.code),
        });
        continue;
      }

      // --- Cost estimation (only ever with real configured data) --------
      let costEstimate: ReturnType<typeof estimateStorageCost> = null;
      if (requestedKg !== null && input.durationDays !== undefined) {
        const applicableRates = await this.storageRates.findApplicable(entry.candidate.id, new Date(), {});
        const rate = resolveApplicableRate(applicableRates, crop.id);
        if (rate) {
          costEstimate = estimateStorageCost(
            {
              rateType: rate.rateType,
              rateAmount: Number(rate.rateAmount),
              currency: rate.currency,
              billingUnit: rate.billingUnit,
            },
            toKg,
            requestedKg,
            input.durationDays,
          );
        }
      }

      rankable.push({ ...entry, costEstimate });
    }

    // --- Ranking (cost scored relative to this evaluated batch only) ----
    const costScores = scoreCostsRelatively(rankable.map((r) => r.costEstimate?.amount ?? null));

    const scored = rankable.map((entry, i) => {
      const distanceKm = entry.candidate.distanceKm;
      const distanceScore = scoreDistance(distanceKm, radiusKm);
      const capacityScore = scoreCapacityHeadroom(
        entry.analysis.availabilitySummary.availableKg,
        requestedKg,
        entry.analysis.availabilitySummary.status,
      );
      const suitabilityScore = entry.analysis.suitabilityScore;
      const costScore = costScores[i];

      const { score, factorsUsed, omittedFactors } = computeRankingScore({
        DISTANCE: distanceScore,
        SUITABILITY_SCORE: suitabilityScore,
        CAPACITY_HEADROOM: capacityScore,
        STORAGE_COST: costScore,
      });

      return {
        entry,
        distanceKm,
        rankingScore: score ?? 0,
        factorsUsed,
        omittedFactors,
      };
    });

    scored.sort((a, b) =>
      compareForRanking(
        {
          rankingScore: a.rankingScore,
          suitabilityScore: a.entry.analysis.suitabilityScore,
          risks: a.entry.analysis.risks,
          distanceKm: a.distanceKm,
          availableCapacityKg: a.entry.analysis.availabilitySummary.availableKg,
          warehousePublicId: a.entry.candidate.publicId,
        },
        {
          rankingScore: b.rankingScore,
          suitabilityScore: b.entry.analysis.suitabilityScore,
          risks: b.entry.analysis.risks,
          distanceKm: b.distanceKm,
          availableCapacityKg: b.entry.analysis.availabilitySummary.availableKg,
          warehousePublicId: b.entry.candidate.publicId,
        },
      ),
    );

    const recommendations: WarehouseRecommendationResult[] = scored.map((s, index) => ({
      warehouse: toWarehouseDTO(s.entry.candidate),
      rank: index + 1,
      rankingScore: s.rankingScore,
      suitability: s.entry.analysis.suitability as "SUITABLE" | "CONDITIONALLY_SUITABLE",
      suitabilityScore: s.entry.analysis.suitabilityScore,
      confidence: s.entry.analysis.confidence,
      distanceKm: s.distanceKm,
      availableCapacityKg: s.entry.analysis.availabilitySummary.availableKg,
      estimatedStorageCost: s.entry.costEstimate,
      risks: s.entry.analysis.risks,
      constraints: s.entry.analysis.constraints,
      factorsUsed: s.factorsUsed,
      omittedFactors: s.omittedFactors,
      explanation: buildRecommendationExplanation({
        suitability: s.entry.analysis.suitability as "SUITABLE" | "CONDITIONALLY_SUITABLE",
        factorsUsed: s.factorsUsed,
        distanceKm: s.distanceKm,
        hasCostEstimate: s.entry.costEstimate !== null,
      }),
      evaluatedAt: s.entry.analysis.evaluatedAt,
    }));

    const response: WarehouseRecommendationResponse = {
      recommendations,
      unevaluableCandidates,
      evaluatedCandidateCount: evaluated.length,
      suitableCandidateCount: recommendations.length,
      excludedCandidateCount,
      searchMetadata: {
        cropId: crop.id,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        durationDays: input.durationDays ?? null,
        latitude: hasLocation ? input.latitude! : null,
        longitude: hasLocation ? input.longitude! : null,
        radiusKm,
      },
      disclaimer: RECOMMENDATION_DISCLAIMER,
    };

    trackEvent("warehouse_recommendation_generated", actor.id, {
      evaluatedCandidateCount: response.evaluatedCandidateCount,
      suitableCandidateCount: response.suitableCandidateCount,
      excludedCandidateCount: response.excludedCandidateCount,
      hasLocation,
    });

    // Short TTL only — recommendation results reflect live capacity/rate
    // data, same "never a correctness dependency" caching discipline as
    // Part 2's own nearby-search cache.
    await setWarehouseCache("recommend", cacheKey, response);

    return response;
  }
}
