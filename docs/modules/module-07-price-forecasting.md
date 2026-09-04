# Module 7 — Price Forecasting

## Purpose

Given a crop (optionally scoped to a specific mandi or region), predict a
future price and persist that prediction so it can be reused instead of
recomputed on every read. This is the foundation only: **this part does not
generate any forecasts.** It builds the data model, domain contracts, and
persistence layer that a future forecasting algorithm will be built on top
of.

## Parts status

| Part | Scope | Status |
| --- | --- | --- |
| 1 | Foundation & data model | Done |
| 2 | Historical data preparation | Done |
| 3 | Deterministic baseline forecasting algorithm (this document) | Done |
| 4+ | Scheduled generation, API endpoints, Sell vs Store integration | Not implemented |

## MandiPrice remains the authoritative historical source

Module 6's `MandiPrice` table is the only place historical price
observations live. `PriceForecast` never copies, snapshots, or duplicates
that data — it only records the *output* of a (future) forecasting run,
plus enough metadata (`inputDataStartDate`, `inputDataEndDate`,
`sampleCount`) to say what portion of `MandiPrice` history that output was
based on. No existing Module 6 table, column, or row is modified by this
part.

## Forecast scope design

A forecast always targets one crop, plus exactly one of three scopes:

- **`MANDI`** — a specific market (`mandiId` set)
- **`REGIONAL`** — a state, optionally narrowed to a district (`regionState`
  set, `regionDistrict` optional)
- **`CROP_WIDE`** — the crop everywhere

This is modeled as a discriminated union in application code
(`ForecastScope` in `price-forecasting.types.ts`) and as an explicit
`scopeType` enum column plus the `mandiId` / `regionState` / `regionDistrict`
columns in the `PriceForecast` table — `scopeType` is always stored
explicitly rather than only inferred from which columns are `null`, so
nothing has to reverse-engineer scope from null-checks.

### Idempotency and `scopeKey`

The build requirement is: a duplicate forecast for the same crop + mandi
scope + target date + model version must not create a conflicting second
row. A nullable `mandiId`/`regionState`/`regionDistrict` cannot enforce that
by itself — Postgres unique indexes treat `NULL` as distinct from `NULL`, so
two `CROP_WIDE` rows (`mandiId = NULL` for both) would not collide under a
naive unique constraint.

`scopeKey` is a deterministic, `NULL`-free string encoding of the scope
(`"MANDI:<mandiId>"`, `"REGIONAL:<state>:<district-or-*>"`, `"CROP_WIDE"`),
built by `price-forecasting.scope.ts`. The actual uniqueness constraint is:

```
@@unique([cropId, scopeKey, targetDate, modelVersion])
```

`PriceForecastRepository.createOrGetGeneratingForecast` upserts on this key:
a second call for an already-existing (crop, scope, target date, model
version) tuple returns the existing row untouched rather than creating a
duplicate.

## Forecast persistence model

`PriceForecast` (see `prisma/schema.prisma`) stores:

- Identity: `id`, `publicId`
- What it predicts: `cropId`, scope columns (above), `targetDate`,
  `horizonDays`
- The prediction: `predictedPrice`, `lowerBound`, `upperBound`,
  `confidenceScore` — all `Decimal`, matching `MandiPrice`'s INR/QTL
  convention (never `Float`, so downstream arithmetic never inherits
  floating-point rounding error)
- Provenance: `modelProvider`, `modelVersion`, `inputDataStartDate`,
  `inputDataEndDate`, `sampleCount`, `generatedAt`, `expiresAt`, `metadata`
  (sanitized/technical only, never a raw provider payload or PII)
- Lifecycle: `status` (`GENERATING` / `COMPLETED` / `FAILED` /
  `INSUFFICIENT_DATA`)

Indexes: `[cropId, targetDate]`, `[cropId, mandiId, targetDate]`, `[status]`,
`[expiresAt]`, plus the unique idempotency index above.

### Status design

`GENERATING` / `COMPLETED` / `FAILED` / `INSUFFICIENT_DATA` exist now so a
future async generation pipeline (background job, scheduled sync) has
somewhere to record in-progress and failed attempts, without this part
committing to any actual async infrastructure — forecasts are expected to
be generated synchronously when a future part adds the algorithm.

## Domain types

