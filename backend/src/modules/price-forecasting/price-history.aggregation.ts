// Pure, independently-testable transformations for Module 7 Part 2.
//
// Nothing in this file does I/O. PriceHistoryRepository only ever fetches
// raw rows; every sort, dedup, aggregation, median, gap, coverage, and
// outlier calculation lives here instead, per the build spec's "keep these
// operations pure" requirement. PriceHistoryPreparationService is the only
// caller — it orchestrates these functions but contains no transformation
// logic of its own.
import { median, round } from "../market-intelligence/analytics";
import { ForecastScope } from "./price-forecasting.types";
import { PRICE_FORECAST_CONFIG } from "./price-forecasting.config";
import {
  DataQualityFlag,
  MandiDayPrice,
  PreparedPriceObservation,
  PriceHistoryGapMetadata,
  RawPriceRow,
  ValidPriceRow,
} from "./price-history.types";

const MS_PER_DAY = 86_400_000;

// ── Date helpers ─────────────────────────────────────────────────────────
// MandiPrice.observedDate is a Prisma `@db.Date` column — Prisma returns
// these as UTC-midnight `Date` objects, so every calculation here works in
// UTC calendar days rather than local time (avoids DST/timezone drift
// turning "one day apart" into a fractional-day difference).

export function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDaysUTC(date: Date, days: number): Date {
  const d = startOfDayUTC(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Whole calendar days from `a` to `b` (can be negative). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDayUTC(b).getTime() - startOfDayUTC(a).getTime()) / MS_PER_DAY);
}

/** Inclusive day count of the span [a, b], e.g. same day -> 1. */
export function diffDaysInclusive(a: Date, b: Date): number {
  return diffDays(a, b) + 1;
}

function dateKey(d: Date): string {
  return startOfDayUTC(d).toISOString().slice(0, 10);
}

// ── Canonical price validity ────────────────────────────────────────────
// Section 3 of the build spec: use modal price only, never silently mix in
// min/max, and treat a missing/invalid modal price as unusable rather than
// inventing a fallback. MandiPrice.modalPrice is a required Decimal column
// today, so there is no documented source-data convention for a fallback
// to derive it from min/max — this guard exists for defense (a null value
// slipping through a future schema change) and to reject non-positive
// values, not to implement a fallback rule.

export function isUsableModalPrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export interface ValidityPartition {
  valid: ValidPriceRow[];
  missingCount: number;
  invalidNegativeCount: number;
}

export function partitionValidity(rows: RawPriceRow[]): ValidityPartition {
  const valid: ValidPriceRow[] = [];
  let missingCount = 0;
  let invalidNegativeCount = 0;
  for (const row of rows) {
    if (row.modalPrice === null || row.modalPrice === undefined) {
      missingCount++;
      continue;
    }
    if (!isUsableModalPrice(row.modalPrice)) {
      invalidNegativeCount++;
      continue;
    }
    valid.push({ mandiId: row.mandiId, observedDate: row.observedDate, modalPrice: row.modalPrice });
  }
  return { valid, missingCount, invalidNegativeCount };
}

// ── Sorting ──────────────────────────────────────────────────────────────

/** Informational only — checks whether raw rows, as the repository
 *  returned them, already arrived in ascending observedDate order. This
 *  module never depends on repository ordering for correctness. */
export function isChronologicallySorted(rows: { observedDate: Date }[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].observedDate.getTime() < rows[i - 1].observedDate.getTime()) return false;
  }
  return true;
}

