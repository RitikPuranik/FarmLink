# Module 16 — Logistics Quote & Optimization

## Purpose

Given a lot needing transport, Module 16 lets FarmLink (a) produce its own
best-effort distance/duration/cost estimate without any provider involved,
(b) show which of Module 15's vehicles are actually eligible and why/why
not, (c) let transport providers submit competing quotes, and (d)
deterministically rank those quotes and recommend one — never using an LLM
for that ranking. It hands off a clean, minimal contract to Module 17
(Shipment & GPS Tracking) once a quote is accepted; it does not implement
tracking, GPS, or delivery reconciliation itself.

## Architecture

```
CropLot (Module 4)
      |
      v
LogisticsRequest ---- estimate() --> Haversine distance + LogisticsCostEstimator
      |
      +-- available-providers --> LogisticsVehicleDiscoveryRepository + VehicleEligibilityService
      |
      +-- quotes (LogisticsQuote[], one per provider/vehicle submission)
      |
      +-- optimize() --> LogisticsOptimizationEngine --> LogisticsOptimizationResult (persisted, one row per run)
      |
      +-- accept a quote --> atomic transaction (logistics-quote.repository.ts)
                              -> request.status = QUOTE_ACCEPTED
                              -> quote.status = ACCEPTED, competitors REJECTED
                              -> vehicle.availabilityStatus = RESERVED (best-effort)
                              -> Module 17 contract (below)
```

Every deterministic calculation lives in its own dependency-free class,
independent of Express/Prisma:

- `route-distance.provider.ts` — `RouteDistanceProvider` interface +
  `HaversineRouteDistanceProvider` (straight-line distance × a configurable
  road-distance multiplier; no third-party maps API required). A real
  routing provider can implement the same interface later without touching
  any caller.
- `logistics-cost-estimator.ts` — `LogisticsCostEstimator`: base + per-km +
  loading/unloading + toll estimate + refrigeration surcharge, floored at a
  configurable minimum trip cost. Every rate is env-configurable
  (`LOGISTICS_*` in `config/env.ts`) — nothing here is permanent business
  truth.
- `vehicle-eligibility.service.ts` — `VehicleEligibilityService`: pure
  function of a vehicle/provider/requirement triple, returns
  `{ eligible, reasons: [...] }`. Never silently excludes a vehicle.
- `logistics-quote-state-machine.ts` — the exact DRAFT → SUBMITTED →
  {WITHDRAWN, EXPIRED, ACCEPTED, REJECTED} machine, plus
  `isQuoteConsiderable()` (status + validUntil check together).
- `logistics-optimization.engine.ts` — `LogisticsOptimizationEngine`: a
  weighted, 0–100-normalized score over price/distance/time/capacity
  fit/reliability. Deterministic ordering (score desc, then price asc,
  then quoteId asc) — the same input always produces the same ranking.
  `algorithmVersion = "v1"`.
- `provider-reliability.service.ts` — inspected Module 15 first; it tracks
  no trip outcomes or ratings today, so this always returns the documented
  neutral default (`score: 50, source: "DEFAULT"`), never a fabricated
  number. Swappable for a real implementation once Module 17/18/25 starts
  recording outcomes.

## Data model

Three new tables, all additive — no existing Module 15 model was touched
except adding the back-relation Prisma requires on both sides of a
relation (`TransporterProfile.logisticsQuotes`, `Vehicle.logisticsQuotes`,
`CropLot.logisticsRequests`, `Crop.logisticsRequests`,
`User.logisticsRequestsRaised`):

- `LogisticsRequest` — one per transport requirement. Hangs off `CropLot`
  (`lotId`) — there is no separate `Order` model in this codebase, so the
  build spec's own "reuse exact existing names" instruction points here.
  Carries its own pickup/destination location snapshot (district/state
  required, address/pincode/lat/lng optional) rather than joining through
  `CropLot` (which has no lat/lng) or any buyer-matching model — this
  keeps the module usable regardless of where the destination came from.
