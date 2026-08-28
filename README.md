# FarmLink Intelligence — Modules 1 & 2

**SIH26132** — Strengthening market linkages and price discovery for farmers.

This repository currently contains:

- **Module 1** — identity, authentication, session management, and
  role-based access control. The security foundation every later FarmLink
  module builds on.
- **Module 2** — Farmer & Farm Profile Management, built on top of Module
  1's identity. Farmer profiles, farms (a farmer may have several),
  farmer↔crop records, selling preferences (liquidity/storage/FPO/
  communication), and the normalized location + crop + FPO reference data
  that back them.

Market prices, buyer matching, warehouse/logistics, offers, payments,
shipments, and grievances are still explicitly out of scope — Module 2
only builds the data structures those modules will need (see "Future
compatibility" below), not the modules themselves.

```
farmlink/
  backend/    Express + TypeScript + Prisma/PostgreSQL API (see backend/README.md)
  frontend/   Next.js + TypeScript + Tailwind UI
  e2e/        Playwright end-to-end flow
```

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in real secrets
npx prisma generate
npx prisma migrate dev --name module_2_farmer_farm_profile
npm run prisma:seed           # demo farmer + Maharashtra locations + crop catalog + demo FPO
npm run dev                   # http://localhost:4000, docs at /api/docs

# 2. Frontend (separate terminal)
cd frontend
npm install
cp .env.example .env.local
npm run dev                   # http://localhost:3000

# 3. (optional) End-to-end test, once both are running
cd e2e
npm install
npx playwright install chromium
npm test
```

Demo login (after seeding): mobile `9876543210`, password `DemoFarmer123!`
— already has a complete Module 2 profile (a farm in Nashik, Onion +
Soybean, Onion set primary, FPO membership, selling preferences) so you can
see the dashboard/profile pages fully populated without doing the
onboarding flow yourself.

## What's implemented

### Module 1 — Authentication & RBAC

- Public registration (**FARMER only** — role is never client-supplied; see
  `backend/src/modules/auth/auth.schemas.ts` and the security tests in
  `backend/tests/integration/rbac.security.test.ts`)
- Login, JWT access tokens, rotating HttpOnly refresh-token sessions
- `GET /api/auth/me`, logout, logout-all-sessions
- Change password, forgot/reset password (single-use, short-lived, hashed tokens)
- Server-side RBAC for all 7 roles (`authenticate`, `requireRole`, `requireAnyRole`)
- Account status handling (`ACTIVE` / `PENDING_VERIFICATION` / `SUSPENDED` / `DEACTIVATED`)
- Rate limiting, Helmet + CORS, centralized error handling, audit logging
- Swagger/OpenAPI at `/api/docs`, Sentry/PostHog integration points (safe no-ops until configured)
- OTP provider abstraction (mock implementation only — no real SMS spend)

### Module 2 — Farmer & Farm Profile Management

**Data model** (`backend/prisma/schema.prisma`): `FarmerProfile` (1:1 with
`User`, holds FPO membership + liquidity/storage/communication
preferences), `Farm[]` (a farmer may have several — structured location via
normalized `State → District → Taluka` + free-text village, area/unit,
irrigation type), `FarmerCrop[]` (many-to-many farmer↔crop with area,
optional typical yield, and a per-farm primary-crop flag), `Crop` +
`CropTranslation` (English/Hindi/Marathi names, never duplicate crop rows
per language), and a minimal `Fpo` reference table. Profile completion is
**computed on every read**, never stored — see
`backend/src/modules/farmers/completion.ts` for the exact weighting.

**API** (all under `/api`, all FARMER-only + session-derived ownership —
see "Security" below):

| Endpoint | Purpose |
| --- | --- |
| `GET /farmers/me` | Full aggregate: profile + farms + crops + completion (auto-creates a bare profile on first call) |
| `POST /farmers/me/profile` | Create the selling-preference profile (409 if one already exists) |
| `PATCH /farmers/me/profile` | Update it |
| `GET /farmers/me/completion` | Just the completion percentage + missing items |
| `GET/POST /farms`, `GET/PATCH/DELETE /farms/:id` | Farm CRUD |
| `GET/POST /farmers/me/crops`, `PATCH/DELETE /farmers/me/crops/:id` | Farmer↔crop CRUD, including setting a primary crop |
| `GET /reference/{languages,irrigation-types,states,districts,talukas,crops,fpos}` | Reference/lookup data for every form above |

**Frontend**: `/profile` now leads with the farmer profile (personal info,
profile completion, farms, crops, FPO/selling preferences) for FARMER
accounts — Module 1's "Account & security" tools (change password,
sessions) stay on the same page, just below it, unchanged for every role.
`/farms/new` is a dedicated farm-creation form; editing/deleting a farm and
all crop management happens inline in cards on `/profile`. The dashboard
(`/dashboard`) now shows profile completion + a farm/crop/FPO/preference
summary instead of a "not part of Module 1 yet" placeholder. Cascading
state→district→taluka selects, English/Hindi/Marathi throughout (150
translation keys per language), loading/error/retry and empty states on
every API-backed section, mobile-first layout (large tap targets, cards
instead of dense tables).

**Security**: every self-service endpoint derives the farmer from the
authenticated session (`req.user.id`) — never from a client-supplied
`farmerId`/`userId` in the body or query string. A farm or crop record
belonging to a different farmer 404s (or, for the crop-add case, where the
spec calls for it explicitly, 403s) rather than leaking whether the
resource exists. Setting a new primary crop is a single DB transaction
(`FarmerCropRepository.setPrimary`) so a farm can never end up with two
primary crops from a partial update. FPO ids and crop ids are always
verified server-side, never trusted from the client. Precise farm
coordinates are never sent to PostHog (see `BLOCKED_PROPERTY_KEYS` in
`backend/src/config/posthog.ts`).

- 127 backend tests total (72 from Module 1, unchanged and still passing +
  55 new for Module 2: reference-data, farmer-profile, farms, crops
  including the primary-crop transaction and duplicate/ownership cases, a
  pure unit suite for the completion calculator, and a full end-to-end
  acceptance test mirroring the build spec's section-70 flow) + a
  Playwright E2E flow.

## Verification status (read this before assuming something's broken)

This was built in a network-sandboxed environment that could reach npm and
GitHub but **not** `binaries.prisma.sh`, so Prisma's query/schema-engine
binaries couldn't be downloaded here. Practical effect (same situation
Module 1 was originally delivered under — see `backend/prisma/README-engines.md`):

- Backend logic, RBAC, ownership, and the full Jest+Supertest suite
  (127/127 passing, `isolatedModules: true` in ts-jest means this runs
  without full cross-file type-checking) were verified using in-memory fake
  repositories instead of a live Prisma client for **both** modules — see
  `backend/tests/testUtils/`. Module 2's fakes (`inMemoryFarmerProfileRepository.ts`,
  `inMemoryFarmsRepository.ts`, `inMemoryFarmerCropRepository.ts`,
  `inMemoryReferenceDataRepository.ts`) join the existing `inMemoryAuthRepository.ts`.
- `eslint` is clean on both `backend/src` and `backend/tests` (0 errors, 2
  pre-existing warnings in Module 1's `app.ts` debug-Sentry route, both
  unrelated to Module 2).
- The frontend has a full clean `next build`, `next lint`, and
  `tsc --noEmit` pass in this sandbox — no caveats there, including every
  new Module 2 page/route.
- `prisma/schema.prisma` was hand-verified against Prisma's documented
  syntax (relation fields, `@@unique` compound-key naming, enums) rather
  than `prisma validate`, for the same binaries.prisma.sh reason. There is
  still no `prisma/migrations/` folder checked in — exactly as Module 1
  left it — because generating one requires the same blocked engine
  binaries. Run `npx prisma generate && npx prisma migrate dev --name
  module_2_farmer_farm_profile` once on a machine with normal internet
  access and both this and Module 1's original caveat resolve together.

## Design notes worth knowing before you extend this

- **`app.ts` is still fully dependency-injected**, now with four more
  repositories (`referenceDataRepository`, `farmerProfileRepository`,
  `farmsRepository`, `farmerCropRepository`) alongside Module 1's
  `authRepository`/`auditService`. `server.ts` is still the only file that
  constructs real Prisma-backed repositories; `tests/testUtils/buildTestApp.ts`
  constructs the in-memory fakes instead — same pattern as Module 1, just
  more of it.
- **A `FarmerProfile` row is created lazily, on first use** — by
  `GET /farmers/me`, by creating a farm, or by adding a crop — rather than
  requiring the client to call `POST /farmers/me/profile` first. This
  doesn't weaken the 409-on-duplicate check on that endpoint (see
  `FarmerProfileResolver`'s doc comment in
  `backend/src/modules/farmers/farmer-profile.resolver.ts`); it just means
  "add a farm" doesn't have an artificial ordering dependency on "fill out
  your selling preferences" — they're genuinely independent steps in the
  same onboarding flow.
- **Selling preferences live directly on `FarmerProfile`**, not a separate
  `FarmerPreferences` table — see the comment above the `FarmerProfile`
  model in `schema.prisma` for why.
- **Profile completion is computed on read, never stored.** See
  `backend/src/modules/farmers/completion.ts`. This is what makes "the
  frontend must never send `profileCompletionPercentage` as authoritative"
  impossible to violate by construction, rather than just a rule to
  remember.
- **Frontend route protection is UX only**, same as Module 1 —
  `ProtectedRoute` / `RoleProtectedPage` redirect for a better experience,
  but every protected API call is independently re-checked server-side
  regardless.
- **Cookies vs. bearer tokens:** unchanged from Module 1 — the refresh
  token lives in an HttpOnly, Secure (in prod), SameSite cookie; the
  short-lived access token is kept in memory on the frontend, sent via
  `Authorization: Bearer`.

## What's next (Module 3+, not in this repo)

Market Intelligence (consumes `Farm.district`/`Farm.state`), the Sell vs.
Store decision engine (consumes `FarmerProfile.liquidityPreference` +
`willingToStore`), Buyer Matching (consumes `FarmerCrop`), Warehouse
recommendations (consumes farm location + `willingToStore`), Logistics
(consumes authorized pickup location), and eventually FPO/buyer/
transporter/warehouse profiles, lots, offers, payments, shipments,
grievances, analytics. All of them are expected to read Module 2's data
through the services in `backend/src/modules/{farmers,farms,crops}` rather
than duplicating farmer/farm/crop state of their own.
