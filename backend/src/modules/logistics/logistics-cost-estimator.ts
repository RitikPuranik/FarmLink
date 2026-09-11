import { CostConfig } from "./logistics.config";

/**
 * Step 4 — dedicated cost calculation, deliberately kept out of any
 * controller/service (build spec: "Do not place cost calculations in
 * controllers"). Pure and synchronous: given a distance and a few request
 * attributes, always returns the same breakdown — the same "deterministic
 * and explainable" requirement Step 9's optimization engine is held to.
 */

export interface CostEstimateInput {
  distanceKm: number;
  requiresRefrigeration: boolean;
  /** Loading/unloading is charged once per trip regardless of distance —
   * callers pass false only for a rare "provider handles loading
   * separately" case; defaults to true. */
  includeLoadingUnloading?: boolean;
}

export interface CostBreakdown {
  baseCost: number;
  distanceCost: number;
  loadingCost: number;
  unloadingCost: number;
  tollEstimate: number;
  refrigerationSurcharge: number;
  /** Sum of every component above, before the minimum-trip-cost floor is
   * applied — kept for transparency even though `totalCost` is the number
   * callers should actually charge/display. */
  subtotal: number;
  totalCost: number;
  currency: string;
}

const CURRENCY = "INR";

export class LogisticsCostEstimator {
  constructor(private readonly config: CostConfig) {}

  estimate(input: CostEstimateInput): CostBreakdown {
    const distanceKm = Math.max(0, input.distanceKm);
    const includeLoadingUnloading = input.includeLoadingUnloading ?? true;

    const baseCost = this.config.baseCostInr;
    const distanceCost = distanceKm * this.config.ratePerKmInr;
    const loadingCost = includeLoadingUnloading ? this.config.loadingCostInr : 0;
    const unloadingCost = includeLoadingUnloading ? this.config.unloadingCostInr : 0;
    const tollEstimate = distanceKm * this.config.tollEstimatePerKmInr;

    const preSurchargeSubtotal = baseCost + distanceCost + loadingCost + unloadingCost + tollEstimate;
    const refrigerationSurcharge = input.requiresRefrigeration
      ? preSurchargeSubtotal * (this.config.refrigerationSurchargePercent / 100)
      : 0;

    const subtotal = preSurchargeSubtotal + refrigerationSurcharge;
    const totalCost = Math.max(subtotal, this.config.minimumTripCostInr);

    return {
      baseCost: round2(baseCost),
      distanceCost: round2(distanceCost),
      loadingCost: round2(loadingCost),
      unloadingCost: round2(unloadingCost),
      tollEstimate: round2(tollEstimate),
      refrigerationSurcharge: round2(refrigerationSurcharge),
      subtotal: round2(subtotal),
      totalCost: round2(totalCost),
      currency: CURRENCY,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