`src/modules/price-forecasting/price-forecasting.types.ts` defines the
application-layer contracts so nothing outside the repository has to touch
Prisma models or `Decimal` directly:

- `ForecastScope` — the discriminated union described above
- `ForecastHorizon` — a named type for "days ahead," validated against
  `PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS`
- `ForecastInput` — what a forecasting run would be asked to produce
  (crop, scope, target date, horizon, input window)
- `ForecastOutput` — `predictedPrice` / `lowerBound` / `upperBound`
- `ForecastConfidence` — `score` (0-1) + `sampleCount`, kept separate from
  `ForecastOutput` the same way Module 5's `QualityAssessment` keeps
  `qualityScore` and `confidenceScore` apart
- `ForecastModelMetadata` — provider/version/input window/generated/expiry
- `PersistedForecast` — the full read shape the repository returns

## Data sufficiency contract

`price-forecasting.sufficiency.ts` exports a pure function,
`checkDataSufficiency(input)`, with no I/O — callers resolve observation
counts (via `MandiPrice` queries, in a future part) and pass them in. It
returns every applicable reason, not just the first:

| Reason | Condition |
| --- | --- |
| `NO_HISTORICAL_DATA` | crop has zero historical `MandiPrice` observations |
| `INSUFFICIENT_TOTAL_OBSERVATIONS` | total observations below `PRICE_FORECAST_CONFIG.MIN_HISTORICAL_OBSERVATIONS` |
| `SPARSE_DATA_IN_WINDOW` | observations *within the requested input window* below `MIN_OBSERVATIONS_IN_WINDOW`, even if the total history is otherwise sufficient |
| `HORIZON_EXCEEDS_LIMIT` | requested horizon exceeds `MAX_HORIZON_DAYS` |

A future forecasting run is expected to call this before attempting
generation and, on any reason, persist the forecast with status
`INSUFFICIENT_DATA` via `PriceForecastRepository.markInsufficientData` —
never fabricate a prediction from data that doesn't support one.

## Configuration

`price-forecasting.config.ts` centralizes every threshold this part (and
future parts) need — minimum historical observations, minimum observations
in a window, default/max horizon, freshness duration, minimum confidence
threshold — so none of it is hardcoded inline in services. Values are
conservative defaults, not yet tuned against real data.

## Repository

`PriceForecastRepository` (`price-forecasting.repository.ts`):

- `createOrGetGeneratingForecast(input)` — idempotent create (see above)
- `completeForecast(id, { output, confidence, model })` — fills in the
  prediction and marks `COMPLETED`
- `failForecast(id, reasons)` — marks `FAILED` with recorded reasons
- `markInsufficientData(id, reasons)` — marks `INSUFFICIENT_DATA` with
  structured reasons
- `findByPublicId(publicId)`
- `findLatestValid(cropId, scope, asOf?)` — the newest `COMPLETED`,
  non-expired forecast for a crop + scope
- `listForCrop(cropId, options?)` / `listForCropAndMandi(cropId, mandiId, options?)`
  — bounded (`take` capped at 200, mirroring `SellStoreDecisionRepository`'s
  `MAX_HISTORY_RESULTS`), most-recent-target-date first
- `findByDateRange(cropId, scope, start, end)` — bounded, ascending by
  target date

All queries are indexed lookups; none loads unbounded history.

## Part 2 — Historical data preparation

Part 2 converts historical `MandiPrice` records into a clean, deterministic
time series that a *future* forecasting algorithm can consume. It does not
predict anything — it prepares trustworthy input for whatever eventually
does.

### MandiPrice stays the only source

Same rule as Part 1: `MandiPrice` is never copied, snapshotted, or
duplicated. `PriceHistoryRepository` (`price-history.repository.ts`) issues
one bounded, indexed query per scope directly against `MandiPrice` and
returns raw rows; nothing is written anywhere.

### Scope-specific retrieval

`PriceHistoryRepository` mirrors the three `ForecastScope` variants from
Part 1, each as a single joined query (never one query per mandi, never a
synthesized crop-mandi combination for a market that reported nothing):

- `mandiHistory(cropId, mandiId, window)` — **MANDI**: crop + one mandi
- `regionalHistory(cropId, state, district?, window)` — **REGIONAL**: crop +
  state, optionally narrowed to a district
- `cropWideHistory(cropId, window)` — **CROP_WIDE**: crop across every
  mandi that actually reported a price in the window

