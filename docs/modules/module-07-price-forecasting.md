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
| 2 | Historical data preparation (this document) | Done |
| 3+ | Actual forecasting algorithm, scheduled generation, API endpoints, Sell vs Store integration | Not implemented |

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

## What is explicitly NOT implemented yet

- No forecasting algorithm (no moving average, regression, ARIMA, Prophet,
  or any statistical model)
- No LLM/AI forecasting (no Gemini, OpenAI, or any provider integration)
- No interpolation or fabrication of missing historical days
- No scheduled/background forecast generation jobs
- No API endpoints or controller/routes for this module
- No changes to the Sell vs Store decision engine (Module 8)
- No modification of `MandiPrice` records
- No frontend changes

## Known limitations / follow-ups for future parts

- `PriceForecastRepository` has no pagination contract for callers yet
  (same situation Module 8's `SellStoreDecisionRepository` documents) — the
  `take` cap is a defensive backstop, not a real pagination API.
- `ForecastInput`/`ForecastOutput` assume a single-point prediction per
  (crop, scope, target date); a future part introducing e.g. multi-day
  forecast curves in one call would need a shape change here.
- `PriceHistoryPreparationService` has no caching of its own — every call
  re-queries `MandiPrice`. A future part generating forecasts on a schedule
  will likely want to cache or batch `prepare()` calls rather than call it
  once per crop/scope pair on every run.
- Gap/coverage thresholds (`MIN_COVERAGE_RATIO`, `MAX_ACCEPTABLE_GAP_DAYS`)
  are the same for every crop and scope today; some crops may have
  inherently sparser reporting than others, which a future part may need
  to account for with per-crop thresholds.
