import { ValidationError } from "../../common/errors";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import { checkDataSufficiency } from "./price-forecasting.sufficiency";
import { ForecastHorizon, ForecastScope } from "./price-forecasting.types";
import { PriceHistoryRepository } from "./price-history.repository";
import {
  HistoryWindow,
  PreparationInsufficiencyReason,
  PreparedPriceHistory,
  PriceHistoryRequest,
  RawPriceRow,
} from "./price-history.types";
import {
  addDaysUTC,
  aggregateAcrossMandisByDate,
  assessDataQuality,
  collapseByMandiDay,
  computeGapAnalysis,
  flagOutliers,
  isChronologicallySorted,
  partitionValidity,
  sortObservationsByDate,
  startOfDayUTC,
  toMandiObservations,
} from "./price-history.aggregation";

/**
 * Module 7 Part 2 — Historical Data Preparation.
 *
 * Converts raw MandiPrice records into a clean, deterministic time series
 * suitable for a *future* forecasting algorithm to consume. This service
 * intentionally does no forecasting of its own — see the module doc
 * (docs/modules/module-07-price-forecasting.md) for the full list of what
 * is explicitly out of scope.
 *
 * Orchestration only: every transformation this service performs is a call
 * into a pure function from price-history.aggregation.ts. This class's own
 * job is (1) resolve/clamp the requested window, (2) call the repository
 * once for raw rows + once for a total-observation count, and (3) thread
 * the results through the pure pipeline in order.
 */
export class PriceHistoryPreparationService {
  constructor(private readonly repo: PriceHistoryRepository) {}

  async prepare(request: PriceHistoryRequest): Promise<PreparedPriceHistory> {
    const window = this.resolveWindow(request);
    const horizonDays: ForecastHorizon = request.horizonDays ?? PRICE_FORECAST_CONFIG.DEFAULT_HORIZON_DAYS;

    const rawRows = await this.fetchRaw(request.cropId, request.scope, window);
    const totalObservations = await this.repo.countTotalObservations(request.cropId, request.scope);

    const sourceRecordsWereSorted = isChronologicallySorted(rawRows);
    const { valid, missingCount, invalidNegativeCount } = partitionValidity(rawRows);
    const { entries, duplicateGroupCount } = collapseByMandiDay(valid);

    const unsortedObservations =
      request.scope.type === "MANDI"
        ? toMandiObservations(entries, request.scope)
        : aggregateAcrossMandisByDate(entries, request.scope);

    const flagged = PRICE_FORECAST_CONFIG.OUTLIER_DETECTION_ENABLED
      ? flagOutliers(unsortedObservations, PRICE_FORECAST_CONFIG.OUTLIER_METHOD)
      : unsortedObservations.map((o) => ({ ...o, isOutlier: false }));
    const observations = sortObservationsByDate(flagged);

    const gapMetadata = computeGapAnalysis(observations, window.start, window.end);
    const outlierCount = observations.reduce((count, o) => count + (o.isOutlier ? 1 : 0), 0);

    const { sufficient, insufficiencyReasons } = this.evaluateSufficiency({
      totalObservations,
      observationsInWindow: rawRows.length,
      usableObservationCount: observations.length,
      rawRowCount: rawRows.length,
      horizonDays,
      coverageRatio: gapMetadata.coverageRatio,
      largestGapDays: gapMetadata.largestGapDays,
    });

    const dataQualityFlags = assessDataQuality({
      rawRecordCount: rawRows.length,
      missingCount,
      invalidNegativeCount,
      duplicateGroupCount,
      usableObservationCount: observations.length,
      sourceRecordsWereSorted,
      gapMetadata,
    });

    return {
      cropId: request.cropId,
      scope: request.scope,
      canonicalPriceSource: "MODAL_PRICE",
      windowStartDate: window.start,
      windowEndDate: window.end,
      observations,
      metadata: { ...gapMetadata, outlierCount },
      dataQuality: {
        flags: dataQualityFlags,
        rawRecordCount: rawRows.length,
        missingPriceCount: missingCount,
        invalidNegativePriceCount: invalidNegativeCount,
        duplicateGroupCount,
        sourceRecordsWereSorted,
      },
      sufficient,
      insufficiencyReasons,
    };
  }

