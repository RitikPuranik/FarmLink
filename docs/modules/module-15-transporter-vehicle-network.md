# Module 15 — Transporter & Vehicle Network

## Purpose

A **registry layer**, not a logistics engine. It answers:

- Who are the available transporters?
- What vehicles do they operate, and what capacity/capabilities do those
  vehicles have?
- Where do they operate (declared service areas)?
- Has FarmLink verified this transporter/vehicle, per its own
  administrative workflow?

It deliberately does **not** answer "which transporter is cheapest," "what
route should a vehicle take," or "what is the optimized logistics price" —
those are Module 16 (Logistics Quote & Optimization) and later. This
module never fabricates a rate, distance, ETA, fuel cost, per-km charge,
driver location, GPS coordinate, or route — every field it stores is
either directly declared by a transporter or set by an administrator.

```
Transporter Profile
        │
        ▼
Vehicle Registry ── Vehicle Capabilities/Capacity
        │
        ▼
Service Areas (administrative/geographic, never a route or GPS radius)
        │
        ▼
Availability (manually set AVAILABLE/UNAVAILABLE only)
        │
        ▼
Verification (FarmLink's own workflow, not a government/RTO claim)
        │
        ▼
Transporter Discovery (pure filtering, never ranking or pricing)
```

## Parts A–Z status

| Part | Scope | Status |
| --- | --- | --- |
| A | Data model (`TransporterProfile`) | Done |
| B | Role/RBAC — `TRANSPORTER` already existed in `UserRole`; no enum change needed | Done |
| C | Vehicle data model (`Vehicle`) | Done |
| D | Vehicle capabilities (`VehicleCapability[]` enum array + `isRefrigerated` boolean) | Done |
| E | Capacity (`capacityUnit` + canonical `capacityKg`, reusing `modules/fpo/unit-conversion.ts`) | Done |
| F | Service areas (`TransporterServiceArea`) | Done |
| G | Vehicle availability (`VehicleAvailabilityStatus`) | Done |
| H | Driver information (`VehicleDriver`) | Schema-only foundation (see below) |
| I | Transporter verification workflow | Done |
| J | Vehicle verification workflow | Done |
| K | Repository layer | Done |
| L | Service layer | Done |
| M | Registration number normalization | Done |
| N | Transporter discovery | Done |
| O | Authorization | Done |
| P | REST API | Done |
| Q | Request validation (Zod) | Done |
| R | Domain errors | Done |
| S | DTO mapping | Done |
| T | Audit logging | Done |
| U | PostHog | Done |
| V | Sentry | Reuses existing global Sentry error handler; no module-specific instrumentation added (nothing in this module does external I/O that needs its own capture context) |
| W | Caching | Not introduced — discovery queries are indexed and paginated; adding Redis here would be premature optimization for a filtering endpoint that doesn't yet have real traffic |
| X | Swagger | Done — every route documented inline; description clarifies "verified" and "available" |
| Y | Testing | Done — 97 new tests (76 unit + 21 integration) |
| Z | Performance | Bounded queries throughout — see "Performance" below |

## Data model

- **`TransporterProfile`** — one per `User` (`userId @unique`), business
  contact info, `verificationStatus` (`PENDING`/`VERIFIED`/`REJECTED`/`SUSPENDED`),
  `isActive`. `publicId` is the externally-facing identifier.
- **`Vehicle`** — belongs to exactly one `TransporterProfile`
  (`transporterId`), never duplicates transporter fields. Capacity, type,
  capabilities, operational `status`, `verificationStatus`, and
  `availabilityStatus` all live here.
- **`TransporterServiceArea`** — administrative/geographic only
  (`STATE`/`DISTRICT`/`CITY`/`PINCODE` + the matching `state`/`district`/
  `city`/`pincode` columns). Never a route, radius, or GPS coordinate.
- **`VehicleDriver`** — one optional driver per vehicle. **Schema-only
  foundation**: no route in this module reads or writes it, since the
  module's own endpoint list (Part P) never included driver endpoints,
  and driver authentication/mobile-app support is explicitly out of
  scope. `phone`/`licenseNumber` are PII and are never returned by any
  DTO in this module.

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
