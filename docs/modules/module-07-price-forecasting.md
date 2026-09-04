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
| 3 | Deterministic baseline forecasting algorithm | Done |
| 4 | Application orchestration (crop/mandi resolution, idempotent generation, retrieval) | Done |
| 5 | REST API (routes, RBAC, validation, DTOs, Swagger) | Done |
| 6 | Observability, caching, testing, production hardening (this document) | Done |
| 7+ | Scheduled/background generation, Sell vs Store integration | Not implemented |

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

Parts 4-6 later made two small, purely additive changes here (no existing
behavior changed): `BaselineForecastMetadata` gained a `coverageRatio`
field (Part 2's own value, already computed for confidence, now also
persisted so the API layer can report data coverage without recomputing
anything), and `PRICE_FORECAST_CONFIG` gained `HIGH_CONFIDENCE_THRESHOLD`
(0.7) for the API's confidence-level display banding — see Part 5.

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

## Part 4 — Application orchestration layer

`price-forecasting.service.ts`'s `PriceForecastingService` is the
application-boundary layer connecting everything Parts 1-3 already built.
It deliberately does **not** re-implement history preparation, sufficiency
checking, the forecasting algorithm, or the GENERATING→COMPLETED/FAILED/
INSUFFICIENT_DATA persistence lifecycle — all of that already existed
(`PriceHistoryPreparationService`, `BaselineForecastEngine`,
`PriceForecastGenerationService`) before this part started. What this part
adds is everything that only makes sense at the application boundary:

- **Crop/mandi existence validation.** `requireCrop`/`resolveScope` look up
  the crop and (for a MANDI scope) the mandi via the *same*
  `MarketIntelligenceRepository` instance `app.ts` already shares with
  Module 8's `DecisionInputResolverService` — not a new query path.
  Missing either throws `MarketDomainError` with `CROP_NOT_FOUND` /
  `MANDI_NOT_FOUND` (404), reusing the exact error codes already defined in
  `common/errors.ts` and already used by Market Intelligence/Buyer
  Matching — no new error codes were added for this.
- **Public ↔ internal mandi ID translation.** A client-supplied `mandiId`
  is always `Mandi.publicId` (the DTO layer never exposes `Mandi.id`); this
  service resolves it to the internal id `ForecastScope`/`MandiPrice`
  actually key off, and translates back on the way out. List results batch
  this translation in one extra query (`resolveMandisBatch`) rather than
  one lookup per row, avoiding N+1.
- **Target date computation.** The API only asks for a `horizonDays`, not
  an explicit target date — this service computes
  `targetDate = today (UTC) + horizonDays`, which is what
  `PriceForecastGenerationService`/the DB's idempotency key
  (`cropId, scopeKey, targetDate, modelVersion`) actually operate on.
- **"Reuse an existing forecast" fast path.** Before calling
  `PriceForecastGenerationService.generateForecast()`, this service checks
  `PriceForecastRepository.findByDateRange()` for the exact same
  `(cropId, scope, targetDate)` already carrying a terminal (non-GENERATING)
  status under the current model version, and returns it directly if
  found. This is deliberately **not** a new source of truth for
  idempotency — the DB-level unique constraint / upsert
  (`createOrGetGeneratingForecast`, Part 1) already guarantees no duplicate
  row can ever be created for that tuple regardless of this check. The
  check exists so "reused" is observably distinct from "freshly generated"
  for analytics, and so a repeated request for an already-completed
  forecast doesn't even call `PriceHistoryPreparationService.prepare()`
  again.
- **Algorithm output validation.** `assertGeneratedForecastIsSane()`
  (`price-forecasting.dto.ts`) is a defense-in-depth check run against any
  freshly-COMPLETED forecast before it's returned: finite/non-negative
  `predictedPrice`, a well-ordered `[lowerBound, upperBound]` range, a
  confidence score within `[0, 1]`, and a persisted `horizonDays` matching
  what was actually requested. Part 3's pure math already makes every one
  of these true by construction (rounding, `Math.max(..., 0)` floors,
  clamped confidence) — this exists to turn a genuine future regression in
  that math into a loud, Sentry-captured failure instead of a silently
  bad prediction reaching a client.
