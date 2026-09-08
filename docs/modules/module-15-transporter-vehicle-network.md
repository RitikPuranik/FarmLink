# Module 15 — Transporter & Vehicle Network

## Purpose

A **registry layer**, not a logistics engine. It answers:

- Who are the available transporters — individual owner-operators,
  small businesses, companies, cooperatives, and logistics providers
  alike?
- What vehicles does each provider operate, and what capacity/capabilities
  do those vehicles have?
- Where do they operate (declared service areas)?
- Has FarmLink verified this transporter/vehicle, per its own
  administrative workflow?

It deliberately does **not** answer "which transporter is cheapest," "what
route should a vehicle take," or "what is the optimized logistics price" —
those are Module 16 (Logistics Quote & Optimization) and later. This
module never fabricates a rate, distance, ETA, fuel cost, per-km charge,
driver location, GPS coordinate, or route — every field it stores is
either directly declared by a transporter or set by an administrator.

**A transporter profile is a transport *provider*, not a truck.** The same
`TransporterProfile -> Vehicle[]` relationship represents everything from
Ramesh, an individual who owns two trucks, to ABC Logistics Pvt Ltd, a
company managing a hundred — one provider, many vehicles, each with its
own independent availability. See "Provider types" below.

```
Transport Provider (individual, business, company, cooperative, or
logistics provider — see providerType)
        │
        ▼
Vehicle Registry ── Vehicle Capabilities/Capacity
        │
        ▼
Service Areas (administrative/geographic, never a route or GPS radius)
        │
        ▼
Availability (manually set AVAILABLE/UNAVAILABLE only, per vehicle —
              never at the provider level)
        │
        ▼
Verification (FarmLink's own workflow, not a government/RTO claim)
        │
        ▼
Transporter Discovery (pure filtering, never ranking or pricing)
```

## Architecture correction (provider/fleet clarification)

An inspection of the existing implementation (prompted by a request to
correct/enhance the domain to properly model real-world transport
providers) found that **`TransporterProfile -> Vehicle[]` was already
correct**: a provider could already own any number of vehicles, and
availability was already tracked per vehicle, not per provider. No
schema redesign, renaming, or restructuring of that relationship was
needed or made.

The one genuine gap: nothing distinguished *what kind* of provider a
profile represented — an individual owner-operator looked structurally
identical to a company in the schema, with the difference only implied by
whether `businessName` happened to be set. The fix was additive only:

- Added `enum TransportProviderType { INDIVIDUAL, BUSINESS, COMPANY,
  COOPERATIVE, LOGISTICS_PROVIDER }` and a `providerType` column on
  `TransporterProfile` (defaults to `INDIVIDUAL`, indexed).