export function sortObservationsByDate(observations: PreparedPriceObservation[]): PreparedPriceObservation[] {
  return [...observations].sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ── Daily aggregation ────────────────────────────────────────────────────

export interface MandiDayCollapse {
  entries: MandiDayPrice[];
  duplicateGroupCount: number;
}

/**
 * Collapses possibly-multiple same-mandi, same-day MandiPrice rows (e.g.
 * more than one `source`) into one canonical price per (mandi, date) —
 * median of the contributing modal prices, per the build spec's "use
 * median rather than average ... mandi price distributions may contain
 * outliers" guidance, applied here at the finest available grain rather
 * than only across mandis. This is the shared first step for every scope:
 * for MANDI scope its output *is* the prepared series (mapped 1:1 by
 * toMandiObservations); for REGIONAL/CROP_WIDE it is the input to a second
 * aggregation pass across mandis (aggregateAcrossMandisByDate) so that a
 * single mandi with several source rows on one day cannot outweigh other
 * mandis in the regional median.
 */
export function collapseByMandiDay(rows: ValidPriceRow[]): MandiDayCollapse {
  const groups = new Map<string, { mandiId: string; date: Date; prices: number[] }>();
  for (const row of rows) {
    const key = `${row.mandiId}:${dateKey(row.observedDate)}`;
    const existing = groups.get(key);
    if (existing) existing.prices.push(row.modalPrice);
    else groups.set(key, { mandiId: row.mandiId, date: startOfDayUTC(row.observedDate), prices: [row.modalPrice] });
  }

  let duplicateGroupCount = 0;
  const entries: MandiDayPrice[] = [];
  for (const group of groups.values()) {
    if (group.prices.length > 1) duplicateGroupCount++;
    const price = medianOf(group.prices);
    entries.push({ mandiId: group.mandiId, date: group.date, price, sourceRecordCount: group.prices.length });
  }
  return { entries, duplicateGroupCount };
}

/** MANDI scope: one mandi, so collapseByMandiDay's output already is the
 *  final per-date series — map it 1:1 into PreparedPriceObservation. */
export function toMandiObservations(entries: MandiDayPrice[], scope: ForecastScope): PreparedPriceObservation[] {
  return entries.map((entry) => ({
    date: entry.date,
    price: entry.price,
    observationCount: entry.sourceRecordCount,
    sourceScope: scope,
    isOutlier: false,
  }));
}

/** REGIONAL/CROP_WIDE scope: aggregates the already-per-mandi-collapsed
 *  entries across mandis by date — daily median across available mandi
 *  prices, per the build spec. `observationCount` is the number of
 *  distinct mandis that reported a price that day. */
export function aggregateAcrossMandisByDate(entries: MandiDayPrice[], scope: ForecastScope): PreparedPriceObservation[] {
  const byDate = new Map<string, number[]>();
  for (const entry of entries) {
    const key = dateKey(entry.date);
    const list = byDate.get(key);
    if (list) list.push(entry.price);
    else byDate.set(key, [entry.price]);
  }

  const observations: PreparedPriceObservation[] = [];
  for (const [key, prices] of byDate.entries()) {
    observations.push({
      date: new Date(`${key}T00:00:00.000Z`),
      price: medianOf(prices),
      observationCount: prices.length,
      sourceScope: scope,
      isOutlier: false,
    });
  }
  return observations;
}

function medianOf(prices: number[]): number {
  if (prices.length === 1) return prices[0];
  const m = median(prices);
  // median() only returns null for an empty array; every group here has
  // at least one price by construction, so this branch is unreachable in
  // practice — kept as a defensive fallback rather than a non-null
  // assertion so strict-null-checks has something real to satisfy.
  return m === null ? prices[0] : round(m);
}

// ── Gap analysis ─────────────────────────────────────────────────────────

/**
 * Deterministic gap/coverage metadata for a prepared, sorted, one-per-date
 * observation series, relative to the *requested* window (not just the
 * span between the first and last observation) — a series that stops well
 * before windowEnd is a real gap for forecasting-confidence purposes, not
 * just "no data after the last point." Does not fill or interpolate
 * anything; every value here describes what is missing, never invents it.
 */
export function computeGapAnalysis(
  observations: PreparedPriceObservation[],
  windowStart: Date,
  windowEnd: Date,
): PriceHistoryGapMetadata {
  const start = startOfDayUTC(windowStart);
  const end = startOfDayUTC(windowEnd);
  const totalCalendarDays = Math.max(diffDaysInclusive(start, end), 0);

  if (observations.length === 0) {
    return {
      firstObservationDate: null,
      lastObservationDate: null,
      totalCalendarDays,
      observedDays: 0,
      missingDays: totalCalendarDays,
      coverageRatio: 0,
      largestGapDays: totalCalendarDays,
    };
  }

  // Assumed sorted ascending and unique-per-date by construction (the
  // service always calls this after sortObservationsByDate on aggregated
  // output) — re-sorting here as well costs nothing and makes this
  // function safe to call standalone in tests.
  const sorted = sortObservationsByDate(observations);
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const observedDays = sorted.length;
  const missingDays = Math.max(totalCalendarDays - observedDays, 0);
  const coverageRatio = totalCalendarDays > 0 ? round(observedDays / totalCalendarDays, 4) : 0;

  const gaps: number[] = [];
  const leadingGap = diffDays(start, first);
  if (leadingGap > 0) gaps.push(leadingGap);
  for (let i = 1; i < sorted.length; i++) {
    const gap = diffDays(sorted[i - 1].date, sorted[i].date) - 1;
    if (gap > 0) gaps.push(gap);
  }
  const trailingGap = diffDays(last, end);
  if (trailingGap > 0) gaps.push(trailingGap);

  return {
    firstObservationDate: first,
    lastObservationDate: last,
    totalCalendarDays,
    observedDays,
    missingDays,
    coverageRatio,
    largestGapDays: gaps.length ? Math.max(...gaps) : 0,
  };
}

// ── Outlier flagging (metadata only — see module doc) ───────────────────

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 1) return sortedAscending[0];
  const idx = (sortedAscending.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedAscending[lower];
  return sortedAscending[lower] + (sortedAscending[upper] - sortedAscending[lower]) * (idx - lower);
}

