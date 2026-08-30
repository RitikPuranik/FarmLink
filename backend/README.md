# FarmLink Intelligence — Backend (Modules 1, 2 & 3)

SIH26132 — Strengthening market linkages and price discovery for farmers.
This backend currently covers:

- **Module 1** — identity, authentication, session management, and
  role-based access control.
- **Module 2** — Farmer & Farm Profile Management: farmer profiles, farms,
  farmer↔crop records, selling preferences, and the location/crop/FPO
  reference data behind them. Built entirely on top of Module 1's
  identity — no second auth system, no duplicate user table.
- **Module 3** — FPO Management & Farmer Aggregation: FPO registration/
  verification/administration, farmer membership requests + approval, the
  FPO member directory, crop-wise supply aggregation computed live from
  Module 2's farmer/farm/crop data, aggregation targets, FPO analytics,
  and a read-only government summary. Built entirely on top of Modules 1
  & 2 — the `Fpo` reference stub Module 2 added is extended in place, not
  duplicated; no second `PrismaClient`, no second RBAC system.

Every future FarmLink module (crop/lot management, quality grading, market
intelligence, buyers, logistics, warehouses…) is expected to consume the
identity Module 1 issues, the farmer/farm/crop data Module 2 issues, and
the FPO/membership/aggregation data Module 3 issues — not duplicate any of
them.

## Stack

Express + TypeScript, Prisma + PostgreSQL, Redis (rate limiting, optional),
Argon2id password hashing, JWT access tokens + rotating HttpOnly refresh
cookies, Zod validation, Swagger/OpenAPI, Jest + Supertest.

## Getting started

```bash
npm install
cp .env.example .env      # fill in real secrets — never commit .env
npx prisma generate
npx prisma migrate dev --name module_3_fpo_management
npm run prisma:seed       # demo farmer + Maharashtra reference data + crop catalog + demo FPO (verified, with an admin + 50 fictional members)
npm run dev
```

The API is at `http://localhost:4000`, docs at `http://localhost:4000/api/docs`.

> **Note on this build environment:** the sandbox this project was built in
> could not reach `binaries.prisma.sh` to download Prisma's query/schema
> engine binaries, so `prisma generate`/`migrate` could not be run here —
> true for Module 1 originally, Module 2, and Module 3 now. Everything
> else — repository/service/controller logic, RBAC, ownership checks,
> validation, the full Jest+Supertest suite (178 tests: 127 from Modules 1
> & 2 + 51 from Module 3) — was written and verified against in-memory fake
> repositories instead (`tests/testUtils/`). Run the commands above once on
> a machine with normal internet access and everything resolves normally;
> nothing about this limitation requires touching application code.

### Demo accounts (development only)

```
Farmer:     mobile 9876543210, password DemoFarmer123!
FPO admin:  mobile 9876500000, password DemoFpoAdmin123!  (of the seeded, VERIFIED demo FPO)
```