- Added an optional `legalName` column, distinct from the trading name in
  `businessName` (e.g. `businessName` "ABC Logistics", `legalName` "ABC
  Logistics Private Limited") — for providers that have one; never
  required.
- Added an optional `providerType` filter to transporter discovery
  (`GET /api/transporters`).
- Added a bulk vehicle-onboarding endpoint (`POST /api/vehicles/bulk`,
  Step 11 below) for fleet operators registering many vehicles at once,
  since Vehicle already supported any number of vehicles per provider but
  registering them one at a time doesn't scale to a 50+ truck fleet.

Nothing about `Vehicle`, `VehicleDriver`, `TransporterServiceArea`,
authorization, or the verification/status state machines changed —
those were already correct for this architecture and are unaffected.

**Deliberately not built** (per the "don't overengineer" instruction):
`ProviderUser`/multiple organization users, fleet managers, dispatchers,
driver scheduling, or shift management. `TransportProvider -> Vehicle[]`
already scales cleanly to a 100-truck company without any of these —
they would only matter once a company needs *several logged-in accounts*
managing the same fleet, which is future work (see "Future compatibility"
below), not something the current one-user-per-profile MVP needs.

## Parts A–Z status

| Part | Scope | Status |
| --- | --- | --- |
| A | Data model (`TransporterProfile`, now with `providerType`/`legalName`) | Done |
| B | Role/RBAC — `TRANSPORTER` already existed in `UserRole`; no enum change needed | Done |
| C | Vehicle data model (`Vehicle`) | Done — already 1 provider : N vehicles before this change |
| D | Vehicle capabilities (`VehicleCapability[]` enum array + `isRefrigerated` boolean) | Done |
| E | Capacity (`capacityUnit` + canonical `capacityKg`, reusing `modules/fpo/unit-conversion.ts`) | Done |
| F | Service areas (`TransporterServiceArea`) | Done |
| G | Vehicle availability (`VehicleAvailabilityStatus`) | Done — already per-vehicle, never per-provider |
| H | Driver information (`VehicleDriver`) | Schema-only foundation (see below) |
| I | Transporter verification workflow | Done |
| J | Vehicle verification workflow | Done |
| K | Repository layer | Done |
| L | Service layer | Done |
| M | Registration number normalization | Done |
| N | Transporter discovery | Done — now also filterable by `providerType` |
| O | Authorization | Done |
| P | REST API | Done — added `POST /api/vehicles/bulk` |
| Q | Request validation (Zod) | Done |
| R | Domain errors | Done |
| S | DTO mapping | Done — added `providerType`/`legalName` |
| T | Audit logging | Done — added `VEHICLE_BULK_REGISTERED` |
| U | PostHog | Done |
| V | Sentry | Reuses existing global Sentry error handler; no module-specific instrumentation added (nothing in this module does external I/O that needs its own capture context) |
| W | Caching | Not introduced — discovery queries are indexed and paginated; adding Redis here would be premature optimization for a filtering endpoint that doesn't yet have real traffic |
| X | Swagger | Done — every route documented inline; description clarifies "verified", "available", and that a provider is not one truck |
| Y | Testing | Done — 97 original tests (76 unit + 21 integration) + 11 new tests for `providerType` and bulk onboarding (108 total: 85 unit + 24 integration) |
| Z | Performance | Bounded queries throughout — see "Performance" below |

## Data model

- **`TransporterProfile`** — one per `User` (`userId @unique`), represents
  a transport **provider**: an individual owner-operator, business,
  company, cooperative, or logistics provider (`providerType`, defaults
  `INDIVIDUAL`), business contact info, optional `legalName`,
  `verificationStatus` (`PENDING`/`VERIFIED`/`REJECTED`/`SUSPENDED`),
  `isActive`. `publicId` is the externally-facing identifier.
- **`Vehicle`** — belongs to exactly one `TransporterProfile`
  (`transporterId`), never duplicates transporter fields. Capacity, type,
  capabilities, operational `status`, `verificationStatus`, and
  `availabilityStatus` all live here — **a provider with 50 vehicles has
  50 independent availability flags**, not one.
- **`TransporterServiceArea`** — administrative/geographic only
  (`STATE`/`DISTRICT`/`CITY`/`PINCODE` + the matching `state`/`district`/
  `city`/`pincode` columns). Never a route, radius, or GPS coordinate.
- **`VehicleDriver`** — one optional driver per vehicle. **Schema-only
  foundation**: no route in this module reads or writes it, since the
  module's own endpoint list (Part P) never included driver endpoints,
  and driver authentication/mobile-app support is explicitly out of
  scope. `phone`/`licenseNumber` are PII and are never returned by any
  DTO in this module.

### Provider types

```
providerType: INDIVIDUAL | BUSINESS | COMPANY | COOPERATIVE | LOGISTICS_PROVIDER
```

Every value uses the exact same `TransporterProfile -> Vehicle[]`
relationship — `providerType` only labels what the profile represents,
it never changes how vehicles are owned, authorized, or queried:

- **Individual** — e.g. Ramesh Transport, `providerType: INDIVIDUAL`,
  owns 2 vehicles.
- **Company** — e.g. ABC Logistics Pvt Ltd, `providerType: COMPANY`,
  owns 50+ vehicles, may set `legalName` ("ABC Logistics Private
  Limited") alongside the trading `businessName` ("ABC Logistics").

Existing rows created before this field existed default to `INDIVIDUAL`
(the migration's column default) — no historical data was reinterpreted
or required to change.

### Capacity (Part E)

Same convention `CropLot`/`Warehouse` already use: the transporter
declares a value + unit (`KG`/`QTL`/`TONNE`), which is converted once via
the shared `convertQuantityToKg`/`convertKgToQuantity` helpers
(`modules/fpo/unit-conversion.ts` — the same utility Module 3's FPO
aggregation and Module 9's warehouse intelligence already import) into a
canonical `capacityKg` `Decimal(12,2)` column. Discovery's
`minimumCapacity` filter is therefore a single indexed comparison
(`capacityKg >= x`), never a per-row unit conversion. Validation rejects
non-finite, zero, negative, or unsupported-unit input before it ever
reaches the database (`vehicle-capacity.ts`).

### Vehicle capabilities (Part D)

A controlled `VehicleCapability` enum array
(`COVERED`/`OPEN_BODY`/`TEMPERATURE_CONTROLLED`/`BULK_TRANSPORT`/
`SMALL_LOAD_SUITABLE`/`LARGE_LOAD_SUITABLE`) — never free text.
"Refrigerated" is deliberately **not** a member of this enum: it is
already its own indexed boolean (`Vehicle.isRefrigerated`), since it is
by far the most common discovery filter (Part N).

### Registration number normalization (Part M)

`normalizeRegistrationNumber()` strips whitespace/hyphens and uppercases,
so `"MH12AB1234"`, `"MH-12-AB-1234"`, `"mh12ab1234"`, and
`"MH 12 AB 1234"` all collide on the same `normalizedRegistrationNumber
@unique` column. `registrationNumber` (the as-typed display form) is
stored separately. `validateRegistrationNumber()` does light shape
validation only (4–12 alphanumeric characters) — this is **never** a
claim of government/RTO validation, only internal duplicate prevention.
A race between two concurrent registrations of the same normalized plate
is caught by the database's unique constraint and surfaced as a 409, not
just the application-level pre-check. This applies identically to the
single (`POST /api/vehicles`) and bulk (`POST /api/vehicles/bulk`) paths.

## Authorization (Part O)

- Every "my profile"/"my vehicles"/"my service areas" action resolves the
  caller's own `TransporterProfile` via `userId` — a `transporterId` is
  never accepted from the client for these endpoints. This applies
  identically regardless of `providerType`: a `COMPANY` profile is
  resolved and authorized exactly like an `INDIVIDUAL` one.
- `VehicleService.loadOwnedOrThrow` re-checks that a vehicle's
  `transporterId` matches the caller's own profile on every single-vehicle
  operation (get/update/availability/status), and returns a plain 404
  (never a 403) for a cross-tenant access attempt, so a transporter can't
  learn that a given vehicle publicId exists at all.
- Bulk registration (`POST /api/vehicles/bulk`) resolves the caller's own
  profile the same way as single registration — every vehicle in the
  batch is created under that one profile; there is no way to target a
  different provider's fleet by manipulating the request body, since no
  item in the batch accepts a `transporterId`.
- `ADMIN` bypasses ownership checks for verification and suspension only
  — every admin route is additionally gated by `requireRole("ADMIN")` at
  the router, matching the existing FPO admin convention.
- Vehicle `SUSPENDED` status may only be set by an admin (checked
  explicitly in `VehicleService.updateStatus`, in addition to router-level
  role checks), and only an admin can reactivate a suspended vehicle.

## Verification workflows (Parts I/J)

Both are deterministic transition maps — an invalid transition throws
`TransporterDomainError` with `INVALID_VERIFICATION_TRANSITION` (409),
never silently succeeds:

- **Transporter**: `PENDING → VERIFIED/REJECTED`, `VERIFIED → SUSPENDED`,
  `SUSPENDED → VERIFIED`. `REJECTED` is terminal — a rejected transporter
  re-applies as a conscious new action, never auto-un-rejected.
- **Vehicle**: `PENDING → VERIFIED/REJECTED` only. No further transitions
  exist (Part J is explicit that this is simpler than the transporter's
  own suspend/reactivate cycle).

"Verified" means **verified per FarmLink's own administrative workflow**
in both cases — this module has no RTO/government registry integration,
and the Swagger docs for both admin verification routes say so
explicitly.

## Transporter discovery (Part N)

`GET /api/transporters` combines two kinds of filters in one paginated
query:

- **Vehicle-level** (`vehicleType`, `minimumCapacity`, `refrigerated`,
  `availability`) — resolved first via `VehicleRepository.discover()`,
  which returns the distinct `transporterId`s of matching vehicles.
- **Transporter-level** (`state`, `district`, `providerType`, `verified`)
  — applied directly in `TransporterRepository.search()`, intersected
  with the vehicle-filtered id set when both kinds of filters are
  present.

If a vehicle-level filter matches zero vehicles anywhere, the service
short-circuits to an empty page rather than letting an empty `id: { in:
[] }` behave like "no filter." This is pure filtering — there is no
ranking, scoring, or price computation anywhere in this path.

## API (Part P)

**Transporter profile**
- `POST /api/transporter-profiles` — create own profile (`TRANSPORTER`);
  accepts `providerType` (defaults `INDIVIDUAL`)
- `GET /api/transporter-profiles/me` — own profile
- `PATCH /api/transporter-profiles/me` — update own profile (including
  `providerType`/`legalName`)
- `GET /api/transporters/:publicId` — PII-safe public profile
- `GET /api/transporters` — discovery (paginated, filtered, including by
  `providerType`)

**Service areas**
- `POST /api/transporter-profiles/me/service-areas`
- `GET /api/transporter-profiles/me/service-areas`
- `DELETE /api/transporter-profiles/me/service-areas/:id`

**Vehicles**
- `POST /api/vehicles` — register one vehicle
- `POST /api/vehicles/bulk` — register up to 50 vehicles in one
  transaction (Step 11 — see below)
- `GET /api/vehicles` — list own (paginated)
- `GET /api/vehicles/:publicId` — get (owner or admin)
- `PATCH /api/vehicles/:publicId` — update declared attributes
- `PATCH /api/vehicles/:publicId/availability` — `AVAILABLE`/`UNAVAILABLE` only
- `PATCH /api/vehicles/:publicId/status` — `ACTIVE`/`INACTIVE`/`MAINTENANCE`/`SUSPENDED`

**Admin**
- `PATCH /api/admin/transporters/:publicId/verification`
- `PATCH /api/admin/vehicles/:publicId/verification`

All documented inline via `@openapi` JSDoc blocks (auto-scanned by the
existing `swagger.ts` glob — no separate registration needed), including
explicit notes that `AVAILABLE` is never a confirmed booking and
`VERIFIED` is never a government/RTO claim.

### Bulk vehicle onboarding (Step 11)

`POST /api/vehicles/bulk` accepts `{ vehicles: [...] }` (1–50 items, same
shape as a single `POST /api/vehicles` body each). It is deliberately
**all-or-nothing, not partial-processing**:

1. Every item is validated (registration number shape, capacity) before
   anything is written. Any invalid item fails the whole request with
   422/400 — no vehicles are created.
2. Normalized registration numbers are checked for duplicates *within
   the batch itself* (e.g. the same plate typed twice with different
   casing), and against every existing vehicle in the database, in a
   single query — any duplicate fails the whole request with 409.
3. All vehicles that pass both checks are created in a single database
   transaction (`VehicleRepository.createMany`, backed by
   `prisma.$transaction`) — either every vehicle is persisted, or (e.g.
   on a race-condition unique-constraint hit) none are.

This trades "report per-item success/failure for a partially-applied
batch" for "never leave an inconsistent fleet behind," per the
instruction not to compromise correctness for a convenience endpoint.
A fleet operator whose batch is rejected gets a clear reason (which
index, and why) and can safely resubmit the whole batch after fixing it.

## Observability

- **Audit** (`audit.service.ts`): `TRANSPORTER_PROFILE_CREATED/UPDATED`,
  `TRANSPORTER_VERIFIED/REJECTED/SUSPENDED/REACTIVATED`,
  `VEHICLE_REGISTERED/BULK_REGISTERED/UPDATED/AVAILABILITY_UPDATED/STATUS_UPDATED/VERIFIED/REJECTED`,
  `SERVICE_AREA_ADDED/REMOVED`. Vehicle registration numbers, driver
  phone numbers, and driver license numbers are never written to
  audit metadata; bulk registration's audit entry records only the
  count of vehicles created, not their plates.
- **PostHog** (`posthog.ts`): `transporter_profile_created`,
  `transporter_verified`, `transporter_suspended`, `vehicle_registered`
  (fired for both single and bulk registration — bulk additionally sets
  `bulk: true` and `count`), `vehicle_availability_updated`,
  `vehicle_verified` — all allow-listed, and
  `phone`/`licenseNumber`/`registrationNumber` are additionally blocked
  at the property-key level as defense-in-depth.
- **Sentry**: reuses the existing global error handler; nothing in this
  module performs external I/O that needs its own capture context.

## Performance (Part Z)

- Every list endpoint (`/vehicles`, `/transporters`,
  `/transporter-profiles/me/service-areas`) is paginated with a `limit`
  cap of 100. Bulk vehicle registration is capped at 50 items per
  request, keeping its single transaction bounded.
- `capacityKg`, `transporterId`, `vehicleType`, `status`,
  `verificationStatus`, and `availabilityStatus` are all indexed on
  `Vehicle`; `verificationStatus`/`isActive`/`providerType` on
  `TransporterProfile`; `transporterId`/`state`/`district` on
  `TransporterServiceArea`.
- Discovery's transporter-count/service-area lookups for a page of
  results use `countVehiclesForMany`/`listServiceAreasForMany` (bulk
  `groupBy`/`findMany` with `id: { in: [...] }`) rather than N+1 queries
  per transporter in the page. Bulk registration's duplicate check
  likewise uses one `findMany` with `normalizedRegistrationNumber: {
  in: [...] }` rather than one query per item.

## Future compatibility (documented, not implemented)

The current MVP is deliberately one `User` per `TransporterProfile`. This
does not block the target architecture — a `TransporterProfile` already
supports any fleet size — but a real logistics company will eventually
want more than one login managing the same provider (an owner, a fleet
manager, a dispatcher). That would take a `ProviderUser`-style join table
between `User` and `TransporterProfile` with its own role. **This is
explicitly not implemented** — it would be premature for the current
scale, and the existing schema (a `providerType` clarifying what the
profile represents, independent of how many users manage it) does not
make this expansion harder later. Also explicitly future work, not
implemented here: fleet managers/dispatchers as distinct roles, driver
scheduling/shift management, and everything Module 16/17/18/19 own
(logistics quotes, route optimization, GPS/shipment tracking, payment
status).

## Explicit non-goals (confirmed NOT implemented)

Logistics price calculation, transport quote generation, route
optimization, distance/ETA/fuel-cost calculation, per-km rates, shipment
creation, GPS/live vehicle tracking, a driver mobile app, payment
processing, a transaction ledger, AI/ML optimization, fake transporter or
availability seed data, external RTO/government registry verification,
and a full organization-user management system (`ProviderUser`, fleet
managers, dispatchers — see "Future compatibility" above). These are
Module 16 (Logistics Quote & Optimization), Module 17 (Shipment & GPS
Tracking), Module 18 (Delivery & Quality Reconciliation), and Module 19
(Payment Status Tracking), or explicitly deferred future work.

## Known limitations of this sandbox

`npx prisma generate`/`format`/`validate` cannot run here —
`binaries.prisma.sh` returns 403 Forbidden (see
`backend/prisma/README-engines.md`, a pre-existing limitation predating
this module, confirmed still present when this architecture correction
was made). This also means `tsc --noEmit` reports spurious "has no
exported member" errors for *every* Prisma-derived type across the whole
backend — including types that existed before this change
(`VehicleType`, `QuantityUnit`, etc.) — not just the new
`TransportProviderType`; this is an environment artifact, not a real
type error. All Module 15 code (original and this correction) was
written and unit/integration-tested against hand-typed interfaces and
mocked repositories (108 tests, all passing) rather than a generated
client; the schema and both migrations should be verified with `npx
prisma generate && npx prisma migrate deploy` (or `validate`) on a
machine with normal internet access before this ships to a real
database.

Same convention `CropLot`/`Warehouse` already use: the transporter
declares a value + unit (`KG`/`QTL`/`TONNE`), which is converted once via
the shared `convertQuantityToKg`/`convertKgToQuantity` helpers
(`modules/fpo/unit-conversion.ts` — the same utility Module 3's FPO
aggregation and Module 9's warehouse intelligence already import) into a
canonical `capacityKg` `Decimal(12,2)` column. Discovery's
`minimumCapacity` filter is therefore a single indexed comparison
(`capacityKg >= x`), never a per-row unit conversion. Validation rejects
non-finite, zero, negative, or unsupported-unit input before it ever
reaches the database (`vehicle-capacity.ts`).

### Vehicle capabilities (Part D)

A controlled `VehicleCapability` enum array
(`COVERED`/`OPEN_BODY`/`TEMPERATURE_CONTROLLED`/`BULK_TRANSPORT`/
`SMALL_LOAD_SUITABLE`/`LARGE_LOAD_SUITABLE`) — never free text.
"Refrigerated" is deliberately **not** a member of this enum: it is
already its own indexed boolean (`Vehicle.isRefrigerated`), since it is
by far the most common discovery filter (Part N).

### Registration number normalization (Part M)

`normalizeRegistrationNumber()` strips whitespace/hyphens and uppercases,
so `"MH12AB1234"`, `"MH-12-AB-1234"`, `"mh12ab1234"`, and
`"MH 12 AB 1234"` all collide on the same `normalizedRegistrationNumber
@unique` column. `registrationNumber` (the as-typed display form) is
stored separately. `validateRegistrationNumber()` does light shape
validation only (4–12 alphanumeric characters) — this is **never** a
claim of government/RTO validation, only internal duplicate prevention.
A race between two concurrent registrations of the same normalized plate
is caught by the database's unique constraint and surfaced as a 409, not
just the application-level pre-check.

## Authorization (Part O)

- Every "my profile"/"my vehicles"/"my service areas" action resolves the
  caller's own `TransporterProfile` via `userId` — a `transporterId` is
  never accepted from the client for these endpoints.
- `VehicleService.loadOwnedOrThrow` re-checks that a vehicle's
  `transporterId` matches the caller's own profile on every single-vehicle
  operation (get/update/availability/status), and returns a plain 404
  (never a 403) for a cross-tenant access attempt, so a transporter can't
  learn that a given vehicle publicId exists at all.
- `ADMIN` bypasses ownership checks for verification and suspension only
  — every admin route is additionally gated by `requireRole("ADMIN")` at
  the router, matching the existing FPO admin convention.
- Vehicle `SUSPENDED` status may only be set by an admin (checked
  explicitly in `VehicleService.updateStatus`, in addition to router-level
  role checks), and only an admin can reactivate a suspended vehicle.

## Verification workflows (Parts I/J)

Both are deterministic transition maps — an invalid transition throws
`TransporterDomainError` with `INVALID_VERIFICATION_TRANSITION` (409),
never silently succeeds:

- **Transporter**: `PENDING → VERIFIED/REJECTED`, `VERIFIED → SUSPENDED`,
  `SUSPENDED → VERIFIED`. `REJECTED` is terminal — a rejected transporter
  re-applies as a conscious new action, never auto-un-rejected.
- **Vehicle**: `PENDING → VERIFIED/REJECTED` only. No further transitions
  exist (Part J is explicit that this is simpler than the transporter's
  own suspend/reactivate cycle).

"Verified" means **verified per FarmLink's own administrative workflow**
in both cases — this module has no RTO/government registry integration,
and the Swagger docs for both admin verification routes say so
explicitly.

## Transporter discovery (Part N)

`GET /api/transporters` combines two kinds of filters in one paginated
query:

- **Vehicle-level** (`vehicleType`, `minimumCapacity`, `refrigerated`,
  `availability`) — resolved first via `VehicleRepository.discover()`,
  which returns the distinct `transporterId`s of matching vehicles.
- **Transporter-level** (`state`, `district`, `verified`) — applied
  directly in `TransporterRepository.search()`, intersected with the
  vehicle-filtered id set when both kinds of filters are present.

If a vehicle-level filter matches zero vehicles anywhere, the service
short-circuits to an empty page rather than letting an empty `id: { in:
[] }` behave like "no filter." This is pure filtering — there is no
ranking, scoring, or price computation anywhere in this path.

## API (Part P)

**Transporter profile**
- `POST /api/transporter-profiles` — create own profile (`TRANSPORTER`)
- `GET /api/transporter-profiles/me` — own profile
- `PATCH /api/transporter-profiles/me` — update own profile
- `GET /api/transporters/:publicId` — PII-safe public profile
- `GET /api/transporters` — discovery (paginated, filtered)

**Service areas**
- `POST /api/transporter-profiles/me/service-areas`
- `GET /api/transporter-profiles/me/service-areas`
- `DELETE /api/transporter-profiles/me/service-areas/:id`

**Vehicles**
- `POST /api/vehicles` — register
- `GET /api/vehicles` — list own (paginated)
- `GET /api/vehicles/:publicId` — get (owner or admin)
- `PATCH /api/vehicles/:publicId` — update declared attributes
- `PATCH /api/vehicles/:publicId/availability` — `AVAILABLE`/`UNAVAILABLE` only
- `PATCH /api/vehicles/:publicId/status` — `ACTIVE`/`INACTIVE`/`MAINTENANCE`/`SUSPENDED`

**Admin**
- `PATCH /api/admin/transporters/:publicId/verification`
- `PATCH /api/admin/vehicles/:publicId/verification`

All documented inline via `@openapi` JSDoc blocks (auto-scanned by the
existing `swagger.ts` glob — no separate registration needed), including
explicit notes that `AVAILABLE` is never a confirmed booking and
`VERIFIED` is never a government/RTO claim.

## Observability

- **Audit** (`audit.service.ts`): `TRANSPORTER_PROFILE_CREATED/UPDATED`,
  `TRANSPORTER_VERIFIED/REJECTED/SUSPENDED/REACTIVATED`,
  `VEHICLE_REGISTERED/UPDATED/AVAILABILITY_UPDATED/STATUS_UPDATED/VERIFIED/REJECTED`,
  `SERVICE_AREA_ADDED/REMOVED`. Vehicle registration numbers, driver
  phone numbers, and driver license numbers are never written to
  audit metadata.
- **PostHog** (`posthog.ts`): `transporter_profile_created`,
  `transporter_verified`, `transporter_suspended`, `vehicle_registered`,
  `vehicle_availability_updated`, `vehicle_verified` — all allow-listed,
  and `phone`/`licenseNumber`/`registrationNumber` are additionally
  blocked at the property-key level as defense-in-depth.
- **Sentry**: reuses the existing global error handler; nothing in this
  module performs external I/O that needs its own capture context.

## Performance (Part Z)

- Every list endpoint (`/vehicles`, `/transporters`,
  `/transporter-profiles/me/service-areas`) is paginated with a `limit`
  cap of 100.
- `capacityKg`, `transporterId`, `vehicleType`, `status`,
  `verificationStatus`, and `availabilityStatus` are all indexed on
  `Vehicle`; `verificationStatus`/`isActive` on `TransporterProfile`;
  `transporterId`/`state`/`district` on `TransporterServiceArea`.
- Discovery's transporter-count/service-area lookups for a page of
  results use `countVehiclesForMany`/`listServiceAreasForMany` (bulk
  `groupBy`/`findMany` with `id: { in: [...] }`) rather than N+1 queries
  per transporter in the page.

## Explicit non-goals (confirmed NOT implemented)

Logistics price calculation, transport quote generation, route
optimization, distance/ETA/fuel-cost calculation, per-km rates, shipment
creation, GPS/live vehicle tracking, a driver mobile app, payment
processing, a transaction ledger, AI/ML optimization, fake transporter or
availability seed data, and external RTO/government registry
verification. These are Module 16 (Logistics Quote & Optimization),
Module 17 (Shipment & GPS Tracking), Module 18 (Delivery & Quality
Reconciliation), and Module 19 (Payment Status Tracking).

## Known limitations of this sandbox

`npx prisma generate`/`format`/`validate` cannot run here —
`binaries.prisma.sh` returns 403 Forbidden (see
`backend/prisma/README-engines.md`, a pre-existing limitation predating
this module). All Module 15 code was written and unit/integration-tested
against hand-typed interfaces and mocked repositories; the schema and
hand-written migration should be verified with `npx prisma generate &&
npx prisma migrate deploy` (or `validate`) on a machine with normal
internet access before this ships to a real database.
