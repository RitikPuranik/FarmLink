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

