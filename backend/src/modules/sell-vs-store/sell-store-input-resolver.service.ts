import { NotFoundError } from "../../common/errors";
import { CropLotRepository } from "../lots/lots.repository";
import { QualityRepository } from "../quality/quality.repository";
import { MarketIntelligenceRepository } from "../market-intelligence/market-intelligence.repository";
import { average, percentChange, trend, volatility, freshness, confidence } from "../market-intelligence/analytics";
import { ResolvedDecisionInput, MissingDecisionInput } from "./sell-store-input-resolver.types";

export class DecisionInputResolverService {
  constructor(
    private readonly lots: CropLotRepository,
    private readonly quality: QualityRepository,
    private readonly market: MarketIntelligenceRepository
  ) {}

  async resolveDecisionInputs(lotPublicId: string): Promise<ResolvedDecisionInput> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const missingInputs: MissingDecisionInput[] = [];

    // 1. Quality Context
    const currentQuality = await this.quality.findCurrentByLotId(lot.id);
    let qualityGrade: string | null = null;
    let qualityAvailable = false;
    
    if (currentQuality && currentQuality.overallGrade) {
      qualityGrade = currentQuality.overallGrade;
      qualityAvailable = true;
    } else {
      missingInputs.push("QUALITY_GRADE");
    }

    // 2. Market Context
    let latestMarkets = await this.market.latestMarkets(lot.cropId, { state: lot.originState, district: lot.originDistrict });
    
    // Fallback to state level if district has no data
    if (!latestMarkets.length) {
       latestMarkets = await this.market.latestMarkets(lot.cropId, { state: lot.originState });
    }

    // Fallback to national if state has no data
    if (!latestMarkets.length) {
       latestMarkets = await this.market.latestMarkets(lot.cropId, {});
    }

    let marketDataTimestamp: Date | null = null;
    let marketAvailable = false;
    let modalPrice: number | null = null;
    let computedTrend: "UP" | "DOWN" | "STABLE" | null = null;
    let computedVolatility: number | null = null;
    let computedFreshness: "FRESH" | "RECENT" | "STALE" | "OUTDATED" | null = null;
    let computedConfidence: number | null = null;

    if (latestMarkets.length > 0) {
      marketAvailable = true;
      const latestPrices = latestMarkets.map(m => m.latest.modalPrice);
      modalPrice = average(latestPrices) ?? null;
      
      const lastUpdated = latestMarkets.reduce((a, b) => a.latest.date > b.latest.date ? a : b).latest.date;
      marketDataTimestamp = lastUpdated;

      const d14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const historyMap = await this.market.historyForMandis(lot.cropId, d14, new Date(), latestMarkets.map(m => m.mandi.id));
      
      const allHistoryValues = Array.from(historyMap.values()).flat();
      const allHistoryPrices = allHistoryValues.map(h => h.modalPrice);
      
      const vol = volatility(allHistoryPrices);
      computedVolatility = vol.score;
      
      const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentPrices = allHistoryValues.filter(v => v.date >= d7).map(v => v.modalPrice);
      const previousPrices = allHistoryValues.filter(v => v.date >= d14 && v.date < d7).map(v => v.modalPrice);
      const ch7 = percentChange(average(recentPrices), average(previousPrices));
      
      const trendResult = trend(ch7);
      // Map STRONGLY_UP to UP and STRONGLY_DOWN to DOWN for our snapshot enum
      computedTrend = (trendResult === "STRONGLY_UP" || trendResult === "UP") ? "UP" : 
                      (trendResult === "STRONGLY_DOWN" || trendResult === "DOWN") ? "DOWN" : "STABLE";
      
      const dataFreshness = freshness(lastUpdated);
      computedFreshness = dataFreshness;
      
      const confLevel = confidence(allHistoryPrices.length, dataFreshness, vol.score);
      computedConfidence = confLevel === "HIGH" ? 0.9 : confLevel === "MEDIUM" ? 0.6 : confLevel === "LOW" ? 0.3 : 0.0;
    } else {
      missingInputs.push("MARKET_DATA");
    }

    // 3. Storage Context
    missingInputs.push("STORAGE_DATA");

    return {
      snapshot: {
        market: {
          modalPrice,
          trend: computedTrend,
          volatility: computedVolatility,
          freshness: computedFreshness,
          confidence: computedConfidence,
          sourceTimestamp: marketDataTimestamp?.toISOString() ?? null,
        },
        lot: {
          quantity: Number(lot.availableQuantityKg),
          unit: "KG",
          cropName: lot.crop.name,
          qualityGrade,
        },
        storage: {
          availability: null,
          costPerUnit: null,
          durationDays: null,
          constraints: null,
          spoilageRisk: null,
        }
      },
      availability: {
        market: marketAvailable,
        quality: qualityAvailable,
        storage: "UNKNOWN",
      },
      missingInputs,
      timestamps: {
        marketDataTimestamp,
        storageDataTimestamp: null,
      }
    };
  }
}