`countTotalObservations(cropId, scope)` additionally runs a `COUNT` query
(no row data transferred) for the same scope with no date bound — this is
what feeds `checkDataSufficiency`'s `totalObservations` without ever
loading unbounded history into the process.

### Canonical price value

Only `modalPrice` is used. Per the build requirement not to mix minimum,
maximum, and modal price into one value without an explicit rule, no
min/max fallback is implemented: `MandiPrice.modalPrice` is a required
`Decimal` column today, so there is no existing source-data convention to
derive a fallback from. `partitionValidity()`
(`price-history.aggregation.ts`) still guards defensively — a `null` value
(in case that column constraint ever changes) or a non-positive number is
treated as **unusable** and excluded, counted, and reported, never
silently defaulted to something else. `PreparedPriceHistory` exposes this
choice explicitly via `canonicalPriceSource: "MODAL_PRICE"`.

### Daily aggregation

Aggregation happens in two composable pure-function passes
(`price-history.aggregation.ts`), both reused across all three scopes:

1. **`collapseByMandiDay`** — collapses same-mandi, same-day rows (e.g.
   more than one `source`) into one canonical price per (mandi, date),
   using the **median** of the contributing modal prices. For **MANDI**
   scope, since there is only one mandi, this pass's output already *is*
   the final per-date series (`toMandiObservations` maps it through 1:1).