After seeding, the demo farmer has a complete Module 2 profile: a 4.5-acre
farm in Nashik (Niphad taluka, drip irrigation), Onion (primary) + Soybean,
and selling preferences set. The demo FPO ("Nashik Farmers Producer
Organization") is already `VERIFIED`/`ACTIVE`, has the FPO admin above as
its `PRIMARY_ADMIN`, and has 50 fictional farmer members spread across
Onion/Soybean/Wheat so `GET /api/fpos/:fpoId/crop-aggregation` and
`/analytics/overview` show real, non-trivial numbers immediately.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` / `npm start` | Production build + run |
| `npm test` | Full Jest suite (unit + integration, in-memory repos) |
| `npm run test:unit` / `test:integration` | Just one half of the suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:seed` | Seed demo farmer/FPO-admin + Module 2/3 reference/demo data |

## Architecture

```
src/
  config/       env validation, logger, prisma client, redis, swagger, sentry/posthog stubs
  common/       error classes, API response envelope, asyncHandler
  middleware/   error handler, 404, rate limiters, security headers, body/query/param validation
  modules/
    auth/             Module 1 — controller → service → repository, RBAC middleware, schemas, OTP abstraction
    audit/            audit log service (shared by all three modules)
    users/            minimal ADMIN-only demo route (proves RBAC end-to-end)
    farmers/          Module 2 — FarmerProfile CRUD, the profile+farms+crops aggregate, completion calculator
    farms/            Module 2 — farm CRUD, ownership-scoped
    crops/            Module 2 — farmer↔crop CRUD, atomic primary-crop transaction
    reference-data/   Module 2 — states/districts/talukas/crops/fpos/languages/irrigation-types
    fpo/              Module 3 — FPO registration/verification/admins, membership workflow,
                       crop aggregation + unit normalization, aggregation targets, analytics,
                       government summary (see "Module 3" below for the file breakdown)
  app.ts        Express app factory — takes injected dependencies, never touches Prisma directly
  server.ts     composition root — the only file that constructs the real PrismaClient
```

`app.ts` is dependency-injected on purpose:
`createApp({ authRepository, auditService, prisma, referenceDataRepository,
farmerProfileRepository, farmsRepository, farmerCropRepository,
fpoRepository, fpoAdminRepository, fpoMembershipRepository,
aggregationGroupRepository })`. Tests pass in-memory fakes for all of
these; `server.ts` passes the real Prisma-backed ones. This is also why
the test suite runs without a live database — see `tests/testUtils/`.

### Module 2 data model

```
User (Module 1)
  └── FarmerProfile (1:1) — fpoMembershipStatus, fpoId (self-declared, Module 2),
      │                     liquidityPreference, willingToStore, communicationPreference
      ├── Farm[]           — structured location (State → District → Taluka
      │     │                FKs + free-text village), area/unit, irrigation
      │     └── FarmerCrop[] — area, optional typical yield, isPrimary
      └── Fpo (optional self-declared reference)

Crop
  ├── CropTranslation[]   — en/hi/mr display names, never duplicate Crop rows
  └── FarmerCrop[]

State → District → Taluka  — normalized, Maharashtra-seeded, shaped for
                              any other state to be added without a schema change
```

Two deliberate departures from a literal reading of the build spec, both
explained in comments at the point of the decision:

- **No separate `FarmerPreferences` table.** Selling preferences
  (`fpoMembershipStatus`, `liquidityPreference`, `willingToStore`,
  `communicationPreference`) live directly on `FarmerProfile` — see the
  comment above that model in `prisma/schema.prisma`.
- **`profileCompletionPercentage` is not a stored column.** It's computed
  on every read from the current farms/crops/preferences
  (`modules/farmers/completion.ts`), so it can never drift out of sync the
  way a stored-and-forgotten-to-recompute value could.

### Module 3 data model

```
Fpo (extended in place from Module 2's minimal stub — id/name/districtId/
     active are unchanged in meaning; a farmer's Module 2 self-declared
     fpoId can still point here)
  ├── FpoAdmin[]           — (userId, fpoId) -> role/status; the only source
  │                          of truth for "can this FPO_ADMIN manage this FPO"
  ├── FpoMembership[]      — admin-approved join workflow, separate from
  │     │                    FarmerProfile.fpoMembershipStatus (Module 2)
  │     └── farmer: FarmerProfile (Module 2) -> Farm[] -> FarmerCrop[]
  └── AggregationGroup[]   — planning target only (never a sale/order/
                             contract/lot/shipment); references Crop directly
```

Crop-wise **estimated supply** itself is not a stored table — it's
computed live by `FpoAggregationService.computeCropAggregation()` from
active `FpoMembership` rows -> their `FarmerCrop` rows, normalized to KG
via `modules/fpo/unit-conversion.ts` and converted back to QTL for display.

### Security model (what to point reviewers at)

- **Role is never client-supplied.** Same `.strict()` Zod treatment as
  Modules 1 & 2 on every Module 3 write schema — an unexpected field like a
  smuggled `farmerId` on a membership request is rejected outright or
  simply never read.
- **`FpoAuthorizationService.canManageFpo(user, fpoId)` is the single
  ownership check every FPO-scoped admin action goes through** — an
  `FPO_ADMIN` role alone never implies access to a specific FPO; an active
  `FpoAdmin` row for that exact `(userId, fpoId)` pair (or platform
  `ADMIN`) is required. See `tests/integration/fpo.security.test.ts`'s
  "FPO Admin A cannot manage FPO B" suite (build spec's mandatory
  cross-FPO test).
- **Every URL path id (`:fpoId`, `:membershipId`, `:aggregationId`) is a
  `publicId`**, resolved to an internal id server-side before any query —
  never the raw database primary key.
- **State transitions are atomic and idempotent-safe.**
  `FpoMembershipRepository.transition()` / `AggregationGroupRepository.transition()`
  only apply a change if the row is still in one of the expected starting
  statuses (inside a DB transaction in the Prisma implementation); a
  double-approval or double-cancel gets a clear 409, never a corrupted or
  silently-reapplied state.
- **Crop-aggregation never invents a number.** Missing `typicalYield` or an
  unrecognized `yieldUnit` string excludes that farmer's row from the sum
  (never treated as zero); the response's `estimateCoverage` field always
  says how many of the counted farmers actually contributed a number.
- **Aggregation reads Module 2 data in O(1) queries, not per-farmer.**
  `computeCropAggregation` does one query for active member ids and one
  batched query (`WHERE farmerProfileId IN (...)`) for all of their crop
  rows, then groups in memory — see the doc comment on that method.
- **Government access is read-only.** Every `/api/government/*` route is a
  `GET`; `GOVERNMENT_VIEWER` cannot reach any mutating Module 3 endpoint
  (enforced the same way as every other role — `requireRole`/
  `requireAnyRole` — not a separate check).
- **Backend is authoritative** (unchanged from Modules 1 & 2):
  `authenticate()` re-verifies the JWT and re-checks account status on
  every request; FPO/crop ids are always verified server-side.

See `tests/integration/fpo.security.test.ts` for Module 3's full security
suite (cross-FPO IDOR, farmer-identity spoofing, government read-only,
role spoofing) — mirroring `rbac.security.test.ts` and the Module 2
ownership-isolation tests it sits alongside.

## What's intentionally not in Module 3

Per the build spec: no crop lots, quality grading, market intelligence,
price forecasting, sell-vs-store decisioning, warehouse management, buyer
matching, offers/RFQ, transport/shipment, payments, or grievances.
`AggregationGroup` is a planning object only, never a commitment — Module
3 exposes a forward-compatible service seam
(`FpoAggregationService.getFpoCropAvailability(fpoId, cropId)`) for the
future Buyer Matching module to consume rather than inventing a fake
`lotId` today. See "What's next" in the top-level README for exactly which
future module consumes which Module 3 piece.