- **DTO mapping, caching, analytics, and audit** — covered in their own
  sections below.

## Part 5 — REST API

### Endpoints

All under `/api/price-forecasting`, all requiring authentication plus one
of `FARMER` / `FPO_ADMIN` / `ADMIN` (`requireAnyRole`, the same middleware
Modules 6/8 use). There is no separate generate-vs-read permission split —
forecasts are crop/market-level analytical data with no per-resource
owner to layer an ownership check on top of, the same reasoning Market
Intelligence's own RBAC already follows.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/generate` | Generate a forecast, or transparently reuse an equivalent one that already exists. |
| GET | `/:forecastPublicId` | Retrieve a persisted forecast by its public ID. Never recomputes. |
| GET | `/crops/:cropId` | List forecasts for a crop (bounded, most-recent-first; `scopeType`/`mandiId`/`startDate`/`endDate`/`limit` filters). |
| GET | `/crops/:cropId/latest` | Retrieve the latest valid (`COMPLETED`, unexpired) forecast for a crop + scope. Defaults to `CROP_WIDE` when no scope query params are given. |

Full request/response schemas are registered in Swagger under the
**Price Forecasting** tag (see `price-forecasting.routes.ts`'s `@openapi`
blocks) — this section covers the design decisions, not a schema
duplicate.

### Scope validation

`scope` (in the POST body) and the `scopeType`/`mandiId`/`state`/`district`
query parameters (on the two GET-with-scope endpoints) are validated as a
**strict Zod discriminated union** on `type` — MANDI requires `mandiId`
and accepts nothing else; REGIONAL requires `state` (optionally
`district`) and accepts nothing else; CROP_WIDE accepts no other field at
all. An invalid combination (e.g. a `mandiId` alongside `CROP_WIDE`, a
REGIONAL scope missing `state`) is rejected as a `400 VALIDATION_ERROR`
by the schema itself, before any handler code runs — this is why no
`INVALID_FORECAST_SCOPE` domain error code exists; the existing
`ValidationError`/Zod pipeline already covers it.

### Horizon validation

`horizonDays` is validated against
`PRICE_FORECAST_CONFIG.MAX_HORIZON_DAYS` directly in the Zod schema (not a
second, hand-maintained copy of that number) — a horizon over the limit is
rejected as a `400` before any history is read. This is in addition to
(not a replacement for) Part 1's own `HORIZON_EXCEEDS_LIMIT` sufficiency
check inside `checkDataSufficiency`, which remains the defense-in-depth
backstop for any non-HTTP caller of `PriceForecastGenerationService`
directly.

### Errors

No new error codes were introduced beyond what already existed:

| Situation | Error | Why no new code |
| --- | --- | --- |
| Crop doesn't exist | `MarketDomainError("CROP_NOT_FOUND", 404)` | Already defined and used by Market Intelligence/Buyer Matching. |
| Mandi doesn't exist | `MarketDomainError("MANDI_NOT_FOUND", 404)` | Same. |
| Forecast public ID doesn't exist | `NotFoundError` (`NOT_FOUND`, 404) | Same generic 404 every other module uses for "this specific resource doesn't exist" (e.g. Sell vs Store's `NotFoundError("Decision not found.")`). |
| Invalid scope/horizon/body shape | `ValidationError` (400) via Zod | Already the standard validation pipeline. |
| Unexpected failure (DB error, etc.) | Generic `UNEXPECTED_ERROR` (500) via the centralized error handler | Already captures to Sentry and returns a safe message; no bespoke `FORECAST_GENERATION_FAILED` code was needed. |