- `LogisticsQuote` — one per provider/vehicle submission against a
  request. `quotedAmount` is always kept distinct from
  `LogisticsRequest.estimatedCost` (FarmLink's own guess) and from
  whatever ends up `ACCEPTED` — three independently-inspectable numbers,
  never merged.
- `LogisticsOptimizationResult` — one immutable row per `optimize()` run
  (never overwritten), so a later recalculation never erases the
  explanation behind a recommendation a farmer may have already acted on.

## API

All mounted at `/api` (see `logistics-request.routes.ts` /
`logistics-quote.routes.ts` for full Swagger annotations):

```
POST   /logistics/requests                          FARMER/FPO_ADMIN/ADMIN
GET    /logistics/requests                           all roles (scoped per-role, see below)
GET    /logistics/requests/:publicId                  all roles (scoped)
PATCH  /logistics/requests/:publicId                  FARMER/FPO_ADMIN/ADMIN
POST   /logistics/requests/:publicId/calculate        FARMER/FPO_ADMIN/ADMIN
POST   /logistics/requests/:publicId/optimize         FARMER/FPO_ADMIN/ADMIN
POST   /logistics/requests/:publicId/cancel           FARMER/FPO_ADMIN/ADMIN
GET    /logistics/requests/:publicId/available-providers  FARMER/FPO_ADMIN/ADMIN
POST   /logistics/requests/:publicId/quotes            TRANSPORTER
GET    /logistics/requests/:publicId/quotes             all roles (scoped)
GET    /logistics/quotes/mine                          TRANSPORTER
GET    /logistics/quotes/:publicId                      all roles (scoped)
PATCH  /logistics/quotes/:publicId                      owning TRANSPORTER
POST   /logistics/quotes/:publicId/withdraw              owning TRANSPORTER
POST   /logistics/quotes/:publicId/accept                requester (FARMER/FPO_ADMIN/ADMIN)
POST   /logistics/quotes/:publicId/reject                requester (FARMER/FPO_ADMIN/ADMIN)
```

**Gap filled, not in the build spec's own route list:** the build spec
never specifies how a TRANSPORTER discovers requests worth quoting on.
`GET /logistics/requests` was extended so a TRANSPORTER caller always sees
every currently-`OPEN` request (any requester's own `status` filter is
ignored for that role) — this is the only reasonable interpretation that
makes `POST .../quotes` reachable at all without a manually-shared link.

**Visibility rules enforced in the service layer (not the router):** a
TRANSPORTER only ever sees their own quote's amount on a shared request —
never a competitor's (`LogisticsQuoteService.listQuotesForRequest` filters
by the caller's own `transportProviderId` server-side, not just in the
response shape).

## Optimization formula

```
finalScore = priceScore   * PRICE_WEIGHT        (default 0.40)
           + distanceScore * DISTANCE_WEIGHT     (default 0.10)
           + timeScore      * TIME_WEIGHT         (default 0.20)
           + capacityFitScore * CAPACITY_WEIGHT   (default 0.15)
           + reliabilityScore * RELIABILITY_WEIGHT (default 0.15)
```

- price/distance/time: normalized 0–100 across the candidate set, lower
  raw value → higher score (`normalizeInverse`).
- capacityFitScore: `min(100, requiredCapacityKg / vehicleCapacityKg * 100)`
  — an exact-fit vehicle scores 100; an oversized one is mildly penalized
  as inefficient for the job, never rewarded for excess capacity.
- reliabilityScore: passed straight through from
  `ProviderReliabilityService` (currently always the neutral default — see
  above); `reasons` includes `RELIABILITY_UNVERIFIED` whenever the score
  came from that default rather than real outcome data, so the UI/caller
  can never present it as earned trust.
- Weights are read from env and re-normalized to sum to 1 at request time
  (`getOptimizationWeights()`), so a misconfigured env can never silently
  skew the 0–100 scale even though the *relative* configured emphasis is
  preserved.

