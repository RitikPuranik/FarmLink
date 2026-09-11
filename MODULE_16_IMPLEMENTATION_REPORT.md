# Module 16 — Logistics Quote & Optimization — Implementation Report

## Summary

Module 16 is fully implemented: schema, deterministic engines, repositories,
services, controllers, routes (with Swagger docs), audit/observability
wiring, and tests. Five deterministic engines and a full HTTP-layer
integration suite were **actually executed** in this sandbox (65 tests,
all passing) against real code — not just written. The Prisma-typed
repository/service layer could not be type-checked or run against a live
database here because `binaries.prisma.sh` (Prisma's engine CDN) is
outside this sandbox's allowed network domains — the exact same wall this
repository's own `prisma/README-engines.md` already documents from its
original build. See **Verification** and **Limitations** below for
exactly what was and wasn't confirmed, and what to run to close the gap.

## Files created

```
backend/src/modules/logistics/
  logistics.config.ts                        env-driven config (rates, weights, TTLs)
  route-distance.provider.ts                  RouteDistanceProvider + HaversineRouteDistanceProvider
  logistics-cost-estimator.ts                 LogisticsCostEstimator
  vehicle-eligibility.service.ts              VehicleEligibilityService
  logistics-quote-state-machine.ts            quote status transitions
  logistics-optimization.engine.ts            LogisticsOptimizationEngine
  provider-reliability.service.ts             ProviderReliabilityService (neutral default)
  logistics.types.ts                          Prisma row shapes + public DTOs
  logistics-request.repository.ts             LogisticsRequestRepository (+ Prisma impl)
  logistics-quote.repository.ts               LogisticsQuoteRepository (+ Prisma impl, atomic accept transaction)
  logistics-optimization-result.repository.ts persists one row per optimize() run
  logistics-vehicle-discovery.repository.ts   read-only Module 15 Vehicle/TransporterProfile query
  logistics.authorization.ts                  LogisticsAuthorizationService
  logistics-cache.ts                          Redis caching for route/cost estimates
  logistics.schemas.ts                        Zod request/response schemas
  logistics-request.service.ts                orchestration: create/get/list/update/cancel/calculate/optimize/available-providers
  logistics-quote.service.ts                  orchestration: submit/update/withdraw/accept/reject/list
  logistics-request.controller.ts
  logistics-quote.controller.ts
  logistics-request.routes.ts                 + inline Swagger/OpenAPI docs
  logistics-quote.routes.ts                   + inline Swagger/OpenAPI docs

backend/tests/unit/
  logistics-route-distance.test.ts            9 tests — PASSING
  logistics-cost-estimator.test.ts             8 tests — PASSING
  logistics-vehicle-eligibility.test.ts       11 tests — PASSING
  logistics-quote-state-machine.test.ts       10 tests — PASSING
  logistics-optimization.engine.test.ts        9 tests — PASSING

backend/tests/integration/
  logistics.routes.test.ts                    18 tests — PASSING (mocked-repository, real routes/controllers/services)
  logistics-quote-accept.db.test.ts           5 tests — written, requires live DB (see Limitations)

docs/modules/module-16-logistics-quote-optimization.md   module doc
```

## Files modified (all additive)

- `backend/prisma/schema.prisma` — 2 new enums, 3 new models, additive
  back-relations on `TransporterProfile`, `Vehicle`, `CropLot`, `Crop`,
  `User` (Prisma requires both sides of a relation declared — nothing
  about those models' own behavior changed).
- `backend/src/common/errors.ts` — new `LogisticsDomainError` class + its
  error codes, following the exact pattern of `TransporterDomainError`/
  `NetRealizationDomainError`.
- `backend/src/modules/audit/audit.service.ts` — 10 new `AuditAction`
  values (`LOGISTICS_REQUEST_CREATED` … `LOGISTICS_QUOTE_REJECTED`).
- `backend/src/config/env.ts` — 16 new `LOGISTICS_*` env vars, all with
  documented development-only defaults.
- `backend/src/config/posthog.ts` — 6 new events added to the existing
  `ALLOWED_EVENTS` whitelist.
- `backend/src/app.ts` — Module 16 wired in immediately after Module 15,
  reusing the already-constructed `cropLotRepository`, `farmerProfileResolver`,
  `fpoAuthorization`, `vehicleRepository`, `transporterRepository`,
  `transporterAuthorizationService` instances rather than duplicating any
  of them.
- `backend/prisma/README-engines.md` — noted that Module 16 hit the same
  Prisma-engine-download wall and documented the same resolution path.

**Nothing in Module 15 (or any other module) was redesigned, rewritten,
or had its own behavior changed.**

## Prisma models added

`LogisticsRequestStatus` (`OPEN`, `QUOTE_ACCEPTED`, `CANCELLED`),
`LogisticsQuoteStatus` (`DRAFT`, `SUBMITTED`, `EXPIRED`, `WITHDRAWN`,
`ACCEPTED`, `REJECTED`), `LogisticsRequest`, `LogisticsQuote`,
`LogisticsOptimizationResult`. Full field lists and design rationale are
inline in `schema.prisma`'s own comments and in the module doc.

## API routes added

19 routes across `logistics-request.routes.ts` / `logistics-quote.routes.ts`
— full list, RBAC, and the one deliberate gap-fill (a TRANSPORTER's `GET
/logistics/requests` always shows every OPEN request, since the build
spec's own route list never specifies how a provider discovers requests to
quote on) are documented in `docs/modules/module-16-logistics-quote-optimization.md`.

## Optimization formula

```
finalScore = priceScore*0.40 + distanceScore*0.10 + timeScore*0.20
           + capacityFitScore*0.15 + reliabilityScore*0.15
```
(weights configurable via env, re-normalized to sum to 1). price/distance/
time are 0–100 normalized across the candidate set; capacityFitScore
rewards a tight fit over an oversized vehicle; reliabilityScore currently
always carries `reliabilitySource: "DEFAULT"` (score 50) with an explicit
`RELIABILITY_UNVERIFIED` reason, since Module 15 tracks no real trip
outcomes yet (verified by inspection — see Step 10 in the module doc).
Deterministic tie-break: score desc → price asc → quoteId asc.
`algorithmVersion = "v1"`.

## Configuration variables added

`LOGISTICS_ROAD_DISTANCE_MULTIPLIER`, `LOGISTICS_AVERAGE_SPEED_KMPH`,
`LOGISTICS_BASE_COST_INR`, `LOGISTICS_RATE_PER_KM_INR`,
`LOGISTICS_MINIMUM_TRIP_COST_INR`, `LOGISTICS_LOADING_COST_INR`,
`LOGISTICS_UNLOADING_COST_INR`, `LOGISTICS_TOLL_ESTIMATE_PER_KM_INR`,
`LOGISTICS_REFRIGERATION_SURCHARGE_PERCENT`, `LOGISTICS_WEIGHT_PRICE`,
`LOGISTICS_WEIGHT_DISTANCE`, `LOGISTICS_WEIGHT_TIME`,
`LOGISTICS_WEIGHT_CAPACITY`, `LOGISTICS_WEIGHT_RELIABILITY`,
`LOGISTICS_DEFAULT_QUOTE_VALIDITY_HOURS`,
`LOGISTICS_ROUTE_CACHE_TTL_SECONDS`, `LOGISTICS_COST_CACHE_TTL_SECONDS`.

## Verification — what was actually run, and what it found

**1. Environment setup (real, in this sandbox):** installed PostgreSQL
16 locally (`apt-get install postgresql`, the only route available since
`binaries.prisma.sh` is unreachable), created a database, ran `npm
install` for the backend successfully.

**2. Confirmed the network blocker precisely:** `npx prisma generate` /
`validate` / `migrate deploy` all fail with `403 Forbidden` fetching
`https://binaries.prisma.sh/...libquery_engine...` — confirmed this is
identical to the limitation already documented in this repo's own
`prisma/README-engines.md` from its original construction.

**3. Five deterministic engines — 47 real unit tests, all passing.**
These files (`HaversineRouteDistanceProvider`, `LogisticsCostEstimator`,
`VehicleEligibilityService`, the quote state machine,
`LogisticsOptimizationEngine`) import no Prisma-generated types, so they
could be compiled and run for real with `npx jest tests/unit/logistics-`.
Confirmed, for example: the optimizer does not simply pick the cheapest
quote (a well-rounded quote can and does beat a cheaper-but-much-slower/
less-reliable one, verified with real numbers); tie-breaking is
deterministic; a 5-ton requirement never matches a 2-ton vehicle; a
rejected or expired quote can never later be accepted.

**4. Full HTTP-layer integration test — 18 real tests, all passing,
against the actual routes/controllers/services (not the Prisma
repositories).** Built `tests/integration/logistics.routes.test.ts`
following this repo's own established pattern
(`transporter-vehicle-network.routes.test.ts`): hand-written jest mocks
implementing each repository interface, wired into the *real*
`LogisticsRequestService`/`LogisticsQuoteService`/routers/controllers/
authorization/deterministic-engine instances, driven over real HTTP via
supertest. **This caught two genuine bugs before they could ship:**
  - `calculateEstimate()`'s missing-coordinates check used `ValidationError`
    (→ HTTP 400), inconsistent with every other Module 16 domain error
    (→ 422). Fixed to `LogisticsDomainError("INVALID_LOGISTICS_REQUEST")`.
  - (Test-fixture bug, not app code) a hardcoded past `validUntil` in test
    fixtures made an otherwise-valid quote look expired against the real
    system clock — fixed to a clock-relative timestamp.

  After both fixes, all 18 tests pass, including: RBAC (TRANSPORTER
  cannot create a farmer request or accept a quote; only the owning
  transporter can be blocked from quoting someone else's vehicle),
  eligibility rejection (422 for insufficient capacity), the full
  estimate→submit-quote→accept→vehicle-reserved flow, and
  optimize-with-no-quotes returning 422.

**5. Full pre-existing test suite re-run for regressions:** 1049 passed /
20 failed, same 20 failures present before any Module 16 change (WDRA CSV
import, warehouse recommendation ranking order, an RBAC status-code
expectation) — none reference logistics code. No regressions introduced.

**6. `tsc --noEmit` across the whole backend:** the *only* errors inside
`src/modules/logistics/` (16 of them) are `Module '"@prisma/client"' has
no exported member 'X'` for the new enums — expected and resolved by
`npx prisma generate`. Two real type errors were found and fixed (missing
`tx`/`err` parameter annotations in the accept-transaction). Zero other
errors in Module 16 code or in `app.ts`'s wiring of it. (The rest of the
`tsc` output — ~330 errors — is 100% pre-existing, in other modules,
unrelated to this change; same root cause: the un-generated Prisma stub
client resolves many things to `any`/`unknown` under `strict` mode.)

**7. Accept-quote concurrency — verified two ways.** A full
`LogisticsQuoteService.acceptQuote` concurrency test suite was written
(`tests/integration/logistics-quote-accept.db.test.ts`, 5 tests, same
`.db.test.ts` convention as this repo's existing
`buyer-matching.concurrency.db.test.ts`) but needs a generated Prisma
Client to run. Since I *do* have a live local Postgres in this sandbox, I
additionally verified the exact SQL pattern
`acceptQuoteTransaction()` uses — two sequential conditional `UPDATE ...
WHERE id = $1 AND status = '<expected>'` statements inside one
transaction, rolling back if either affects 0 rows — directly against
real Postgres with the raw `pg` driver: 5 consecutive runs of two
concurrent accept attempts against the same OPEN request each produced
exactly one winner, exactly one `ACCEPTED` quote, the loser `REJECTED`,
and the request's `accepted_quote_id` matching the winner. Transcript
(one representative run):

```
Concurrent accept results: [
  { quoteId: 'quote-A', result: 'WON' },
  { quoteId: 'quote-B', result: 'LOST (request no longer OPEN)' }
]
Final request: { id: 'req-1', status: 'QUOTE_ACCEPTED', accepted_quote_id: 'quote-A' }
Final quotes: [
  { id: 'quote-A', request_id: 'req-1', status: 'ACCEPTED' },
  { id: 'quote-B', request_id: 'req-1', status: 'REJECTED' }
]
=== ASSERTIONS ===
Exactly one winner: PASS
Exactly one ACCEPTED quote in DB: PASS
Winner matches accepted quote: PASS
Request accepted_quote_id matches: PASS
Loser is REJECTED: PASS
```

## Module 15 integration points

Consumes `TransporterProfile`/`Vehicle`/`VehicleDriver` and their existing
repositories/authorization service as-is:
`VehicleRepository.findByPublicId/findById/updateAvailability`,
`TransporterRepository.findById/findByUserId/findByPublicId`,
`TransporterAuthorizationService.resolveOwnProfile`. On quote acceptance,
the winning vehicle's `availabilityStatus` is flipped to `RESERVED` via
Module 15's own `updateAvailability` — `VehicleAvailabilityStatus.RESERVED`
was already documented in `schema.prisma` as reserved for exactly this.

## Module 17 handoff

Once a quote is `ACCEPTED`, `LogisticsRequest.acceptedQuoteId` resolves to
a `LogisticsQuote` carrying everything Module 17 needs: provider, vehicle,
pickup/destination, quantity/crop, `quotedAmount` (the agreed price),
distance/duration estimate, and pickup schedule. No shipment or tracking
row is created by Module 16.

## Limitations / TODOs

1. **Prisma client generation blocked in this sandbox** —
   `binaries.prisma.sh` unreachable. Run, on a machine with normal
   internet access:
   ```
   npm install
   npx prisma generate
   npx prisma migrate dev --name add_logistics_module
   npm run build
   npm test
   npm run test:db   # runs logistics-quote-accept.db.test.ts against a real DB
   ```
2. **Provider reliability is always the neutral default** (score 50,
   `source: "DEFAULT"`) — Module 15 tracks no trip outcomes today; this is
   documented behavior per Step 10, not a bug, and the interface is ready
   for Module 17/18/25 to supply real data later.
3. **No dedicated "requests I can quote on" route exists in the build
   spec** — filled by scoping `GET /logistics/requests` to always show
   OPEN requests for a TRANSPORTER caller. Flagged, not hidden.
4. **DRAFT quote status is unreachable via the current API** — `POST
   .../quotes` creates directly in `SUBMITTED`. Kept in the enum/state
   machine for forward compatibility rather than removed.
5. **`hasConflictingAcceptedQuote`'s time-window overlap check** treats
   missing pickup/delivery timestamps as "possibly conflicting" (safe
   default) rather than assuming clear — this could reject some
   legitimately-available vehicles when neither request nor quote
   specifies a schedule; acceptable given Step 5's "never silently exclude
   a vehicle" principle applies to false negatives too, but worth
   revisiting once Module 17 provides firmer scheduling data.