`INSUFFICIENT_DATA` is **never** an error — it's a normal
`status: "INSUFFICIENT_DATA"` value in a `200` response body, exactly per
the build spec's "should not automatically become HTTP 500."

### Response shape

Every response uses the project's existing envelope
(`{ success, data, message }` via `sendSuccess`/`sendError`, never a new
envelope shape). `data` is a `ForecastResponseDTO`
(`price-forecasting.dto.ts`) — never a raw Prisma row, never a raw
`Decimal`. One deliberate deviation from the build spec's own example
response: the example's `predictions: [...]` (plural, an array) is *not*
what this DTO returns. This algorithm produces exactly one point
prediction (with a bound range) per forecast, not a multi-day curve —
returning a single `prediction: { targetDate, predictedPrice, lowerBound,
upperBound } | null` object is the honest shape of what was actually
computed, rather than wrapping a single value in an array to match an
example literally. `prediction`/`confidence` are `null` whenever
`status !== "COMPLETED"` — never a fabricated value. `insufficiencyReasons`
is populated (non-empty) only when `status === "INSUFFICIENT_DATA"`.
`limitations` (a fixed, centralized list — not fabricated per request) and
`disclaimer` are present on every response regardless of status, per the
build spec's explicit "include a concise disclaimer" requirement.

`metadata.coverageRatio` and `metadata.historyFreshness` power the
"source data freshness"/"data coverage" fields the build spec asked for —
`coverageRatio` is Part 2's own value, threaded through Part 3's
persisted metadata (a small, additive change to `BaselineForecastMetadata`
— see Part 3 section above); freshness reuses Module 6's existing
`freshness()` classifier against the history's last observed date, rather
than inventing a second freshness scale.

`confidence.level` (`LOW`/`MEDIUM`/`HIGH`) is a presentation-layer banding
of Part 3's raw `0-1` score (`classifyConfidenceLevel`,
`price-forecasting.dto.ts`), using `MIN_CONFIDENCE_THRESHOLD` (already
defined in Part 1) as the LOW/MEDIUM boundary and a new
`HIGH_CONFIDENCE_THRESHOLD` (0.7) for MEDIUM/HIGH — never a gate on
whether a forecast is generated or persisted, purely a display
convenience.

## Part 6 — Observability, caching, and production hardening

### Redis caching

`price-forecasting.cache.ts` mirrors `market-intelligence/market-cache.ts`'s
own design exactly (version-keyed invalidation, SHA-256 digest cache keys,
short TTL, fully optional) rather than introducing a second caching
architecture:

- Only the two read paths that make sense to cache are cached:
  `findLatestForecast` and `listForecasts`. `generateForecast` is **never**
  cached — idempotency there is entirely the database's own upsert, and
  caching a generation result could serve a stale answer to "was this
  reused or freshly generated."
- Cache keys are built from every dimension the build spec asked for
  (crop, scope, mandi/region, horizon/filters) via a SHA-256 digest of the
  exact parameters used.
- A single global version key (`price-forecasting:version`) is
  incremented after every successful generation (`COMPLETED` or
  `INSUFFICIENT_DATA` — both change what "latest"/"list" should return),
  which invalidates every cached read at once. This is the same
  simplicity/precision trade-off `market-cache.ts` already makes for the
  same reason; a 120-second TTL keeps the blast radius of ever missing an
  invalidation small.
- If `getRedis()` returns `null` (Redis not configured) or any Redis call
  throws, every cache function degrades to "no cache" (a miss on read, a
  silent no-op on write) — a forecast read never fails because Redis is
  unavailable.

### PostHog analytics

