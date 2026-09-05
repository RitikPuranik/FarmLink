# Module 9 — Warehouse Intelligence

## Part 1 status: Foundation & Data Model — Done

This part implements only the domain model and repository (data-access)
layer for warehouse intelligence. It does **not** implement APIs,
controllers, routes, capacity allocation, cost calculation, spoilage
prediction, or any integration with Module 8 (Sell vs Store) — see
"Explicitly out of scope" below.

## Prisma models added

| Model | Purpose | publicId? |
| --- | --- | --- |
| `Warehouse` | A physical storage facility, owned by exactly one `User` or `Fpo` | yes |
| `WarehouseStorageUnit` | A chamber/section within a warehouse, with its own capacity and climate profile | yes |
| `WarehouseCropCapability` | Configured "can crop X be stored here" record — never AI-inferred | no (plain config/join row, like `FarmerCrop`) |
| `StorageReservation` | Foundation record that capacity is intended to be reserved — no capacity math yet | yes |
| `StorageRate` | Configured pricing row — no cost calculation yet | yes |

## Enums added

- `WarehouseStatus` (`ACTIVE`, `INACTIVE`, `SUSPENDED`)
- `WarehouseOwnerType` (`USER`, `FPO`) — mirrors `LotOwnerType`'s rationale
- `StorageType` (`AMBIENT`, `COLD_STORAGE`, `CONTROLLED_ATMOSPHERE`, `SILO`, `WAREHOUSE_GODOWN`, `OTHER`) — shared by `Warehouse.warehouseType` and `WarehouseStorageUnit.storageType`
- `CropStorageCompatibility` (`COMPATIBLE`, `NOT_RECOMMENDED`, `INCOMPATIBLE`)
- `StorageReservationStatus` (`PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `COMPLETED`)
- `StorageRateType` (`PER_DAY`, `PER_WEEK`, `PER_MONTH`, `PER_QUANTITY_PER_DAY`)

Reused rather than duplicated: `VerificationStatus` (Module 1) for
`Warehouse.verificationStatus`, and `QuantityUnit` (Module 4) for every
capacity/quantity/billing-unit field.

## Relationship shape

```
User / Fpo  (exactly one — see WarehouseOwnerType)
  └── Warehouse
        ├── WarehouseStorageUnit[]      — chambers/sections
        ├── WarehouseCropCapability[]   — configured, not AI-derived
        ├── StorageReservation[]        — foundation only, no capacity math
        └── StorageRate[]               — configured pricing, no cost calc

CropLot ── StorageReservation[]
Crop    ── WarehouseCropCapability[], StorageRate[]
```

Inverse relations added (additive only): `User.ownedWarehouses`,
`Fpo.ownedWarehouses`, `Crop.warehouseCapabilities`, `Crop.storageRates`,
`CropLot.storageReservations`. No existing field, index, or relation on
any Module 1–8 model was changed.

## Ownership design

A warehouse is owned by exactly one of a `User` (an individual
`WAREHOUSE_OPERATOR`, mirroring how role alone never grants access — see
`FpoAdmin`'s own comment) or an `Fpo`, recorded as `ownerType` +
`ownerUserId`/`ownerFpoId`. This mirrors `CropLot`'s
`ownerType`/`farmerId`/`fpoId` pattern rather than inventing a new
ownership abstraction. Enforcing "exactly one of the two is set" is left
to a future service layer, exactly as `CropLot`'s farmer/fpo pairing
legality is enforced in `lots.service.ts`, never at the database level —
Postgres has no portable constraint for this that matches the rest of the
project's conventions.

## Reservation lifecycle foundation

`StorageReservationStatus` defines the lifecycle
(`PENDING → CONFIRMED → COMPLETED`, with `CANCELLED`/`EXPIRED` as
alternate exits), but Part 1 only provides:

- `create()` — always writes a `PENDING` row
- `updateStatus()` — a plain column write, not a guarded state-machine
  transition

Nothing in Part 1 reads or decrements `WarehouseStorageUnit.availableCapacity`
when a reservation is created. The concurrency-safe, atomic
capacity-allocation transaction (mirroring
`CropLotRepository.adjustAvailableQuantity()`'s own guarded
`updateMany`/`gte` pattern) is explicit future work.

## Repository layer

`backend/src/modules/warehouse-intelligence/`:

- `warehouse.types.ts` — clean DTOs (`WarehouseDTO`, `WarehouseStorageUnitDTO`,
  `WarehouseCapability`, `StorageReservationRecord`, `StorageRateDefinition`)
  and mapper functions; raw Prisma rows are never exposed past this module.
- `warehouse.repository.ts` — `WarehouseRepository`: `findById`,
  `findByPublicId`, `list` (bounded pagination, max 100/page), `create`,
  `update`.
- `warehouse-storage.repository.ts` — `WarehouseStorageRepository`:
  `findByPublicId`, `listByWarehouse`, `create`, `update`.
- `warehouse-capability.repository.ts` — `WarehouseCapabilityRepository`:
  `add`, `deactivate` (soft `isActive` flip, never a delete), `listByWarehouse`,
  `findCompatible`.
- `storage-reservation.repository.ts` — `StorageReservationRepository`:
  `findByPublicId`, `listByLot`, `listByWarehouse`, `create`, `updateStatus`.
- `storage-rate.repository.ts` — `StorageRateRepository`: `create`,
  `listActive`, `findApplicable` (effective-date-window query).

## Data integrity decisions

- All capacity, temperature/humidity range, and rate fields use `Decimal`
  (`@db.Decimal`), never floating point — matching `CropLot.quantityKg`'s
  own convention.
- `Warehouse.status` (lifecycle enum, can express `SUSPENDED`) and
  `Warehouse.isActive` (fast listing/filter flag) are deliberately kept as
  two separate fields, in the same spirit as `Fpo.active` alongside
  `Fpo.accountStatus` — kept in sync by a future service layer, never
  derived automatically here.
- `WarehouseStorageUnit` is unique per `(warehouseId, code)`.
- `WarehouseCropCapability` is unique per `(warehouseId, storageUnitId,
  cropId)`. Note: Postgres composite unique indexes do not deduplicate
  across `NULL`s, so this only prevents duplicates for a *specific*
  `storageUnitId`; a duplicate warehouse-wide (`storageUnitId` null) row
  for the same crop is not blocked at the database level and is left to
  a future service-layer guard — the same trade-off already accepted for
  ownership pairing above.
- Foreign keys use `Restrict` throughout for anything transactional or
  historical (warehouse ownership, reservations, rates, capability→crop),
  and `Cascade` only for a warehouse's own physical sub-components
  (storage units, and capability rows scoped to those units) — mirroring
  `CropLot`'s own Restrict-vs-Cascade choices.
- `StorageRate.currency` defaults to `"INR"`. No other model in this
  schema carries a currency column (the project is INR-only); it's kept
  here only because this part's spec calls for it explicitly.

## Tests

`backend/tests/unit/warehouse-intelligence.repository.test.ts` — 19 tests
against a mocked `PrismaClient` (same pattern as
`price-forecasting.repository.test.ts`, including the `Prisma.Decimal`
stand-in needed because the generated client isn't available in this
sandbox). Covers: warehouse creation/ownership mapping, public-ID lookup,
bounded-pagination clamping, storage-unit capacity defaulting and Decimal
conversion, capability uniqueness/compatibility filtering and soft
deactivation, reservation creation always starting `PENDING`, and rate
lookup by effective-date window.

## Explicitly NOT implemented in Part 1

REST APIs, controllers, routes, Swagger endpoints, warehouse search,
nearby-warehouse recommendations, capacity allocation, atomic capacity
reservation, storage cost calculation, spoilage prediction, AI
recommendations, Sell vs Store integration, forecast integration,
notifications, cron jobs, GPS tracking.

## Remaining for future Warehouse Intelligence parts

- Controllers, routes, and request/response schemas
- Service layer enforcing ownership-pairing and authorization
- Atomic, concurrency-safe capacity reservation (guarded `updateMany`,
  mirroring `CropLotRepository.adjustAvailableQuantity()`)
- Storage cost calculation from `StorageRate`
- Warehouse search / nearby-warehouse recommendations
- Integration with the Sell vs Store decision engine (Module 8) and
  Price Forecasting (Module 7)
- Spoilage/AI-assisted recommendations (kept strictly out of
  `WarehouseCropCapability`, which stores configured data only)

---

# Part 2 — Storage Availability & Capacity Management

Part 2 adds the read/query layer Part 1 deliberately left out: turning the
persisted `WarehouseStorageUnit`/`WarehouseCropCapability` rows into
factual, deterministic answers to "is there room, and where", plus the one
mutation endpoint (`PATCH .../capacity`) that Part 1's own repository
`update()` method was already built to support but had no route.

## Files created

- `src/modules/warehouse-intelligence/warehouse-intelligence.config.ts` —
  centralized thresholds (utilization threshold, max/default radius,
  candidate cap, cache TTL, cache coordinate rounding).
- `src/modules/warehouse-intelligence/warehouse-capacity.ts` — pure,
  deterministic domain functions: `toKg`, `aggregateStorageUnitsToKg`,
  `calculateUtilizationPercentage`, `capacityStatus`,
  `canAccommodateQuantity`, `resolveCropCompatibility`.
- `src/modules/warehouse-intelligence/warehouse-availability.service.ts` —
  `WarehouseAvailabilityService`: `getWarehouseDetail`,
  `getStorageAvailability` (aliased as `getAvailability`), `searchNearby`,
  `updateStorageUnitCapacity`.
- `src/modules/warehouse-intelligence/warehouse-intelligence.schemas.ts` —
  Zod schemas for all four endpoints.
- `src/modules/warehouse-intelligence/warehouse-intelligence.controller.ts`
  and `warehouse-intelligence.routes.ts` — Express wiring + Swagger docs.
- `src/modules/warehouse-intelligence/warehouse-cache.ts` — optional Redis
  caching for nearby search, mirroring `market-cache.ts`'s
  fail-open convention, plus coordinate rounding for cache keys.
- `backend/tests/unit/warehouse-capacity.test.ts` (27 tests) and
  `warehouse-availability.service.test.ts` (23 tests).

## Files modified

- `prisma/schema.prisma` — one index added
  (`@@index([latitude, longitude])` on `Warehouse`); no new models or
  columns, since Part 1's `totalCapacity`/`availableCapacity`/
  `capacityUnit`/`compatibility` fields already cover everything Part 2
  needs to answer honestly.
- `src/modules/warehouse-intelligence/warehouse.types.ts` — added
  `WarehouseWithCapacity` and the availability/nearby-search DTOs,
  without touching the Part 1 types.
- `src/modules/warehouse-intelligence/warehouse.repository.ts` — added
  `findByPublicIdWithCapacity()` and `findNearbyCandidates()` (bounding
  box in SQL, bounded `take`).
- `src/common/errors.ts` — new `ErrorCode`s (`WAREHOUSE_NOT_FOUND`,
  `STORAGE_UNIT_NOT_FOUND`, `INVALID_RADIUS`, `INVALID_CAPACITY`,
  `INSUFFICIENT_STORAGE_CAPACITY`, `STORAGE_COMPATIBILITY_UNKNOWN`,
  `CROP_NOT_SUPPORTED_BY_WAREHOUSE`) and a `WarehouseDomainError` class.
  `INVALID_LOCATION`, `INVALID_QUANTITY`, and `UNSUPPORTED_UNIT` are
  reused as-is rather than duplicated.
- `src/modules/audit/audit.service.ts` — added the
  `WAREHOUSE_CAPACITY_UPDATED` audit action.
- `src/config/posthog.ts` — added `warehouse_search` and
  `warehouse_availability_viewed` to the event allow-list.
- `src/app.ts` — constructed the three Part 1 repositories +
  `WarehouseAvailabilityService` inline (same pattern as
  `marketIntelligenceRepository`) and mounted the router at
  `/api/warehouses`.

## Prisma changes / migrations

`20260904010000_add_warehouse_intelligence_part2/migration.sql` — index
only:

```sql
CREATE INDEX IF NOT EXISTS "warehouses_latitude_longitude_idx" ON "warehouses" ("latitude", "longitude");
```

## Capacity calculation design

Everything is normalized internally to KG using
`modules/fpo/unit-conversion.ts`'s existing `convertQuantityToKg` (the
same "internal aggregation base unit is KG" convention Module 3 already
established) — this is a fixed, unambiguous KG↔QTL↔TONNE factor already
trusted elsewhere in the codebase, not the "silent ambiguous unit
conversion" the build spec warns against (that concern is about
converting between incompatible unit *systems*, which never arises here
since `QuantityUnit` only ever expresses weight).

- `aggregateStorageUnitsToKg()` sums only `isActive` storage units and
  returns `null` — not zero — when there are none, so "no capacity
  configured" is never confused with "configured, zero capacity".
- `calculateUtilizationPercentage()` = occupied / total × 100, clamped to
  [0, 100], `null` for a missing/zero/negative total.
- `canAccommodateQuantity()` treats an exact fit as accommodating (`>=`),
  matching `CropLot`'s own available-quantity comparison convention.

## Availability state definitions

`AVAILABLE` / `LIMITED` / `FULL` / `UNAVAILABLE`, computed by
`capacityStatus()`:

- `UNAVAILABLE` — no capacity configured, or a zero/negative/invalid
  total (both "unknown" and "misconfigured" collapse to the same honest
  answer).
- `FULL` — available capacity is exactly zero.
- `LIMITED` — utilization ≥ `LIMITED_UTILIZATION_THRESHOLD_PERCENT`
  (80% by default, centralized in `warehouse-intelligence.config.ts`,
  not hardcoded per call site).
- `AVAILABLE` — otherwise.

Crop compatibility is `SUPPORTED` / `UNSUPPORTED` / `UNKNOWN`, resolved
only from configured `WarehouseCropCapability` rows
(`resolveCropCompatibility()`). `NOT_RECOMMENDED` and `INCOMPATIBLE` both
map to `UNSUPPORTED` for hard fit/no-fit gating; no matching row is
`UNKNOWN`, which is never upgraded to `SUPPORTED` — a requested quantity
against an `UNKNOWN`-compatibility crop returns `canAccommodate: null`,
never `true`.

## Nearby search strategy

Bounding box in SQL (`WarehouseRepository.findNearbyCandidates`, ~111 km
per degree of latitude, capped at `NEAREST_CANDIDATE_LIMIT` candidates)
followed by an exact Haversine pass and radius cut in the service —
mirroring Module 6's own nearby-market search, except the box filter runs
in the database `WHERE` clause here (new `(latitude, longitude)` index)
rather than in memory, per this part's "avoid loading every warehouse"
requirement. Maximum radius is 500 km (`INVALID_RADIUS` otherwise).

Deterministic sort order: (1) `canAccommodate` (confirmed fit first —
`null`/unknown sorts with the non-fitting group, never assumed to fit),
(2) capacity status rank (`AVAILABLE` > `LIMITED` > `FULL` >
`UNAVAILABLE`), (3) distance ascending, (4) available capacity
descending, (5) `publicId` ascending as a final tiebreaker.

## Crop storage compatibility behavior

Reused Part 1's `WarehouseCropCapability` model as-is — no new model.
Compatibility resolution prefers a storage-unit-scoped row over the
warehouse-wide (`storageUnitId: null`) row for that specific unit; see
`resolveCropCompatibility()`'s own comment for the exact precedence rule.

## API endpoints added

All mounted at `/api/warehouses`, authenticated, open to
`FARMER`/`FPO_ADMIN`/`WAREHOUSE_OPERATOR`/`ADMIN` for reads:

- `GET /api/warehouses/nearby`
- `GET /api/warehouses/:warehouseId`
- `GET /api/warehouses/:warehouseId/availability`
- `PATCH /api/warehouses/:warehouseId/storage-units/:storageUnitId/capacity`
  (`ADMIN`, or the `WAREHOUSE_OPERATOR` who owns this warehouse — checked
  in the service, not just by role)

## Authorization behavior

- Non-`ADMIN` roles only ever see/search operationally `ACTIVE`,
  `isActive` warehouses (plus their own, if they're the owner).
- A warehouse a caller can't see returns `404` (`WAREHOUSE_NOT_FOUND`),
  never `403` — so a suspended/inactive warehouse's existence isn't
  leaked to an outsider, matching this codebase's existing
  not-found-for-unauthorized convention.
- Capacity mutation additionally requires warehouse ownership
  (`ownerUserId` match) for a `WAREHOUSE_OPERATOR`.

## Module 8 integration boundary created

`WarehouseAvailabilityService.getStorageAvailability()` (aliased
`getAvailability()`) is the intended call site for a future Module 8
integration — it returns only DTOs, never a raw Prisma row, so Module 8
would never need to import a Warehouse Prisma model to use it. **Module 8
itself was not touched in this part** — `sell-store-input-resolver.
service.ts` still reports storage as unavailable/`STORAGE_DATA` missing,
exactly as before.

## Tests added and results

- `warehouse-capacity.test.ts` — 27 tests, pure domain functions
  (aggregation, utilization, status, fit, compatibility). **All pass.**
- `warehouse-availability.service.test.ts` — 23 tests against
  fake/mocked repositories: not-found handling, visibility/authorization,
  quantity/unit validation, unit conversion through the fit check,
  compatibility gating (`UNSUPPORTED` → `false`, `UNKNOWN` → `null`),
  radius/location validation, admin-vs-non-admin candidate scoping,
  exact-Haversine radius exclusion, null-coordinate skip, deterministic
  sort order, empty-result (non-error) search, and the capacity-update
  mutation's validation/ownership/audit/cache-invalidation paths. **All
  pass.**
- Full `npm test` (`tests/unit`): **26 of 28 suites / 358 of 373 tests
  pass.** The 2 failing suites
  (`buyer-matching.service.test.ts`, `sell-store-orchestration.service.
  test.ts`) are **pre-existing and untouched by this part** — every
  failure is `TypeError: Prisma.Decimal is not a constructor`, the same
  generated-Prisma-client gap documented below, in modules this part
  never modified.

## Verification results

- `npm install` — succeeded.
- `npx prisma format` / `validate` / `generate` — **failed**:
  `Failed to fetch ... https://binaries.prisma.sh/... - 403 Forbidden`.
  This sandbox's network egress allowlist doesn't include
  `binaries.prisma.sh`, so the Prisma query/schema engine binaries can't
  download — this is the same pre-existing limitation Part 1's own test
  file already documents (`prisma/README-engines.md`), not something
  this part introduced.
- `npx tsc --noEmit` — the generated `@prisma/client` in `node_modules`
  predates Module 9 entirely (it has no `Warehouse`, `QuantityUnit`,
  `Decimal`, etc.), so every file that imports a Module 9 (or Module
  1–8) Prisma type reports "has no exported member" and cascades into
  downstream implicit-`any` errors. This is a codebase-wide, pre-existing
  effect of the same engine-download gap — confirmed by the fact that
  unrelated, untouched modules (`buyer-matching`, `fpo`, `lots`,
  `market-data`, `market-intelligence`, `price-forecasting`, `quality`)
  show the identical failure pattern. Filtering to only the new
  `warehouse-intelligence` files, every error is one of: (a) the same
  "no exported member" gap, or (b) two implicit-`any` callback parameters
  that are only untyped *because* the types they'd otherwise infer from
  are themselves unresolved for the same reason — both would disappear
  automatically once `prisma generate` can run with real engine binaries.
  **No other implementation-level type errors were found in the new
  code.**
- `npm test` (Jest, `isolatedModules: true` — transpile-only, no
  type-checking) — genuinely **runs**, since it never needs the missing
  engine binary for fake-repository unit tests: 358/373 pass, with the 15
  failures pre-existing and unrelated (see above).
- Migration validation, `npm run test:db`, and a live
  `prisma migrate deploy` against a real database were **not run** —
  they need a reachable Postgres instance and working engine binaries,
  neither available in this sandbox.

## Explicitly NOT implemented in Part 2

Booking/reservation workflow, storage contracts, payments, logistics,
transport pricing, automatic warehouse allocation, AI recommendations,
forecasting, spoilage prediction, IoT/temperature monitoring, fabricated
capacity or seed warehouses, and any change to the Sell vs Store decision
engine's logic or output. Also deferred, as smaller scoped gaps: capacity
management by an `FPO_ADMIN` on an FPO-owned warehouse (needs an FPO
membership check this part didn't wire in — `ADMIN` and the owning
`WAREHOUSE_OPERATOR` can manage capacity today), and changing an existing
storage unit's `capacityUnit` through the capacity-update endpoint
(rejected outright — relabeling an existing figure's unit is a
data-integrity operation, not a capacity update).

## Pre-existing failures / environment limitations

- Prisma engine binaries cannot download in this sandbox
  (`binaries.prisma.sh` isn't in the network egress allowlist) — see
  Verification above. This blocks `prisma generate`/`validate`/`format`
  and any live-database test, and is the root cause of every `tsc`
  error and of the two pre-existing failing Jest suites. It predates this
  part entirely.

## Part 3 status: Storage Conditions, Crop Suitability & Storage Constraints — Done

Answers a different question than Part 2: not "is there enough room?"
(capacity) but "is this warehouse's *kind* of storage right for this
crop?" (suitability). The two are computed and reported independently —
neither endpoint collapses them into one opaque yes/no.

### What already existed vs. what this part adds

Part 1 already persisted the warehouse side of this comparison:
`WarehouseStorageUnit.storageType`/`temperatureControlled`/
`minTemperature`/`maxTemperature`/`humidityControlled`/`minHumidity`/
`maxHumidity`. This part adds only the five declared capability flags
that were missing (`ventilationAvailable`, `coldStorageAvailable`,
`controlledAtmosphereAvailable`, `pestControlAvailable`,
`moistureControlAvailable` — nullable, `null` = never configured/unknown,
never defaulted to `false`) plus the crop side, which had no equivalent
at all: `CropStorageRequirement`, one optional row per crop, never
auto-created. A crop with no row is reported as UNKNOWN, not silently
assumed compatible — Part 1's existing `WarehouseCropCapability.
compatibility` (a manually configured per-warehouse-per-crop judgement)
is untouched and serves a different purpose; this part's engine is a
computed, deterministic comparison, not a second copy of that field.

### Prisma changes (non-destructive)

- `WarehouseStorageUnit` — 5 new nullable boolean columns (see above).
- `CropStorageRequirement` (new model) — `cropId` unique;
  `preferredTemperatureMin/Max`, `preferredHumidityMin/Max` (`Decimal?`);
  `requiresVentilation/ColdStorage/ControlledAtmosphere/PestControl/
  MoistureControl` (`Boolean?`); `compatibleStorageTypes` (`StorageType[]`,
  default `[]` = "no restriction configured", never "compatible with
  nothing"); `maximumRecommendedStorageDays` (`Int?`, guidance only, never
  used for spoilage prediction); `notes`.
- No `SuitabilityStatus`/etc. Prisma enum was added — suitability is
  computed at read time, never persisted, so it is a plain TypeScript
  union (`storage-suitability.types.ts`), mirroring how Part 2's
  `CapacityStatus`/`CropCompatibilityState` are TS-only, not Prisma
  enums.

### Deterministic suitability engine

`storage-suitability.engine.ts` is pure (no Prisma, no Redis, no AI, no
sleeping) and independently unit-tested (`tests/unit/storage-suitability.
engine.test.ts`). It evaluates up to 8 factors per (crop requirement,
storage-unit conditions) pair: `STORAGE_TYPE`, `TEMPERATURE_RANGE`,
`HUMIDITY_RANGE`, `COLD_STORAGE`, `CONTROLLED_ATMOSPHERE`, `VENTILATION`,
`PEST_CONTROL`, `MOISTURE_CONTROL`.

- **Range comparison** (temperature/humidity): `FULL_MATCH` /
  `PARTIAL_MATCH` / `NO_MATCH` / `UNKNOWN` / `NOT_REQUIRED`.
  `NOT_REQUIRED` (the crop never configured a preference) is a distinct
  outcome from `UNKNOWN` (the crop *did* configure a preference but the
  warehouse's own range isn't known) — conflating the two was caught and
  fixed during testing (see Tests below); an unconfigured crop
  preference must never gate the whole result to UNKNOWN.
- **Boolean capabilities**: the exact build-spec truth table —
  required+available → `SATISFIED`; required+unavailable →
  `UNSATISFIED`; required+`null` → `UNKNOWN`; not required → `NOT_REQUIRED`
  regardless of warehouse data (never penalize a warehouse for a
  capability the crop didn't ask for).
- **Storage type**: `COMPATIBLE` / `INCOMPATIBLE` / `NOT_REQUIRED` (empty
  `compatibleStorageTypes` = not restricted).

**Criticality policy** (centralized in `STORAGE_SUITABILITY_CONFIG`,
`warehouse-intelligence.config.ts` — never scattered as magic
strings/if-else): `STORAGE_TYPE`, `TEMPERATURE_RANGE`, `COLD_STORAGE`,
`CONTROLLED_ATMOSPHERE` are critical; `HUMIDITY_RANGE`, `VENTILATION`,
`PEST_CONTROL`, `MOISTURE_CONTROL` are not. This is a deterministic
data-completeness/severity policy, not a scientific claim about any crop.

**Status**: critical factor unmet → `UNSUITABLE`; else critical factor
unknown → `UNKNOWN`; else any non-critical unmet/unknown →
`CONDITIONALLY_SUITABLE`; else `SUITABLE`.

**Confidence**: `null` whenever status is `UNKNOWN`; otherwise the
fraction of applicable (non-omitted) factors with a known outcome,
rounded to 2 decimals. Never a spoilage probability.

Two fixed, non-AI results cover the "no data at all" cases: a crop with
no `CropStorageRequirement` row → `UNKNOWN` /
`INSUFFICIENT_CROP_STORAGE_REQUIREMENTS`; a warehouse with no active
storage units → `UNKNOWN` / `INSUFFICIENT_WAREHOUSE_CONDITION_DATA`.

### Warehouse-level composition

A warehouse can have several storage units with different conditions.
`WarehouseSuitabilityService` evaluates every active unit and returns the
best result (`SUITABLE` > `CONDITIONALLY_SUITABLE` > `UNKNOWN` >
`UNSUITABLE`, tie-broken by confidence then storage-unit `publicId`),
reporting both which unit produced it (`evaluatedStorageUnit`) and how
many were actually compared (`evaluatedStorageUnitCount`) — so "the only
option" and "the best of several" are never confused.

### Capacity + suitability composition

`GET /api/warehouses/:warehouseId/storage-eligibility` calls Part 2's
`WarehouseAvailabilityService` for capacity and this part's suitability
engine independently, then combines them into `overallEligibility`
(`ELIGIBLE` / `INSUFFICIENT_CAPACITY` / `UNSUITABLE` / `UNKNOWN`) using a
fixed priority — `suitability UNSUITABLE` always wins over a capacity
result, then known-insufficient capacity, then either side being unknown,
else `ELIGIBLE` — documented in the service's own comment. Both raw
results (`capacity`, `suitability`) are always present in the response so
a rejection's actual cause is never hidden.

### API endpoints added

- `GET /api/warehouses/:warehouseId/suitability?cropId=` — read, same
  role set as Part 2's availability endpoint (FARMER/FPO_ADMIN/
  WAREHOUSE_OPERATOR/ADMIN).
- `GET /api/warehouses/:warehouseId/storage-eligibility?cropId=&quantity=&unit=`
  — read, same role set; `quantity`/`unit` optional (must be paired).
- `PATCH /api/warehouses/:warehouseId/storage-units/:storageUnitId/conditions`
  — ADMIN or the owning WAREHOUSE_OPERATOR (mirrors the existing
  capacity-update endpoint's authorization exactly); rejects an update
  that would invert a temperature/humidity range.
- `PUT /api/warehouses/crop-storage-requirements/:cropId` — ADMIN only;
  always an upsert (one row per crop, no version history — see the
  model's own schema comment).

No booking, ranking, recommendation, or Sell vs Store integration
endpoint was added — those are separate, later parts.

### Authorization

Unchanged read-role set for the two GET endpoints. Configuration writes
reuse the exact same "ADMIN, or the WAREHOUSE_OPERATOR who owns this
specific warehouse" rule Part 2 already established for capacity updates
— no new role was invented.

### Observability & audit

`warehouse_suitability_checked` / `warehouse_storage_eligibility_checked`
PostHog events carry only the resulting status, never coordinates or lot
data (added to `posthog.ts`'s existing allow-list — an event not on that
list is silently dropped, defense in depth). `WAREHOUSE_STORAGE_
CONDITIONS_UPDATED` and `CROP_STORAGE_REQUIREMENT_UPDATED` audit actions
cover the two configuration writes only; the two read endpoints are never
audited, matching this module's existing read/write audit split.

### Module 8 integration boundary

Not touched in this part (explicitly out of scope — see Part 6). The
service methods this part adds (`getSuitability`, `getStorageEligibility`)
already return plain DTOs (never a raw Prisma row), so a future Module 8
integration can depend on `WarehouseSuitabilityService` without importing
any Warehouse Prisma model — the same decoupling discipline
`WarehouseAvailabilityService.getStorageAvailability()` already
established for Part 2.

### Tests

`tests/unit/storage-suitability.engine.test.ts` — pure engine: range
comparison (full/partial/no match, unknown both ways, `NOT_REQUIRED` vs.
`UNKNOWN`), boolean truth table, storage-type compatibility, full
suitability classification (all four statuses), confidence bounds,
determinism, and a named regression test for the
`NOT_REQUIRED`-vs-`UNKNOWN` bug described below.

`tests/unit/warehouse-suitability.service.test.ts` — orchestration with
in-memory fakes: missing crop requirements, missing warehouse condition
data, best-of-several-storage-units selection (and that inactive units
are excluded from both the pick and the reported count), 404-for-
unauthorized, and all four `overallEligibility` compositions.

**A real bug was caught during testing and fixed before delivery**: the
first version of `compareRange()` returned `UNKNOWN` whenever the crop's
preferred range was unset, which — because `TEMPERATURE_RANGE` is a
critical factor — incorrectly forced the *entire* result to `UNKNOWN`
for any crop that had simply never configured a temperature preference,
even when every other factor (e.g. required cold storage) was fully
known and satisfied. Fixed by giving range comparison its own
`NOT_REQUIRED` outcome, distinct from `UNKNOWN`, exactly mirroring how
boolean requirements already distinguished "not required" from "required
but unknown". A regression test locks this in.

### Verification

This sandbox received only a curated subset of the repository (the
Module 9 files plus a handful of shared files needed for context) with
no `package.json`, `node_modules`, or database — `npm install`,
`prisma generate/validate/format`, a full `tsc --noEmit`, and `npm test`
could not be run as project-wide commands. What was actually done
instead:

- Every new/modified file was syntax-checked with `esbuild` — no syntax
  errors.
- The pure engine's logic was exercised directly (a standalone
  `ts-node` script exercising every function and status branch) — this
  is how the `NOT_REQUIRED`/`UNKNOWN` bug above was actually caught, and
  the corresponding Jest test now encodes the same check.
- A scoped `tsc --noEmit` was run over every Part 3 file plus the Part
  1/2 files they touch, using local type stubs for `@prisma/client` and
  the two modules this excerpt doesn't include (`auth.types`,
  `reference-data.service`) — with those stubs, Part 3's own files
  (`storage-suitability.engine.ts`, `storage-suitability.types.ts`,
  `warehouse-suitability.types.ts`, `crop-storage-requirement.
  repository.ts`, `warehouse-suitability.service.ts`, the config/schema/
  storage-repository edits) type-check with **zero errors**. The only
  remaining errors after filtering out "module not found" noise from
  files this excerpt never included (`express`, `zod`, `config/env`,
  `config/redis`, `middleware/*`, etc.) were pre-existing Part 1/2 code
  this part did not touch, caused entirely by the stub types being
  cruder than a real generated Prisma client. All verification scaffolding
  (stub `node_modules`, temporary `tsconfig`, stub files) was deleted
  before delivery — none of it is part of the final file set.
- A live migration apply, `prisma migrate deploy`/`diff`, and the full
  existing Jest suite were not run, since this environment has no
  database and no installed test runner — this mirrors the exact
  Prisma-engine-download limitation Part 2's own verification section
  above already documents, just with the added constraint that this
  particular sandbox received no `node_modules` at all.

### Explicitly NOT implemented in Part 3

Spoilage prediction, crop deterioration prediction, AI/LLM usage,
real-time IoT/sensor integration, automatic storage recommendation,
warehouse ranking, booking/reservation, storage contracts, payments,
transport/logistics, fabricated crop requirements or warehouse
conditions, and any assumption that unknown data means compatible. Also
out of scope, matching this part's own instructions: Sell vs Store
(Module 8) integration, and warehouse ranking/recommendation across
multiple warehouses — both are later, separate Module 9 parts.

## Part 4 status: Warehouse Suitability & Risk Analysis — Done

Answers a broader question than Part 3: not just "are the declared
storage conditions right for this crop?" but "should this
warehouse/crop/quantity/duration combination be considered suitable at
all?" — folding in crop compatibility (Part 1), capacity (Part 2), and
environmental suitability (Part 3) alongside two genuinely new factors,
into one deterministic, typed, explainable result.

### Reused vs. new

Reused without modification: Part 2's `WarehouseAvailabilityService.
getStorageAvailability()` (capacity status, `canAccommodate`, and crop
compatibility all come from this single call — never recomputed) and
Part 3's `WarehouseSuitabilityService.getSuitability()` (environmental
suitability). New in this part: `compareDuration()` (compares a
requested duration against `WarehouseCropCapability.
maxStorageDurationDays`, Part 1's existing configured field — no new
schema) and `evaluateOperationalStatus()` (reads `Warehouse.status`/
`isActive` directly — no new status system, per this part's own "do not
introduce a new status system if one already exists" instruction). One
small, additive extension was made to Part 2's own pure-functions file:
`resolveMaxStorageDurationDays()` in `warehouse-capacity.ts`, sitting
right next to `resolveCropCompatibility()` and using the exact same
unit-scoped-overrides-warehouse-wide resolution order, rather than a
second, differently-ordered lookup living somewhere else.

**No new Prisma models, fields, or migration** — every fact this part
reasons about was already persisted by Parts 1–3.

### Suitability states — reusing Part 3's enum, not inventing a parallel one

This part's own spec proposes `SUITABLE` / `CONDITIONALLY_SUITABLE` /
`UNSUITABLE` / `INSUFFICIENT_DATA`. Per the spec's own "use existing
enums if they already exist" instruction, Part 3's `SuitabilityStatus`
(`SUITABLE` / `CONDITIONALLY_SUITABLE` / `UNSUITABLE` / `UNKNOWN`) is
reused as-is — `UNKNOWN` plays exactly the role `INSUFFICIENT_DATA` was
asked for. Introducing a second, near-identical four-value enum for the
same concept would be exactly the kind of scattered, inconsistent
domain-state duplication this codebase's existing conventions (and this
part's own "centralize this classification logic" instruction) argue
against.

### Factors evaluated

| Factor | Source | Outcome |
|---|---|---|
| Crop compatibility | Part 1 `WarehouseCropCapability` (via Part 2) | `SUPPORTED` / `UNSUPPORTED` / `UNKNOWN` |
| Capacity feasibility | Part 2 | `canAccommodate` or capacity `status` |
| Duration compatibility | Part 1 `maxStorageDurationDays` (new comparison) | `SUPPORTED` / `EXCEEDS_MAXIMUM` / `NOT_APPLICABLE` |
| Environmental compatibility | Part 3 | `SUITABLE` / `CONDITIONALLY_SUITABLE` / `UNSUITABLE` / `UNKNOWN` |
| Warehouse operational status | `Warehouse.status`/`isActive` (new) | `OPERATIONAL` / `UNAVAILABLE` |

Operational status is the one factor that is never "unknown" — it is
always directly readable from persisted fields.

### Risks and constraints (typed, centralized, never prose-generated)

`warehouse-risk-analysis.engine.ts`'s `evaluateWarehouseSuitabilityRisk()`
is pure (no Prisma/Redis/AI) and returns typed `WarehouseRisk[]`
(`code`, `severity` LOW/MEDIUM/HIGH/CRITICAL, `blocking`, a fixed
template `explanation`) and `WarehouseConstraint[]` (`code`, `blocking`,
`explanation`) as two separate arrays, per this part's explicit
"return structured constraints separately from risks" instruction, even
where a single underlying fact (e.g. explicit crop incompatibility)
produces one entry in each. `blockingIssues` is the concatenation of
every `blocking: true` risk and constraint, so a caller never has to
re-derive "what's actually stopping this" from severity alone. A
`WAREHOUSE_DATA_INCOMPLETE` (LOW, non-blocking) risk is added whenever
overall confidence falls below a centralized threshold even if no single
factor was decisive enough to add a more specific risk on its own.
`WAREHOUSE_DATA_STALE` (suggested in the build spec) was deliberately
**not** implemented — there is no configured staleness threshold or
"last verified" timestamp anywhere in the existing warehouse data model,
and inventing one would be exactly the kind of fabricated policy this
module's conventions rule out.

### Scoring and weight rebalancing

`SCORE_WEIGHTS` (`WAREHOUSE_RISK_ANALYSIS_CONFIG`,
`warehouse-intelligence.config.ts`): crop compatibility 25, capacity
feasibility 25, environmental compatibility 25, warehouse operational
status 15, duration compatibility 10 — summing to 100 when every factor
is applicable. "Data completeness" is **not** a sixth scored factor: it
is already expressed through `confidence` (see below), and scoring it a
second time would double-count the same data-availability signal under
two names — a deliberate, documented deviation from the build spec's
suggested factor list. Any factor that cannot be evaluated (or, for
duration, was never requested / has no configured maximum) is omitted
and every remaining weight is rebalanced proportionally
(`computeWeightedScore()`) — never a fabricated neutral midpoint.
`factorsUsed`/`omittedFactors` are always returned. If a *critical*
factor (crop compatibility, capacity, or environmental compatibility —
`CRITICAL_ANALYSIS_FACTORS`) is the one omitted, `suitabilityScore` and
`confidence` are both forced to `null` and the overall status becomes
`UNKNOWN`, regardless of how favorable the rebalanced score of the
remaining factors would otherwise look — rebalancing never substitutes
for genuinely missing critical information.

### Confidence

`null` whenever a critical factor is unknown; otherwise the fraction of
total possible weight actually evaluated (0–1, 2 decimals) —
deterministic, reproducible, never an AI confidence score. A fully
SUITABLE result with an inapplicable (not-requested) duration factor
still reports confidence `0.9`, not `1` — omission always has a
completeness cost, even when it doesn't change the status.

### Result contract

`WarehouseSuitabilityAnalysisResult`: `warehouseId`, `cropId`,
`suitability`, `suitabilityScore`, `confidence`, `blockingIssues`,
`risks`, `constraints`, `factorsUsed`, `omittedFactors`, plus the raw
per-factor outcomes (`cropCompatibility`, `durationCompatibility`,
`environmentalCompatibility`, `operationalStatus`), `availabilitySummary`
(capacity status/totals/`canAccommodate`, mirroring Part 3's eligibility
DTO), `evaluatedAt`, and a fixed `disclaimer`. Never a raw Prisma record.

### API

`GET /api/warehouses/:warehouseId/suitability-analysis?cropId=&quantity=&unit=&durationDays=`
— read-only, same role set as Parts 2/3's read endpoints
(FARMER/FPO_ADMIN/WAREHOUSE_OPERATOR/ADMIN). `quantity`/`unit` must be
paired (reuses the existing `requireQuantityUnitPair` refinement);
`durationDays` is independently optional. A non-positive `durationDays`
is rejected with the new `INVALID_DURATION` domain error before any
repository call. No `POST /analyze-suitability` mutation-shaped endpoint
was added — the spec offered it only as an alternative for when request
duration/quantity are needed, and a `GET` with query parameters already
covers that without introducing a write-shaped verb for a read
operation.

### Lot support — intentionally partial, and why

The spec asks for analysis against either a `Crop` or a `CropLot`. This
repository excerpt does not include Module 4's lot data-access layer
(only `app.ts`'s import lines hint that a `CropLotRepository` exists),
and guessing at its exact method/field names to wire a live dependency
here would risk a silent runtime mismatch against the real file. Rather
than fabricate that integration, `AnalyzeSuitabilityInput` accepts
already-resolved `cropId`/`quantity`/`durationDays` directly; a future
caller that has a lot loaded (most plausibly Module 8, in a later part)
can pass its values straight through. No lot-scoped HTTP endpoint was
added. This is a scope limitation, not a design decision — flagged
explicitly rather than papered over.

### Observability & audit

`warehouse_suitability_analyzed` PostHog event carries only the
resulting status and whether a blocking issue was found — no
coordinates, no lot data (added to `posthog.ts`'s allow-list; an event
not on that list is silently dropped). No audit event: this is a
read/analysis operation, matching this part's own "do not audit ordinary
read/analysis requests" instruction and this module's existing
read-vs-write audit split.

### N+1 / query-count note

`analyzeSuitability()` makes three warehouse-scoped calls per request
(Part 2's availability call, Part 3's suitability call, and one direct
`findByPublicIdWithCapacity` for duration/operational-status data) —
each reusing an existing, already-tested method rather than duplicating
its logic. This is three fixed calls per request, not a query inside a
loop over any collection, so it does not violate the "avoid N+1" rule;
it is a deliberate reuse-over-micro-optimization tradeoff, documented
here rather than justified by inventing a fourth combined repository
method this pass didn't need.

### Tests

`tests/unit/warehouse-risk-analysis.engine.test.ts` — pure engine:
duration comparison (not-applicable both ways, supported, exceeded),
operational status, per-factor scoring including omission, weighted-score
rebalancing (including "omit everything → null score" and 0–100
bounds), confidence (critical-unknown → null; fraction of evaluated
weight; full confidence only when every factor including duration was
evaluated), and the full suitability classification for every risk type,
including a multi-issue case and a determinism check.

`tests/unit/warehouse-risk-analysis.service.test.ts` — orchestration
with in-memory fakes: clean SUITABLE composition, crop-unsupported
propagation from Part 2, operational-unavailability override, Part 3
`UNKNOWN` propagation (never silently upgraded), `INVALID_DURATION`
rejected before any repository call, duration-limit resolution from a
`WarehouseCropCapability` row, and a determinism check across repeated
calls.

**A real bug was caught during testing and fixed before delivery**: the
first draft of the "perfect case" test asserted confidence `1` for a
fully-SUITABLE result — but duration wasn't requested in that scenario,
so it is legitimately omitted (`NOT_APPLICABLE`, weight 10), and the
correct confidence is `0.9` (90 of 100 weight evaluated). Investigating
this confirmed the *engine's* omission/rebalancing math was correct and
the *test's* expectation was wrong; the test was corrected and a second
test was added asserting confidence `1` only when duration is also
requested and evaluated, so both branches are now explicitly covered.

### Verification

Same sandbox constraints as Part 3 (no `package.json`/`node_modules`/
database in this environment) — `npm install`, `prisma generate`, and a
project-wide `npm test`/`tsc` could not be run. What was actually done:

- Every new/modified file syntax-checked with `esbuild` — no errors.
- The pure engine's logic exercised directly via a standalone `ts-node`
  script covering every function and every suitability branch (this is
  how the confidence-expectation bug above was caught).
- A scoped `tsc --noEmit` over every Part 4 file plus the Part 1–3 files
  they touch, using the same local `@prisma/client`/`auth.types`/
  `reference-data.service` stubs as Part 3's verification (this time
  with `Warehouse` and `WarehouseCropCapability` given explicit fields
  rather than a bare index signature, after that crude shape produced
  two false-positive structural-typing errors during the first pass) —
  **zero genuine errors** in Part 4's own files after that fix; every
  remaining error was "module not found" noise from files this excerpt
  never included (`express`, `zod`, `config/env`, `config/redis`,
  `middleware/*`, `auth.repository`, `auth.middleware`,
  `market-intelligence/analytics`, `fpo/unit-conversion`) or one
  pre-existing implicit-`any` in Part 2's own `updateStorageCapacityBody`
  schema (untouched by this part, and itself just another symptom of the
  missing real `zod` types). All verification scaffolding was deleted
  before packaging.
- A live migration apply and the full existing Jest suite were not run
  (no database, no installed test runner in this sandbox) — this part
  added no migration at all, so there is nothing new to apply regardless.

### Explicitly NOT implemented in Part 4

AI/ML/LLM usage of any kind, fabricated warehouse capabilities or
environmental conditions, fabricated storage costs, duplicated capacity
or environmental-suitability logic (both are called through their
existing Part 2/3 service methods), booking/reservation/payment
workflows, and any treatment of unknown data as compatible. Also
explicitly out of scope, matching this part's own instructions:
multi-warehouse ranking/recommendation (Part 5) and Sell vs Store
integration (Part 6) — neither was touched.

## Part 5 status: Warehouse Recommendation & Ranking Engine — Done

Given a crop (and optionally a location/quantity/duration), finds
candidate warehouses, evaluates each through Part 4 (never re-deriving
suitability), excludes anything Part 4 found `UNSUITABLE`, keeps
`UNKNOWN` candidates structurally separate rather than mixed in with a
caveat, and ranks the rest with a deterministic, weight-rebalanced score
plus a template-built explanation.

### Reused vs. new

Reused without modification: Part 4's `WarehouseSuitabilityAnalysisService.
analyzeSuitability()` (the entire suitability/risk/constraint/score
determination for each candidate — never re-implemented), Part 1's
`StorageRateRepository.findApplicable()` (configured pricing rows), and
Module 6's `haversineKm()`. Two small, genuine deduplications were made
rather than copy-pasted: `computeBoundingBox()` was extracted from Part
2's `WarehouseAvailabilityService.searchNearby()` into
`warehouse-capacity.ts` and Part 2 was refactored to call it too (same
formula, now in one place instead of two that could quietly drift), and
`computeRebalancedWeightedScore()` was extracted into a new
`weighted-scoring.ts` shared by Part 4's suitability score and this
part's ranking score, since both needed byte-for-byte the same
"omit-and-proportionally-rebalance" algorithm. Both refactors were
re-verified against the exact same test inputs before and after to
confirm zero behavior change.

**New in this part**: `warehouse.findCandidatesByCrop()` (a bounded,
indexed repository query for the no-location search path — Part 2 had
no equivalent, since its own nearby search always requires
coordinates), and the entire ranking/cost-estimation/tie-breaking/
explanation engine.

**No new Prisma models, fields, or migration.**

### Candidate discovery

With `latitude`/`longitude` (+ optional `radiusKm`, default 50 km, max
500 km — same ceiling Module 6 already uses): bounding box →
`findNearbyCandidates()` (Part 2's own bounded, indexed query, reused
as-is) → exact Haversine cut → sorted by distance. Without a location:
`findCandidatesByCrop()`, a new bounded query filtering in SQL on an
active `WarehouseCropCapability` row for the crop (never "load every
warehouse and filter in memory"). Either way, results are capped at
`MAX_EVALUATED_CANDIDATES` (20) before the expensive per-candidate Part
4 analysis — see the "N+1 / query-count" note below for why that cap
exists and is necessary here specifically.

### Suitability filtering

Every capped candidate is analyzed via Part 4 (in parallel,
`Promise.all`). `UNSUITABLE` → excluded, counted in
`excludedCandidateCount`, never appears anywhere in the response body.
`UNKNOWN` → placed in `unevaluableCandidates` (warehouse identity + the
risk codes that made it unevaluable), never in `recommendations` — per
this part's explicit "do not mix them with recommended warehouses
without clearly indicating uncertainty" instruction.
`SUITABLE`/`CONDITIONALLY_SUITABLE` → proceed to ranking.

### Ranking factors and weights

`WAREHOUSE_RECOMMENDATION_CONFIG.RANKING_WEIGHTS` — distance 30 /
suitability 30 / capacity 20 / cost 20 — adopted directly from the build
spec's own worked example rather than invented. Per-factor scoring
(`warehouse-recommendation.engine.ts`, all pure functions):

- **Distance**: linear 100→0 from 0 km to the search radius; omitted
  entirely for a location-less search or a warehouse with no
  coordinates (never inferred).
- **Suitability**: Part 4's own `suitabilityScore` reused directly, not
  recomputed — this factor *is* Part 4's result, deliberately.
- **Capacity headroom**: distinct from Part 4's own binary
  canAccommodate score — this one differentiates *how much* room a
  candidate has among several that already fit: exactly enough scores
  50, double the requested quantity (configurable saturation ratio)
  scores 100. Falls back to Part 4's reused status-based score when no
  quantity was requested.
- **Cost**: scored *relative to the other candidates actually evaluated
  this request* (cheapest → 100, priciest → 0) — there is no absolute
  "good price" anywhere in this schema to score against, mirroring
  Module 6's own relative price-percentile convention rather than
  inventing an absolute scale.

Weight rebalancing (`computeRankingScore`, via the shared
`computeRebalancedWeightedScore`) happens **per candidate** — a
candidate missing only a cost estimate has its remaining three weights
rebalanced to sum to 100 for that candidate specifically, exactly as the
build spec's own worked example describes.

### Storage cost estimation

`estimateStorageCost()` is `null` unless quantity, unit, a requested
duration, *and* an applicable configured `StorageRate` for that
warehouse all exist together — never a fabricated rate, handling fee,
insurance, transport, or tax. Supports all four existing `StorageRateType`
values: `PER_QUANTITY_PER_DAY` (converted to a per-KG rate via the same
trusted KG-normalization `warehouse-capacity.ts` already uses elsewhere
— not a new/ambiguous unit conversion), flat `PER_DAY`, and `PER_WEEK`/
`PER_MONTH` billed in whole periods (`Math.ceil`). `assumptions` states
in plain language exactly which inputs and rounding were used. Rate
resolution (`resolveApplicableRate`) prefers a crop-specific rate over a
warehouse-wide one — the same specific-overrides-general order
`resolveCropCompatibility()`/`resolveMaxStorageDurationDays()` already
use — but does **not** resolve a storage-unit-scoped rate override,
since Part 4 already picks the best storage unit internally without
exposing which one; re-deriving that choice here to key a rate lookup
would itself be the "duplicate suitability logic" this part is told to
avoid. Documented simplification, not silent.

### Deterministic tie-breaking

`compareForRanking()` implements the build spec's exact order:
rankingScore desc → suitabilityScore desc (nulls last) → total
non-blocking risk severity asc → distanceKm asc (an unknown distance is
never assumed closest) → availableCapacityKg desc → warehouse publicId
asc as the final, always-decisive step. Never relies on incoming
array/database order — verified with a reversed-input stability test.

### Explanations

`buildRecommendationExplanation()` is a fixed string template — no LLM
— that only names factors actually present in that candidate's own
`factorsUsed`; an omitted factor (e.g. no cost estimate) is never
claimed as a strength.

### Result contract

`WarehouseRecommendationResult` (per candidate): `warehouse`, `rank`,
`rankingScore`, `suitability`/`suitabilityScore`/`confidence` (from Part
4), `distanceKm`, `availableCapacityKg`, `estimatedStorageCost`,
`risks`/`constraints` (from Part 4), `factorsUsed`/`omittedFactors`,
`explanation`, `evaluatedAt`. `WarehouseRecommendationResponse`:
`recommendations`, `unevaluableCandidates`, `evaluatedCandidateCount`,
`suitableCandidateCount`, `excludedCandidateCount`, `searchMetadata`,
`disclaimer`. Never a raw Prisma record.

### No-result handling

A search that finds zero matches returns **`200` with empty arrays and
full `searchMetadata`/counts, not a `NO_SUITABLE_WAREHOUSES_FOUND`/
`NO_NEARBY_WAREHOUSES_FOUND` error** — confirmed against Part 2's own
`searchNearby()`, which already returns `{ results: [] }` rather than
throwing on zero matches; a valid request that legitimately finds
nothing is not an exceptional condition in this codebase's existing
convention, and the response's own counts/metadata already make the
"why empty" honest and explicit, satisfying this part's "do not return
misleading empty recommendations... without metadata" requirement
without introducing an inconsistent error-on-empty pattern found nowhere
else in this module.

### API

`POST /api/warehouses/recommend` — `cropId` required; `latitude`/
`longitude` optional but must be given together (`radiusKm` only valid
alongside them); `quantity`/`unit` optional but paired; `durationDays`
independently optional. Same authentication as every other endpoint in
this router; no new role introduced. `POST` (not `GET`) because the
spec's own suggested shape takes a request body, and a location +
quantity + duration search has enough optional structure that query
strings would be awkward — consistent with the spec's own "Potential
conceptual endpoint: `POST /api/warehouses/recommend`" suggestion.

### Caching

Reuses Part 2's exact `getWarehouseCache`/`setWarehouseCache`/
`roundCoordinateForCacheKey` utilities (short TTL, coordinate-rounded
cache keys — never precise coordinates persisted to Redis) — no new
caching mechanism introduced.

### Observability

`warehouse_recommendation_requested` (at the start, privacy-safe: only
`hasLocation` and the crop id) and `warehouse_recommendation_generated`
(candidate counts, never coordinates or per-candidate details) — both
added to `posthog.ts`'s allow-list. No audit event — this is a read/
analysis operation, matching this module's established read-vs-write
audit split.

### N+1 / query-count note

This part compounds Part 4's own already-documented "three warehouse-
scoped calls per analysis" tradeoff across up to `MAX_EVALUATED_
CANDIDATES` (20) candidates evaluated concurrently via `Promise.all` —
up to ~60 queries per recommendation request, plus one `findApplicable`
rate lookup per surviving (non-excluded, non-unevaluable) candidate.
This is bounded, not proportional to the warehouse table's total size,
and is a deliberate reuse-over-optimization tradeoff (the alternative
would require a bulk-suitability method inside Part 4, which is exactly
the "do not duplicate suitability logic" this part is told to avoid).
Flagged explicitly here as a real cost, not hidden — a future
performance pass could add a batch-oriented Part 4 method if this
becomes a measured bottleneck, but that is out of this part's scope.

### Tests

`tests/unit/warehouse-recommendation.engine.test.ts` — every pure
function: distance/capacity-headroom/relative-cost scoring (including
all-null and all-equal edge cases), ranking-score rebalancing, cost
estimation for all four rate types plus missing-quantity/duration cases,
risk severity summing, and the full tie-break order including a
reversed-input stability check.

`tests/unit/warehouse-recommendation.service.test.ts` — orchestration
with in-memory fakes: ranking two suitable candidates while excluding an
unsuitable one, `UNKNOWN` candidates kept separate, empty-result
metadata (not an error) when there are no candidates at all, cost
estimation appearing only when quantity+unit+duration+rate all coincide
(and staying `null` otherwise even with a configured rate), and a
determinism check across repeated calls.

**Both refactors (`computeBoundingBox`, `computeRebalancedWeightedScore`)
were verified via a standalone `ts-node` script comparing Part 4's exact
suitability-score output before and after extracting the shared utility,
against the same fixed input used in Part 4's own manual verification —
identical output, confirming zero behavior change from the
deduplication.**

### Verification

Same sandbox constraints as Parts 3/4 — esbuild syntax checks on every
new/modified file, a standalone `ts-node` functional run of every pure
engine function (all passed on the first run — no bug this time, unlike
Parts 3/4), and a scoped `tsc --noEmit` over every Part 5 file plus the
Part 1/2/4 files it touches, using the same local stubs as before (this
time also stubbing `market-intelligence/analytics.ts`'s `haversineKm`
export, which this excerpt doesn't include) — zero genuine errors; every
remaining error was the same already-catalogued "module not found"
noise or the one pre-existing Part 2 implicit-`any`. All scaffolding
deleted before packaging.

### Explicitly NOT implemented in Part 5

AI/ML/LLM usage, fabricated warehouse information, fabricated distances,
fabricated storage costs, duplicated capacity or suitability logic (both
called through Parts 2/4's existing methods), PostGIS (this schema has
no PostGIS extension configured — bounding-box + Haversine in
application code, matching Part 2's own established approach), and any
booking/reservation workflow. Also explicitly out of scope, matching
this part's own instructions: Sell vs Store integration (Part 6), which
remains separate.

## Part 6 status: Warehouse Intelligence Integration with Sell vs Store — Module 9 side complete; Module 8 side requires a manual, minimal edit this pass could not safely make

**Read this section before assuming Part 6 is "done" in the same sense
as Parts 1–5.** The Module 9-owned half of this integration — the
provider interface, the real implementation, the honest no-op fallback,
and full tests — is complete, real, and verified. The Module 8-owned
half (actually consuming it) was **not** edited, and that limitation is
explained in detail below rather than glossed over.

### Why Module 8 itself was not modified

This repository excerpt never included Module 8's actual source files.
`app.ts` shows their import paths and exact constructor call sites
(`DecisionInputResolverService`, `DecisionEngineService`,
`SellStoreOrchestrationService`, `SellStoreDecisionRepository`,
`SellStoreAIProvider`/`UnavailableSellStoreAIProvider`), which is enough
to see that `DecisionInputResolverService` currently takes exactly three
constructor arguments (`cropLotRepository`, `qualityRepository`,
`marketIntelligenceRepository`) — but not enough to see
`SellStoreInputSnapshot`'s exact shape, `ResolvedDecisionInput`'s
availability-flag types, or `DecisionEngineService`'s scoring internals,
all of which this part's own instructions explicitly require inspecting
("the actual repository implementation is the source of truth") before
touching. Guessing at those internals and editing files this pass cannot
see would risk silently producing code that doesn't compile against, or
actively breaks, the real Module 8 — exactly the "do not fabricate"
and "do not redesign Module 8" outcomes this part's own hard rules
forbid. This is the same category of limitation Part 4 already
disclosed for Module 4's `CropLotRepository` (referenced but not
included), just for a module that isn't referenced with even that much
detail anywhere in this excerpt beyond `app.ts`'s import/construction
lines.

### What was actually built (Module 9 side — complete, tested, real)

- **`storage-intelligence-provider.ts`** — the `StorageIntelligenceProvider`
  interface (`resolveStorageContext(request): Promise<StorageDecisionContext>`)
  and the `StorageDecisionContext` normalized DTO (`availability`,
  `suitableWarehouseCount`, `bestWarehouseAvailable`, `estimatedCost`,
  `costPerUnit`, `currency`, `feasibleDurationDays`, `risks`,
  `constraints`, `confidence`, `dataTimestamp`, `factorsUsed`,
  `omittedFactors` — exactly the build spec's own contract, with
  risks/constraints narrowed to plain string codes rather than full
  objects per the spec's own "do not expose full warehouse Prisma
  models" instruction applied consistently). Also exports
  `UnavailableStorageIntelligenceProvider`, an honest no-op that always
  returns `availability: null` and every other field
  null/empty/zero — modeled directly on this exact codebase's own
  established `UnavailableSellStoreAIProvider`/`UnavailableQualityAIProvider`
  naming and role (visible via `app.ts`'s own comments on them, even
  without their source).
- **`storage-intelligence-provider.service.ts`** —
  `WarehouseStorageIntelligenceProvider`, the real implementation. It is
  deliberately thin: it calls Part 5's `WarehouseRecommendationService.
  recommend()` (which itself calls Part 4 per candidate) and reshapes
  the result — no suitability or ranking logic is re-implemented here.
- **Availability semantics** (the build spec's own critical
  distinction): `true` when at least one candidate came back
  SUITABLE/CONDITIONALLY_SUITABLE; `false` when candidates were
  evaluated and confirmed none qualify, *or* no candidate warehouse
  exists for the crop at all (`evaluatedCandidateCount === 0` — itself a
  confirmed fact, not a data gap); `null` only when at least one
  candidate came back genuinely unevaluable (Part 4's `UNKNOWN`) and
  none were confirmed suitable — "we don't know" is never collapsed into
  either "no" or "yes".
- **Cost/duration**: `estimatedCost`/`costPerUnit`/`currency` come
  straight from the best-ranked candidate's own `estimatedStorageCost`
  (itself already null unless real rate+quantity+duration data exists —
  see Part 5); `costPerUnit` is derived by dividing by the same
  candidate's `quantityUsedKg`, never independently computed.
  `feasibleDurationDays` only echoes the requested duration back when a
  duration was actually requested and the best candidate carries no
  `MAXIMUM_STORAGE_DURATION_EXCEEDED` constraint — otherwise `null`.
- **Wired into `app.ts`** (safe, since `app.ts` is fully visible and
  editable): a new optional `storageIntelligenceProvider` field on
  `AppDependencies` (same optional/default pattern as
  `sellStoreAiProvider`), constructed as the real
  `WarehouseStorageIntelligenceProvider` by default (unlike the AI
  advisory layer, Module 9 is fully implemented in this codebase, so
  there's no reason to default to the Unavailable stub here), and
  exposed via `app.locals.storageIntelligenceProvider` as a safe interim
  handoff point — visible to Module 8's code without this pass having to
  guess at or edit Module 8's constructor.

### What Module 8 needs — exact, minimal instructions for whoever has that source

1. **`DecisionInputResolverService`** — add a fourth constructor
   parameter, `private readonly storageIntelligence: StorageIntelligenceProvider`
   (import from `../warehouse-intelligence/storage-intelligence-provider`).
   In whatever method currently sets the storage fields of
   `SellStoreInputSnapshot` to "unavailable" (per this part's own
   description: `storage: { availability, costPerUnit, durationDays,
   constraints, spoilageRisk }`), replace that with:
   `const storage = await this.storageIntelligence.resolveStorageContext({ cropId: lot.cropId, quantity: lot.availableQuantityKg, unit: "KG", latitude: farmLatitude, longitude: farmLongitude, requestingUser: { id: actorId, role: actorRole } });`
   then map `storage.availability` → `ResolvedDecisionInput`'s existing
   storage-availability field (widening it to a tri-state if it is
   currently a plain boolean — see point 3), `storage.costPerUnit` →
   `costPerUnit`, `storage.feasibleDurationDays` → `durationDays`,
   `storage.constraints` → `constraints`. **`spoilageRisk` has no Module
   9 equivalent and must stay whatever Module 8 already does for it** —
   Module 9 explicitly never predicts spoilage (a hard rule across every
   part of Module 9), so nothing here should populate that field.
2. **Graceful degradation**: wrap the `resolveStorageContext` call in a
   try/catch; on an unexpected throw, capture it with the existing
   Sentry pattern and fall back to `new UnavailableStorageIntelligenceProvider()
   .resolveStorageContext(...)`'s output (all-null) rather than failing
   the whole Sell vs Store request — per this part's own "storage
   intelligence being unavailable must not fail an entire request"
   instruction.
3. **`ResolvedDecisionInput` availability typing**: if the existing
   storage-availability field is a plain `boolean`, it cannot represent
   "unknown" without lying — it needs to become `boolean | null`
   (mirroring `StorageDecisionContext.availability`'s own three-state
   design), and `DecisionEngineService` needs a small update so that
   `null` omits storage factors from scoring (with weight rebalancing,
   matching Module 6/Part 4's existing pattern) rather than the engine
   treating `null` as falsy/`false`.
4. **Snapshot immutability**: persist the resolved `StorageDecisionContext`
   object itself (or the mapped subset) inside `SellStoreInputSnapshot`
   at decision-generation time, never re-fetched for a historical
   decision — this requires no new code beyond storing what
   `resolveStorageContext()` already returned for that request.
5. **Dependency injection**: in `app.ts`, change
   `new DecisionInputResolverService(deps.cropLotRepository, deps.qualityRepository, marketIntelligenceRepository)`
   to add `storageIntelligenceProvider` (already constructed just above
   that line — see "Wired into `app.ts`" above) as the fourth argument,
   and delete the interim `app.locals.storageIntelligenceProvider` line
   once this is done.

None of this requires touching `DecisionEngineService`'s market/quality
scoring logic, `SellStoreOrchestrationService`'s persistence flow, or
any existing Module 8 API contract beyond the additive typing change in
point 3.

### Tests

`tests/unit/storage-intelligence-provider.test.ts` covers: the
Unavailable provider always returning `null` availability; the real
provider's three availability branches (confirmed available, confirmed
unavailable via all-excluded, confirmed unavailable via zero candidates,
and genuinely unknown via an unevaluable candidate); cost-per-unit
derivation; `feasibleDurationDays` being null exactly when a duration
constraint was violated; and a full "everything stays null/empty on an
empty result, nothing fabricated" check. All branches were additionally
verified functionally via a standalone `ts-node` script before the Jest
tests were finalized — zero bugs found this time (unlike Parts 3 and 4,
where the equivalent manual run caught a real logic error before
delivery).

### Verification

Same sandbox constraints as every earlier part. Both new Part 6 files
were syntax-checked with `esbuild`, functionally verified end-to-end via
`ts-node` (see above), and included in a scoped `tsc --noEmit` pass
alongside every other Part 1–5 file using the same local stubs already
established — zero genuine errors. `app.ts`'s own new lines follow the
exact structural pattern already used for `sellStoreAiProvider` (an
optional dependency defaulted with `??`), so while a full type-check of
`app.ts` itself isn't possible in this sandbox (it would require stubs
for every one of this application's ~10 other modules), the change is a
narrow, precedented pattern match rather than novel logic.

### Explicitly confirmed

- Module 9 remains solely responsible for warehouse intelligence — no
  suitability, ranking, or availability logic was duplicated into the
  new provider files; both call straight through to Parts 4/5.
- Module 8 remains solely responsible for Sell vs Store decisions — its
  actual decision/scoring/persistence logic was not touched, because it
  was never accessible to touch safely.
- No AI/LLM was added anywhere in this integration.
- No fake storage data, costs, or availability were created —
  `WarehouseStorageIntelligenceProvider` only ever reshapes real Part
  4/5 output, and `UnavailableStorageIntelligenceProvider` is honestly
  all-null rather than a plausible-looking fake.
- No circular dependency was introduced: `warehouse-intelligence` has no
  import of anything from a `sell-vs-store` module, in either direction.
- This is **not** a complete Part 6 in the same sense Parts 1–5 are
  complete for this codebase — the Module 8-side wiring above is real
  work still required, by someone with access to Module 8's actual
  source, before Module 8 will actually consume any of this.