/** Tukey-fence IQR method: flags points outside
 *  [Q1 - multiplier*IQR, Q3 + multiplier*IQR]. */
export function flagOutliersIQR(
  observations: PreparedPriceObservation[],
  multiplier: number = PRICE_FORECAST_CONFIG.OUTLIER_IQR_MULTIPLIER,
): PreparedPriceObservation[] {
  if (observations.length < PRICE_FORECAST_CONFIG.OUTLIER_MIN_SAMPLE_SIZE) {
    return observations.map((o) => ({ ...o, isOutlier: false }));
  }
  const prices = observations.map((o) => o.price).sort((a, b) => a - b);
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - multiplier * iqr;
  const upperFence = q3 + multiplier * iqr;
  return observations.map((o) => ({ ...o, isOutlier: o.price < lowerFence || o.price > upperFence }));
}

/** Median Absolute Deviation method (modified z-score, Iglewicz & Hoaglin
 *  1993): flags points whose modified z-score exceeds `threshold`. More
 *  robust than IQR on very small or heavily-skewed samples. */
export function flagOutliersMAD(
  observations: PreparedPriceObservation[],
  threshold: number = PRICE_FORECAST_CONFIG.OUTLIER_MAD_THRESHOLD,
): PreparedPriceObservation[] {
  if (observations.length < PRICE_FORECAST_CONFIG.OUTLIER_MIN_SAMPLE_SIZE) {
    return observations.map((o) => ({ ...o, isOutlier: false }));
  }
  const prices = observations.map((o) => o.price);
  const centre = median(prices) ?? 0;
  const deviations = prices.map((p) => Math.abs(p - centre));
  const mad = median(deviations) ?? 0;
  if (mad === 0) {
    // Every price identical (or all-but-ties) — nothing to flag, and
    // dividing by a zero MAD would otherwise produce Infinity/NaN scores.
    return observations.map((o) => ({ ...o, isOutlier: false }));
  }
  return observations.map((o) => ({
    ...o,
    isOutlier: Math.abs((0.6745 * (o.price - centre)) / mad) > threshold,
  }));
}

export function flagOutliers(
  observations: PreparedPriceObservation[],
  method: "IQR" | "MAD",
): PreparedPriceObservation[] {
  return method === "MAD" ? flagOutliersMAD(observations) : flagOutliersIQR(observations);
}

// ── Data quality assessment ──────────────────────────────────────────────

export interface DataQualityInput {
  rawRecordCount: number;
  missingCount: number;
  invalidNegativeCount: number;
  duplicateGroupCount: number;
  usableObservationCount: number;
  sourceRecordsWereSorted: boolean;
  gapMetadata: PriceHistoryGapMetadata;
}

/** Section 6 of the build spec: detects (never fabricates a fix for) every
 *  listed data-quality concern. Purely informational — does not gate
 *  `sufficient`/`insufficiencyReasons`, which come from
 *  checkDataSufficiency() plus the two coverage/gap checks the service
 *  layer adds explicitly. */
export function assessDataQuality(input: DataQualityInput): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];
  if (input.rawRecordCount === 0 || input.usableObservationCount === 0) flags.push("NO_OBSERVATIONS");
  if (input.duplicateGroupCount > 0) flags.push("DUPLICATE_SOURCE_RECORDS");
  if (input.missingCount > 0) flags.push("MISSING_PRICE_VALUES");
  if (input.invalidNegativeCount > 0) flags.push("INVALID_NEGATIVE_PRICES");
  if (!input.sourceRecordsWereSorted) flags.push("UNSORTED_SOURCE_RECORDS");
  if (input.usableObservationCount > 0 && input.gapMetadata.coverageRatio < PRICE_FORECAST_CONFIG.MIN_COVERAGE_RATIO) {
    flags.push("SPARSE_HISTORY");
  }
  if (input.gapMetadata.largestGapDays > PRICE_FORECAST_CONFIG.MAX_ACCEPTABLE_GAP_DAYS) flags.push("LARGE_GAPS");
  if (input.usableObservationCount < PRICE_FORECAST_CONFIG.MIN_OBSERVATIONS_IN_WINDOW) flags.push("INSUFFICIENT_OBSERVATIONS");
  return flags;
}