## Configuration (`backend/src/config/env.ts`)

`LOGISTICS_ROAD_DISTANCE_MULTIPLIER`, `LOGISTICS_AVERAGE_SPEED_KMPH`,
`LOGISTICS_BASE_COST_INR`, `LOGISTICS_RATE_PER_KM_INR`,
`LOGISTICS_MINIMUM_TRIP_COST_INR`, `LOGISTICS_LOADING_COST_INR`,
`LOGISTICS_UNLOADING_COST_INR`, `LOGISTICS_TOLL_ESTIMATE_PER_KM_INR`,
`LOGISTICS_REFRIGERATION_SURCHARGE_PERCENT`, `LOGISTICS_WEIGHT_PRICE`,
`LOGISTICS_WEIGHT_DISTANCE`, `LOGISTICS_WEIGHT_TIME`,
`LOGISTICS_WEIGHT_CAPACITY`, `LOGISTICS_WEIGHT_RELIABILITY`,
`LOGISTICS_DEFAULT_QUOTE_VALIDITY_HOURS`,
`LOGISTICS_ROUTE_CACHE_TTL_SECONDS`, `LOGISTICS_COST_CACHE_TTL_SECONDS`.
Every one has a documented development-only default — none is presented
as a permanent business truth.

## Caching (Step 14)

Only `.../calculate`'s own route estimate and cost breakdown are cached in
Redis (keyed by rounded lat/lng pairs + vehicle class + `algorithmVersion`,
TTL configurable). Every availability/eligibility check and the quote
acceptance transaction always hit the database directly — stale cache data
can never bypass either. Redis is optional everywhere in this codebase
(`getRedis()` returns `null` if unavailable); every cache read/write here
degrades to a live recalculation rather than an error.

## Concurrency (Step 8/11/15)

Quote acceptance runs as a single Prisma `$transaction`
(`PrismaLogisticsQuoteRepository.acceptQuoteTransaction`):
`LogisticsRequest.status` flips `OPEN → QUOTE_ACCEPTED` via a conditional
`updateMany` (0 rows updated ⇒ someone else already decided this request),
then the chosen quote flips `SUBMITTED → ACCEPTED` the same way, then every
other still-`SUBMITTED` quote on the request is closed to `REJECTED`. If
either conditional update loses its race, the whole transaction throws and
rolls back — two concurrent accept attempts against the same request can
never both succeed. See `tests/integration/logistics-quote-accept.db.test.ts`
(requires a live database — see `prisma/README-engines.md`).

## Explicit non-goals (per Step 24 of the build spec)

No blockchain, no LLM/AI route optimization, no real GPS, no payment
processing, no driver tracking, no live maps UI, no new microservices or
event bus, no duplicate transport/provider/vehicle model.

## Module 17 contract

Once a quote is `ACCEPTED`, Module 17 can read off
`LogisticsRequest.acceptedQuoteId` (→ `LogisticsQuote`) everything Step 23
of the build spec lists: `logisticsRequestId`, `acceptedQuoteId`,
`transportProviderId`, `vehicleId`, pickup/destination, quantity/crop,
`quotedAmount` (the agreed price), `estimatedDistanceKm`/
`estimatedDurationMinutes`, and `estimatedPickupTime` as the pickup
schedule. No shipment/tracking row is created here.

## Known limitations of this sandbox

Prisma engine binaries could not be fetched here (`binaries.prisma.sh` is
not in this sandbox's allowed network domains) — see
`prisma/README-engines.md`. The schema, every repository/service/
controller/route file, and the module doc above were written and (for the
five dependency-free deterministic engines) unit-tested for real; the
Prisma-typed layers, `tsc`, `prisma migrate`, and the DB-backed
concurrency/integration tests need `npm install && npx prisma generate &&
npx prisma migrate dev` on a machine with normal internet access before
they can run.