  /** Resolves startDate/endDate against PRICE_FORECAST_CONFIG's default
   *  and maximum window sizes. A caller-supplied window wider than
   *  MAX_HISTORY_WINDOW_DAYS is silently clamped at the start, not
   *  rejected — the same "bounded regardless of what's asked for"
   *  guarantee PriceForecastRepository's MAX_LIST_RESULTS documents for
   *  list queries. An inverted window (startDate after endDate) is a
   *  caller bug, not something to clamp around, so that is rejected. */
  private resolveWindow(request: PriceHistoryRequest): HistoryWindow {
    const end = startOfDayUTC(request.endDate ?? new Date());
    const requestedStart = request.startDate
      ? startOfDayUTC(request.startDate)
      : addDaysUTC(end, -(PRICE_FORECAST_CONFIG.DEFAULT_HISTORY_WINDOW_DAYS - 1));

    if (requestedStart.getTime() > end.getTime()) {
      throw new ValidationError("startDate must not be after endDate.");
    }

    const earliestAllowedStart = addDaysUTC(end, -(PRICE_FORECAST_CONFIG.MAX_HISTORY_WINDOW_DAYS - 1));
    const start = requestedStart.getTime() < earliestAllowedStart.getTime() ? earliestAllowedStart : requestedStart;
    return { start, end };
  }

  private fetchRaw(cropId: string, scope: ForecastScope, window: HistoryWindow): Promise<RawPriceRow[]> {
    switch (scope.type) {
      case "MANDI":
        return this.repo.mandiHistory(cropId, scope.mandiId, window);
      case "REGIONAL":
        return this.repo.regionalHistory(cropId, scope.state, scope.district, window);
      case "CROP_WIDE":
        return this.repo.cropWideHistory(cropId, window);
    }
  }

  /** Combines Module 7 Part 1's checkDataSufficiency() (reused, not
   *  duplicated) with the two coverage/gap checks this part adds — both
   *  reason sets are collected together rather than short-circuited, the
   *  same "report every applicable reason" philosophy Part 1 documents. */
  private evaluateSufficiency(input: {
    totalObservations: number;
    observationsInWindow: number;
    usableObservationCount: number;
    rawRowCount: number;
    horizonDays: ForecastHorizon;
    coverageRatio: number;
    largestGapDays: number;
  }): { sufficient: boolean; insufficiencyReasons: PreparationInsufficiencyReason[] } {
    const base = checkDataSufficiency({
      totalObservations: input.totalObservations,
      observationsInWindow: input.observationsInWindow,
      horizonDays: input.horizonDays,
    });

    const extra: PreparationInsufficiencyReason[] = [];
    // Raw rows existed in the window but none were usable (all missing or
    // invalid) — distinct from "no rows at all," which base already covers
    // via NO_HISTORICAL_DATA / SPARSE_DATA_IN_WINDOW.
    if (input.usableObservationCount === 0 && input.rawRowCount > 0) extra.push("NO_USABLE_OBSERVATIONS");
    if (input.usableObservationCount > 0 && input.coverageRatio < PRICE_FORECAST_CONFIG.MIN_COVERAGE_RATIO) {
      extra.push("COVERAGE_BELOW_MINIMUM");
    }
    if (input.largestGapDays > PRICE_FORECAST_CONFIG.MAX_ACCEPTABLE_GAP_DAYS) extra.push("GAP_EXCEEDS_MAXIMUM");

    const insufficiencyReasons: PreparationInsufficiencyReason[] = [...base.reasons, ...extra];
    return { sufficient: insufficiencyReasons.length === 0, insufficiencyReasons };
  }
}