2. **`aggregateAcrossMandisByDate`** — for **REGIONAL**/**CROP_WIDE**
   scope only, takes the already-per-mandi-collapsed prices and aggregates
   them again across mandis by date, again using the **median**. Doing the
   per-mandi collapse first means a single mandi with several source
   records on one day cannot outweigh other mandis in the regional/
   crop-wide median.

Median (not average) is used at both levels, per the build requirement,
because mandi price distributions may contain outliers. Both functions are
pure and reuse `median`/`round` from
`market-intelligence/analytics.ts` — the same helper `buyer-matching` and
`sell-vs-store` already import from that module.

`observationCount` on a `PreparedPriceObservation` means: source-record
count for MANDI scope, reporting-mandi count for REGIONAL/CROP_WIDE scope
— in both cases, "how many independent readings support this date's
price."

### Gap handling — reported, never filled

`computeGapAnalysis` returns `firstObservationDate`, `lastObservationDate`,
`totalCalendarDays`, `observedDays`, `missingDays`, `coverageRatio`, and
`largestGapDays`, computed relative to the *requested* window (not just the
span between the first and last observation, so a series that stops well
before the window's end still counts as a gap). `largestGapDays` considers
both the gaps between observations and the leading/trailing gap against the
window boundary. No missing day is ever interpolated or fabricated — a
missing day stays missing and only shows up as gap metadata.

### No interpolation

Explicitly not implemented, per the build requirement. `observations`
contains exactly one point per date that had a usable `MandiPrice` record
— no synthetic points for missing days, no forward-fill, no smoothing.

### Outlier policy

`flagOutliersIQR`/`flagOutliersMAD` (config-selectable via
`PRICE_FORECAST_CONFIG.OUTLIER_METHOD`, default `"IQR"`) mark individual
`PreparedPriceObservation.isOutlier` — a conservative Tukey-fence or
median-absolute-deviation check. This is **metadata only**:

- No observation is ever removed, modified, or excluded from `observations`
  because of an outlier flag.
- Below `OUTLIER_MIN_SAMPLE_SIZE` observations, nothing is flagged — too
  few points to make quartiles/MAD meaningful.
- `PRICE_FORECAST_CONFIG.OUTLIER_DETECTION_ENABLED` can turn flagging off
  entirely; `metadata.outlierCount` is `0` in that case.
- A future forecasting part decides what, if anything, to do with a flag.

### Data sufficiency

`PriceHistoryPreparationService` calls Part 1's `checkDataSufficiency`
directly — it is not re-implemented — and extends its reason set with two
preparation-specific checks:

| Reason | Condition |
| --- | --- |
| *(all Part 1 reasons — see above)* | reused as-is |
| `NO_USABLE_OBSERVATIONS` | raw rows existed in the window, but every one was missing/invalid |
| `COVERAGE_BELOW_MINIMUM` | `coverageRatio` below `PRICE_FORECAST_CONFIG.MIN_COVERAGE_RATIO` |
| `GAP_EXCEEDS_MAXIMUM` | `largestGapDays` above `PRICE_FORECAST_CONFIG.MAX_ACCEPTABLE_GAP_DAYS` |

Every applicable reason is reported at once (same "not just the first"
philosophy as Part 1), and `sufficient` is `true` only when the combined
list is empty.

Separately, `dataQuality.flags` (`NO_OBSERVATIONS`,
`DUPLICATE_SOURCE_RECORDS`, `MISSING_PRICE_VALUES`,
`INVALID_NEGATIVE_PRICES`, `UNSORTED_SOURCE_RECORDS`, `SPARSE_HISTORY`,
`LARGE_GAPS`, `INSUFFICIENT_OBSERVATIONS`) is informational metadata
covering the full data-quality checklist from the build spec — it does not
gate `sufficient`, though several flags and reasons describe the same
underlying fact from two different angles (one for "can we forecast," one
for "what did we notice about the raw data").

### Configuration

`PRICE_FORECAST_CONFIG` gained: `DEFAULT_HISTORY_WINDOW_DAYS` (180),
`MAX_HISTORY_WINDOW_DAYS` (730, a hard ceiling — a caller-supplied wider
window is clamped, never used to issue an unbounded query),
`MIN_COVERAGE_RATIO` (0.5), `MAX_ACCEPTABLE_GAP_DAYS` (21),
`OUTLIER_DETECTION_ENABLED` (`true`), `OUTLIER_METHOD` (`"IQR"`),
`OUTLIER_IQR_MULTIPLIER` (1.5), `OUTLIER_MAD_THRESHOLD` (3.5), and
`OUTLIER_MIN_SAMPLE_SIZE` (5). All conservative defaults, not yet tuned
against real data — same caveat Part 1 documents for its own thresholds.

### Pipeline

`PriceHistoryPreparationService.prepare(request)` is the only entry point:

```text
resolve + clamp window
       ↓
repo.fetchRaw(scope)  +  repo.countTotalObservations(scope)
       ↓
partitionValidity            (exclude missing/invalid prices)
       ↓
collapseByMandiDay            (per-mandi-day median)
       ↓
toMandiObservations  |  aggregateAcrossMandisByDate   (scope-dependent)
       ↓
flagOutliers                  (metadata only, toggle-able)
       ↓
sortObservationsByDate
       ↓
computeGapAnalysis  +  checkDataSufficiency (Part 1) + extra reasons
       ↓
assessDataQuality
       ↓
PreparedPriceHistory
```

The repository only retrieves raw data; every sort, dedup, aggregation,
median, gap, coverage, and outlier calculation is a pure function in
`price-history.aggregation.ts`, independently tested with no mocked
database.

## Part 3 — Deterministic baseline forecasting algorithm

Part 3 turns Part 2's prepared, deterministic time series into an actual
price prediction — a transparent, explainable statistical baseline, never
an LLM, a general-purpose ML library, or a guarantee of future prices.
This is the first part of Module 7 that produces `PriceForecast` rows with
real `predictedPrice`/`lowerBound`/`upperBound` values rather than just
the `GENERATING` placeholder Part 1 leaves behind.

### What this is (and isn't)

The algorithm is:

- a **weighted moving average** of the most recent, usable observations
  (recent prices weighted more heavily than older ones), giving a
  **baseline price**;
- plus a **conservatively projected linear trend** (ordinary least
  squares over day-offsets, capped and damped so it can never
  extrapolate wildly), giving a **trend adjustment**;
- plus a **deterministic uncertainty range** derived from the same
  window's historical price dispersion, scaled by the forecast horizon.

It is explicitly **not** ARIMA, Prophet, a neural network, or any other
statistical/ML forecasting library, and **not** an LLM/AI provider
integration (no Gemini, OpenAI, or similar). Same input always produces
the same output — every step is a pure function with no randomness, no
external calls, and no hidden state.

### Files

| File | Role |
| --- | --- |
| `price-forecasting.math.ts` | Pure math only: `weightedMovingAverage`, `linearRegression`, `trendDirection`, `standardDeviation`, `trendDampingFactor`, `clampDailySlope`, `projectForecast`, `computeUncertaintyRange`. No I/O, no config lookups — every value a caller needs is passed in as a plain argument. |
| `price-forecasting.engine.types.ts` | The engine's own output contract (`BaselineForecastResult`, `BaselineForecastMetadata`) plus the `BASELINE_MODEL_PROVIDER`/`BASELINE_MODEL_VERSION` identity constants. |
| `price-forecasting.engine.ts` | `BaselineForecastEngine` — a pure, deterministic class (mirrors `DecisionEngineService`, Module 8) that combines the math functions above over a `PreparedPriceHistory` to produce a `BaselineForecastResult`. No I/O. |
| `price-forecast-generation.service.ts` | `PriceForecastGenerationService` — orchestration only (mirrors `SellStoreOrchestrationService`, Module 8): resolves history via `PriceHistoryPreparationService`, calls the engine, and persists the result through `PriceForecastRepository`'s existing lifecycle methods. |

### The algorithm, step by step

1. **Sufficiency gate.** The engine trusts `PreparedPriceHistory.sufficient`
   / `insufficiencyReasons` outright — it never re-derives or duplicates
   Part 1/2's sufficiency logic. `sufficient: false` (for *any* reason,
   including `HORIZON_EXCEEDS_LIMIT`) short-circuits straight to a
   structured `INSUFFICIENT_DATA` result.
2. **Outlier policy.** Part 2's `isOutlier` flags are statistically-flagged
   metadata only — nothing is ever removed from `PreparedPriceHistory`
   itself. The engine builds its own working set from them: exclude
   flagged outliers **when doing so still leaves at least
   `MIN_OBSERVATIONS_FOR_TREND` observations**; otherwise fall back to the
   full valid series (outliers included) rather than starve the model of
   data. This one policy decision feeds *every* downstream calculation —
   baseline, trend, and dispersion alike — so a forecast's uncertainty
   reflects the same evidence its point prediction was built from. The
   choice actually taken (`"EXCLUDED"` or `"INCLUDED_FALLBACK"`) is
   recorded in the persisted metadata.
3. **Recent window.** From that working set, the most recent
   `min(MOVING_AVERAGE_WINDOW_SIZE, available)` observations are selected
   — the shared basis for both the moving average and the trend, per the
   build spec's own step ordering.
4. **Baseline — weighted moving average.** `weightedMovingAverage` assigns
   rank-based weights (oldest = 1 ... newest = n, normalized by
   construction) rather than time-decay weights, so it stays correct on
   an irregularly-spaced series (Part 2 never fills gaps).
5. **Trend — OLS linear regression.** Only computed when the recent window
   has at least `MIN_OBSERVATIONS_FOR_TREND` points; below that, slope is
   treated as `0` (FLAT) rather than fitting a line through noise.
   Regression `x` is a **day-offset** from the window's first
   observation, not an array index, so the fitted slope is genuine
   "price change per calendar day" even with gaps in between.
   `trendDirection` classifies the slope UP/DOWN/FLAT relative to the
   baseline price, using `TREND_FLAT_THRESHOLD_RATIO` to keep tiny
   numerical noise from being reported as a signal.
6. **Conservative trend projection.** `projectForecast` applies three
   independent safeguards, in order, against unrealistic extrapolation:
   1. the raw daily slope is capped to `MAX_DAILY_TREND_ADJUSTMENT_RATIO`
      of the baseline price per day;
   2. the capped slope is **damped** by how long the horizon is
      (`trendDampingFactor`, a half-life curve — at
      `horizonDays === TREND_DAMPING_HALF_LIFE_DAYS` the daily
      contribution is already discounted by half) before being
      multiplied out over the full horizon — "the longer the horizon,
      the more conservative the projection becomes," per the build spec;
   3. the resulting total adjustment is capped to
      `MAX_PROJECTION_PERCENT` of the baseline, regardless of horizon.

      `predictedPrice` is never allowed to go non-positive; `trendAdjustment`
      is always reported as `predictedPrice − baselinePrice` (recomputed
      after any floor), so the two stay internally consistent even at
      that extreme.
7. **Uncertainty range.** `computeUncertaintyRange` derives a half-width
   from the recent window's own price dispersion (population standard
   deviation, `standardDeviation`), scaled by **√horizonDays** — the
   standard random-walk convention that variance grows linearly with time
   (so standard deviation grows with its square root). This is explainable
   without claiming a statistical confidence level the baseline model
   can't actually support. A configurable floor
   (`MIN_UNCERTAINTY_RATIO`) prevents a suspiciously narrow, falsely
   precise interval after an unusually stable run of prices.
   `lowerBound` is always clamped at `0`, and by construction
   `lowerBound <= predictedPrice <= upperBound` always holds.
8. **Confidence.** A bounded `[0, 1]` heuristic — not a calibrated
   probability — combining how much of the configured window was actually
   available, Part 2's own `coverageRatio` for the requested window, and a
   horizon-based decay (the same damping-curve shape as step 6, with its
   own independent half-life, `CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS`).
   `sampleCount` is the number of observations the recent window actually
   used.
9. **Rounding.** Every calculation above stays at full floating-point
   precision — nothing is rounded until this last step, where
   `predictedPrice`/`lowerBound`/`upperBound` and the metadata's numeric
   fields are rounded once, matching the existing
   `market-intelligence/analytics.ts` `round()` convention (never a new
   rounding helper).

### Forecast horizons

Horizon bounds are entirely Part 1's: `checkDataSufficiency` (called
inside `PriceHistoryPreparationService.prepare`) already rejects any
`horizonDays > PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS` via
`HORIZON_EXCEEDS_LIMIT`, and Part 3 adds no horizon logic of its own
beyond *using* the requested horizon in the damping/uncertainty-scaling
math above. Recommended short-term horizons (1/3/7/14/30 days) all work
via the existing `DEFAULT_HORIZON_DAYS`/`MAX_HORIZON_DAYS` configuration —
no new horizon enum or type was introduced.

### Explainability metadata

Every generated forecast's `ForecastModelMetadata.metadata` (the existing
sanitized `Json` column) is populated with a `BaselineForecastMetadata`
object: `algorithm` (`"WEIGHTED_MOVING_AVERAGE_TREND_V1"`),
`historicalObservationCount`, `historyStartDate`/`historyEndDate` (ISO
calendar-day strings — a `Json` column doesn't round-trip `Date`
objects), `baselinePrice`, `trendSlope`, `trendDirection`,
`trendAdjustment`, `uncertaintyMethod`
(`"HISTORICAL_STD_DEV_SQRT_HORIZON"`), `outlierCount`, `outlierPolicy`,
and a `configuration` snapshot of every threshold that shaped this
specific forecast — so a forecast is fully explainable later without
recomputing the algorithm or re-reading `MandiPrice`, and without
trusting that `PRICE_FORECAST_CONFIG`'s defaults haven't since been
retuned. No raw price arrays or other unnecessary data snapshots are
stored — only these aggregated, already-rounded numbers.

`modelProvider`/`modelVersion` are fixed constants
(`BASELINE_MODEL_PROVIDER = "FARMLINK_BASELINE_ENGINE"`,
`BASELINE_MODEL_VERSION = "WEIGHTED_MOVING_AVERAGE_TREND_V1"`) — a
distinct, versioned algorithm identity so a future, more advanced model
can be introduced under its own `modelVersion` without colliding with or
silently overwriting this baseline's forecasts (they share the same
`@@unique([cropId, scopeKey, targetDate, modelVersion])` idempotency key).

### Persistence lifecycle & idempotency

`PriceForecastGenerationService.generateForecast(input)`:

```text
repository.createOrGetGeneratingForecast(...)   (idempotent upsert, Part 1)
       ↓
row.status !== "GENERATING"?  → return the existing row as-is (no recompute)
       ↓ (status === "GENERATING")
preparation.prepare(...)                         (Part 2, unmodified)
       ↓
engine.generate(history, horizonDays)             (Part 3, pure)
       ↓
outcome === "INSUFFICIENT_DATA"?  → repository.markInsufficientData(...)
       ↓ (outcome === "GENERATED")
repository.completeForecast(...)
```

Anything unexpected thrown along the way (a database error, a thrown
`ValidationError` from an inverted history window, etc.) is caught once,
at the top level, and marks the pending record `FAILED` via
`repository.failForecast` before rethrowing — mirroring
`SellStoreOrchestrationService`'s own catch block. `INSUFFICIENT_DATA` is
never routed through this path: it is a normal, structured domain
outcome the engine returns, not an exception.

Idempotency is enforced entirely by the *existing* Part 1 repository
behavior (`createOrGetGeneratingForecast`'s upsert-on-conflict, keyed on
`cropId` + `scopeKey` + `targetDate` + `modelVersion`) — Part 3 adds no
new uniqueness logic. A repeated call for the same tuple that has already
reached a terminal status (`COMPLETED`, `FAILED`, or `INSUFFICIENT_DATA`)
short-circuits before `prepare()` or `generate()` ever run again.

### Outlier policy (summary)

See step 2 above for the full rationale. In one line: **exclude flagged
outliers from every calculation when enough non-outlier observations
remain (`>= MIN_OBSERVATIONS_FOR_TREND`), otherwise fall back to the full
valid series.** No observation is ever deleted, mutated, or hidden from
`PreparedPriceHistory` itself — this only decides which subset of it *one
forecast run* computes from.

### Configuration

`PRICE_FORECAST_CONFIG` gained: `MOVING_AVERAGE_WINDOW_SIZE` (14),
`MIN_OBSERVATIONS_FOR_TREND` (5), `TREND_FLAT_THRESHOLD_RATIO` (0.0005),
`MAX_DAILY_TREND_ADJUSTMENT_RATIO` (0.01), `TREND_DAMPING_HALF_LIFE_DAYS`
(7), `MAX_PROJECTION_PERCENT` (0.25), `UNCERTAINTY_MULTIPLIER` (1.5),
`MIN_UNCERTAINTY_RATIO` (0.02), and
`CONFIDENCE_HORIZON_DECAY_HALF_LIFE_DAYS` (14). All conservative defaults,
not yet tuned against real data — same caveat Parts 1 and 2 document for
their own thresholds.

### Tests

`price-forecasting.math.test.ts` (pure math — weighted average behavior,
regression under trending/flat/noisy data, damping/capping/projection
safeguards, uncertainty-range validity and horizon/volatility scaling),
`price-forecasting.engine.test.ts` (sufficient/insufficient history
handling, upward/downward/flat trend projection, outlier-policy branches,
determinism, metadata correctness), and
`price-forecast-generation.service.test.ts` (repository lifecycle
sequencing, INSUFFICIENT_DATA vs FAILED handling, idempotent generation)
— all against mocked repositories/services, no live database or generated
Prisma client required, matching this suite's existing convention.

## What is explicitly NOT implemented yet

- No LLM/AI forecasting (no Gemini, OpenAI, or any provider integration)
- No ARIMA, Prophet, TensorFlow/PyTorch, or any general-purpose
  statistical/ML forecasting library
- No interpolation or fabrication of missing historical days
- No scheduled/background forecast generation jobs
- No API endpoints or controller/routes for this module
- No changes to the Sell vs Store decision engine (Module 8)
- No modification of `MandiPrice` records
- No frontend changes
- No automatic trading advice — a forecast is a point prediction plus an
  explicit uncertainty range, never a guarantee

## Known limitations / follow-ups for future parts

- `PriceForecastRepository` has no pagination contract for callers yet
  (same situation Module 8's `SellStoreDecisionRepository` documents) — the
  `take` cap is a defensive backstop, not a real pagination API.
- `ForecastOutput` assumes a single-point prediction per (crop, scope,
  target date); a future part introducing e.g. multi-day forecast curves
  in one call would need a shape change here.
- `PriceHistoryPreparationService` has no caching of its own — every call
  re-queries `MandiPrice`. A future part generating forecasts on a schedule
  will likely want to cache or batch `prepare()` calls rather than call it
  once per crop/scope pair on every run.
- Gap/coverage thresholds (`MIN_COVERAGE_RATIO`, `MAX_ACCEPTABLE_GAP_DAYS`)
  are the same for every crop and scope today; some crops may have
  inherently sparser reporting than others, which a future part may need
  to account for with per-crop thresholds.
- The baseline algorithm's own thresholds (window size, damping
  half-lives, projection/uncertainty caps) are deliberately conservative
  defaults, not yet tuned or backtested against real historical accuracy
  — a future part evaluating forecast quality against actuals may want to
  retune these per-crop rather than globally.
- No API endpoints expose these forecasts yet (by design, this part is
  domain/service logic only) — a future part will need to add
  controllers/routes, at which point `MIN_CONFIDENCE_THRESHOLD` (Part 1)
  becomes relevant for deciding whether a low-confidence forecast should
  be surfaced as actionable.
