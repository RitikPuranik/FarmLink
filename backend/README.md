# FarmLink Intelligence — Backend (Modules 1 & 2)

SIH26132 — Strengthening market linkages and price discovery for farmers.
This backend currently covers:

- **Module 1** — identity, authentication, session management, and
  role-based access control.
- **Module 2** — Farmer & Farm Profile Management: farmer profiles, farms,
  farmer↔crop records, selling preferences, and the location/crop/FPO
  reference data behind them. Built entirely on top of Module 1's
  identity — no second auth system, no duplicate user table.

Every future FarmLink module (market prices, buyers, logistics,
warehouses…) is expected to consume the identity Module 1 issues and the
farmer/farm/crop data Module 2 issues, not duplicate either.

## Stack

Express + TypeScript, Prisma + PostgreSQL, Redis (rate limiting, optional),
Argon2id password hashing, JWT access tokens + rotating HttpOnly refresh
cookies, Zod validation, Swagger/OpenAPI, Jest + Supertest.

## Getting started

```bash
npm install
cp .env.example .env      # fill in real secrets — never commit .env
npx prisma generate
npx prisma migrate dev --name module_2_farmer_farm_profile
npm run prisma:seed       # demo farmer with a full Module 2 profile + Maharashtra reference data + crop catalog
npm run dev
```

The API is at `http://localhost:4000`, docs at `http://localhost:4000/api/docs`.

> **Note on this build environment:** the sandbox this project was built in
> could not reach `binaries.prisma.sh` to download Prisma's query/schema
> engine binaries, so `prisma generate`/`migrate` could not be run here —
> true for both Module 1 originally and Module 2 now. Everything else —
> repository/service/controller logic, RBAC, ownership checks, validation,
> the full Jest+Supertest suite (127 tests: 72 from Module 1 + 55 from
> Module 2) — was written and verified against in-memory fake repositories
> instead (`tests/testUtils/`). `eslint` is clean. Run the commands above
> once on a machine with normal internet access and everything resolves
> normally; nothing about this limitation requires touching application
> code.

### Demo account (development only)

```
Mobile:    9876543210
Password:  DemoFarmer123!
```

After seeding, this account has a complete Module 2 profile: a 4.5-acre
farm in Nashik (Niphad taluka, drip irrigation), Onion (primary) + Soybean,
membership in the seeded demo FPO, and selling preferences set — so you can
see every screen fully populated immediately.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` / `npm start` | Production build + run |
| `npm test` | Full Jest suite (unit + integration, in-memory repos) |
| `npm run test:unit` / `test:integration` | Just one half of the suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:seed` | Seed the demo farmer + Module 2 reference/demo data |

## Architecture

```
src/
  config/       env validation, logger, prisma client, redis, swagger, sentry/posthog stubs
  common/       error classes, API response envelope, asyncHandler
  middleware/   error handler, 404, rate limiters, security headers, body/query/param validation
  modules/
    auth/             Module 1 — controller → service → repository, RBAC middleware, schemas, OTP abstraction
    audit/            audit log service (shared by both modules)
    users/            minimal ADMIN-only demo route (proves RBAC end-to-end)
    farmers/          Module 2 — FarmerProfile CRUD, the profile+farms+crops aggregate, completion calculator
    farms/            Module 2 — farm CRUD, ownership-scoped
    crops/             Module 2 — farmer↔crop CRUD, atomic primary-crop transaction
    reference-data/   Module 2 — states/districts/talukas/crops/fpos/languages/irrigation-types
  app.ts        Express app factory — takes injected dependencies, never touches Prisma directly
  server.ts     composition root — the only file that constructs the real PrismaClient
```

`app.ts` is dependency-injected on purpose:
`createApp({ authRepository, auditService, prisma, referenceDataRepository,
farmerProfileRepository, farmsRepository, farmerCropRepository })`. Tests
pass in-memory fakes for all of these; `server.ts` passes the real
Prisma-backed ones. This is also why the test suite runs without a live
database — see `tests/testUtils/`.

### Module 2 data model

```
User (Module 1)
  └── FarmerProfile (1:1) — fpoMembershipStatus, fpoId, liquidityPreference,
      │                     willingToStore, communicationPreference
      ├── Farm[]           — structured location (State → District → Taluka
      │     │                FKs + free-text village), area/unit, irrigation
      │     └── FarmerCrop[] — area, optional typical yield, isPrimary
      └── Fpo (optional reference)

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

### Security model (what to point reviewers at)

- **Role is never client-supplied.** `registerRequestSchema` uses Zod's
  `.strict()`, so a `role` field anywhere in a registration payload makes
  the *whole request* fail validation. Same `.strict()` treatment on every
  Module 2 write schema (`farms.schemas.ts`, `crops.schemas.ts`,
  `farmers.schemas.ts`) — an unexpected field like a smuggled `farmerId` or
  `profileCompletionPercentage` is rejected outright, not silently ignored.
- **Ownership is always derived from the session, never the request.**
  Every farm/crop self-service method resolves the caller's
  `FarmerProfile` from `req.user.id` first, then checks the target
  row's `farmerProfileId` against it — a farm or crop belonging to another
  farmer 404s (or, for adding a crop to someone else's farm, 403s, per the
  build spec's explicit error-case table) rather than exposing whether the
  resource exists at all.
- **Primary-crop switches are one DB transaction.**
  `FarmerCropRepository.setPrimary` unsets the previous primary and sets
  the new one atomically — a farm can never end up with two primary crops,
  or zero, because of a request that fails halfway.
- **Every foreign reference is verified server-side.** Crop ids, FPO ids,
  and state/district/taluka chains are all checked against the database —
  never trusted from the client, and an inconsistent chain (e.g. a taluka
  from the wrong district) is a 400, not silently accepted.
- **Backend is authoritative** (unchanged from Module 1): `authenticate()`
  re-verifies the JWT and re-checks account status on every request.
- **No location leakage.** Farm coordinates are only ever returned to the
  owning farmer's own authenticated requests, and are explicitly excluded
  from PostHog analytics (`BLOCKED_PROPERTY_KEYS` in `config/posthog.ts`).

See `tests/integration/rbac.security.test.ts` for Module 1's security
suite, and `tests/integration/{farms,crops}.flow.test.ts` for Module 2's
ownership-isolation tests (a full "Farmer A cannot touch Farmer B's
farm/crop" suite for every mutating endpoint).

## What's intentionally not in Module 2

Per the build spec: no market prices, mandi API integration, price
forecasting, sell-vs-store decisioning, buyer matching, offers, warehouse
management, transport/shipment, payments, or grievances. Module 2 only
creates the data structures those modules will need to consume (farm
location, `willingToStore`/`liquidityPreference`, farmer↔crop records) —
see "What's next" in the top-level README for exactly which future module
consumes which field.