New allow-listed events (`config/posthog.ts`'s `ALLOWED_EVENTS`, same
allow-list every other module's events go through —
`trackEvent()` silently no-ops on anything not listed):
`forecast_requested`, `forecast_generated`, `forecast_reused`,
`forecast_insufficient_data`, `forecast_failed`, `forecast_viewed`.
Generation-outcome events fire from `PriceForecastingService` (which
alone knows whether a result was reused vs. freshly computed);
`forecast_viewed` fires from the controller for the three read endpoints,
mirroring `sell-vs-store.controller.ts`'s own split between
service-level generation events and controller-level view events. No
event ever carries a predicted price, confidence score, or other model
output — only crop/scope/horizon identifiers and coarse outcome, the same
"no sensitive payloads" rule the rest of this allow-list already follows.

### Sentry

No new Sentry integration code was needed — the existing centralized
`errorHandler` (`middleware/errorHandler.ts`) already calls
`captureException` for any error that isn't a recognized `AppError`
subclass, with the request path/method as context. Every unexpected
failure in this module's generate/prepare/persist path already flows
through that same handler; `INSUFFICIENT_DATA` never reaches it at all
(it's a normal `200` response, not a thrown error), so it can never be
mistaken for a crash.

### Audit logging

One new `AuditAction`: `PRICE_FORECAST_GENERATED`
(`modules/audit/audit.service.ts`), recorded only when a **freshly
generated** forecast reaches `COMPLETED` — mirroring the exact
"one entry per persisted generation" convention
`MARKET_RECOMMENDATION_GENERATED`/`SELL_STORE_DECISION_GENERATED` already
follow. Reused forecasts, `INSUFFICIENT_DATA` outcomes, and every read
endpoint are **not** audited, per the build spec's explicit "do not audit
every forecast read."

### Swagger

All four endpoints are documented under a new **Price Forecasting** tag
(`@openapi` JSDoc blocks directly in `price-forecasting.routes.ts`,
registered the same way every other module's routes already are — no new
Swagger wiring). Request/response schemas, the MANDI/REGIONAL/CROP_WIDE
scope variants, validation rules, and the full set of expected HTTP
responses (200/400/401/403/404/422/500) are documented per endpoint,
including that `INSUFFICIENT_DATA` is a normal `200`, not a `4xx`/`5xx`.

### Environment configuration

**No new environment variables were added.** The cache TTL is a plain
constant in `price-forecasting.cache.ts` (matching
`market-cache.ts`'s own hardcoded TTL, not a new env var); the model
version, maximum horizon, and minimum-observations thresholds were all
already centralized in `PRICE_FORECAST_CONFIG` (Part 1/3) — Part 4-6 read
them, never duplicated them into a second configuration surface.

### Tests added

- `price-forecasting.dto.test.ts` — confidence-level banding, DTO mapping
  (prediction/confidence nulled for non-COMPLETED, disclaimer/limitations
  always present, mandi public-id-only exposure), and
  `assertGeneratedForecastIsSane`'s every failure mode.
- `price-forecasting.cache.test.ts` — hit/miss/invalidation with a fake
  Redis client, plus graceful degradation when `getRedis()` returns `null`
  and when Redis calls reject.
- `price-forecasting.service.test.ts` — crop/mandi validation and public↔
  internal ID resolution, all three scope types, `INSUFFICIENT_DATA`
  handled without throwing, `FAILED` rethrown with `forecast_failed`
  tracked, output-sanity rejection, audit/cache/analytics firing exactly
  once per generation, existing-forecast reuse (including a `GENERATING`
  row correctly *not* being treated as reusable, and a different model
  version correctly being ignored as a match), and every read method
  never touching the generation service.
- `price-forecasting.routes.test.ts` (integration, `supertest`) —
  authentication required; FARMER/FPO_ADMIN/ADMIN allowed, BUYER
  rejected (403); invalid scope combinations, missing required scope
  fields, and over-limit horizon all rejected as 400; unknown crop/mandi
  as 404 domain errors (not 500); a genuinely unexpected failure still
  surfacing as 500; `INSUFFICIENT_DATA` returned as a normal 200; and the
  response envelope shape across all four endpoints.

All new tests run against mocked services/repositories — no live database
or generated Prisma client required, matching every existing test in this
module.

### Regression verification

Module 6 (Market Intelligence), Module 7 Parts 1-3, and Module 8 (Sell vs
Store) test suites were re-run after these changes and are unaffected —
see Verification below for exact numbers.

## What is explicitly NOT implemented

- No LLM/AI forecasting (no Gemini, OpenAI, Claude/ChatGPT APIs, or any
  external black-box forecasting provider)
- No ARIMA, Prophet, TensorFlow/PyTorch, or any general-purpose
  statistical/ML forecasting library
- No interpolation or fabrication of missing historical days, or of a
  forecast's predicted value when data is insufficient
- No scheduled/background forecast generation jobs (every forecast is
  generated on-demand via `POST /generate`)
- No changes to the Sell vs Store decision engine (Module 8) — it does
  not yet consume Module 7 forecasts, and none of its own files were
  modified
- No modification of `MandiPrice` records, and no duplication of Module 6's
  own analytics beyond the crop/mandi lookups this module explicitly
  reuses
- No frontend changes
- No new environment variables
- No new Prisma migrations — `AuditAction`'s new value needed none
  (`AuditLog.action` is a plain `String` column), and every other Part
  4-6 need was already satisfied by Part 1's existing `PriceForecast`
  model
- No automatic trading advice, autonomous selling recommendations,
  notifications, or transactions triggered by a forecast
- No new domain error codes — every situation Part 5 needed was already
  covered by an existing error code or the standard Zod validation
  pipeline (see the Errors table above)

## Known limitations / follow-ups for future parts

- `PriceForecastRepository` has no pagination contract for callers yet
  (same situation Module 8's `SellStoreDecisionRepository` documents) — the
  `take` cap is a defensive backstop, not a real pagination API. The list
  endpoint's `scopeType`/date-range filters are applied to that same
  bounded, most-recent-first result set (except the `mandiId` filter,
  which uses a dedicated indexed query) — a crop with many forecasts
  across many different mandis could have older matching rows fall
  outside the bound.
- `ForecastOutput` assumes a single-point prediction per (crop, scope,
  target date); a future part introducing e.g. multi-day forecast curves
  in one call would need a shape change here, and the API's `prediction`
  field (currently a single object, not the array the build spec's
  example sketched) would need to change accordingly.
- `PriceHistoryPreparationService` has no caching of its own — every
  generation call re-queries `MandiPrice`. Part 6's caching only covers
  *read* endpoints; a future part generating forecasts on a schedule will
  still want to cache/batch `prepare()` calls itself.
- Gap/coverage thresholds (`MIN_COVERAGE_RATIO`, `MAX_ACCEPTABLE_GAP_DAYS`)
  and the baseline algorithm's own thresholds (window size, damping
  half-lives, projection/uncertainty caps, and now also
  `HIGH_CONFIDENCE_THRESHOLD`) are the same for every crop and scope
  today and are deliberately conservative defaults, not yet tuned or
  backtested against real historical accuracy.
- The forecast-reuse cache's single global version key means *any*
  crop's successful generation invalidates *every* cached read across
  every crop — simple and correct, at the cost of a cache that resets
  more often than strictly necessary under heavy concurrent generation
  across many crops. A future part could scope invalidation per crop if
  this becomes a measured problem.
- `MIN_CONFIDENCE_THRESHOLD` (Part 1) still has no enforced consumer — the
  API surfaces `confidence.level` for a client to act on, but nothing
  server-side currently refuses to return a low-confidence forecast. This
  remains intentional (a forecast is always returned honestly, confidence
  and all) rather than an oversight.
- A future part integrating with Module 8 (Sell vs Store) would consume
  `findLatestForecast`/`GET /crops/:cropId/latest` rather than duplicating
  forecast-generation logic — Module 8 does not do this yet.
