# FarmLink Intelligence — Modules 1, 2, 3 & 4

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
- **Module 3 (backend only)** — FPO Management & Farmer Aggregation, built
  on top of Modules 1 & 2. FPO registration/verification/administration,
  farmer membership requests and approval, the FPO member directory,
  crop-wise supply aggregation computed live from Module 2's farmer/farm/
  crop data, aggregation targets, FPO analytics, and a read-only
  government summary. No frontend/e2e work was in scope for Module 3 — see
  `backend/README.md` for the full write-up.
- **Module 4 (backend only)** — Crop / Lot Management, built on top of
  Modules 1-3. The first real transactional object: a farmer/FPO-declared
  actual quantity of produce (`CropLot`), distinct from Module 2's
  `FarmerCrop` and Module 3's estimated `AggregationGroup`. Lot creation
  (farmer-owned against their own farm, or FPO-owned by an FPO admin),
  draft editing, publish/cancel with a server-enforced status state
  machine and append-only history, KG/QTL/TONNE quantity normalization,
  and a farmer lot dashboard summary. No frontend/e2e work was in scope
  for Module 4 either — see `backend/README.md` for the full write-up.

Quality grading, market intelligence, price forecasting, sell-vs-store,
warehouse, buyer management/matching, offers/RFQ, and logistics/shipment/
payment/grievance are still explicitly out of scope — Module 4 only builds
the transactional lot data those modules will need (see "What's next"
below), not the modules themselves.

```
farmlink/
  backend/    Express + TypeScript + Prisma/PostgreSQL API (see backend/README.md)
  frontend/   Next.js + TypeScript + Tailwind UI (Modules 1 & 2 only — Modules 3 & 4 are backend-only)
  e2e/        Playwright end-to-end flow (Modules 1 & 2 only)
```

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in real secrets
npx prisma generate
npx prisma migrate dev --name module_4_lot_management
npm run prisma:seed           # demo farmer + Maharashtra locations + crop catalog + demo FPO (verified, with an admin + 50 fictional members)
npm run dev                   # http://localhost:4000, docs at /api/docs

# 2. Frontend (separate terminal — Modules 1 & 2 only, no Module 3/4 UI)
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

Demo logins (after seeding):
- Farmer: mobile `9876543210`, password `DemoFarmer123!`
- FPO admin (of the seeded, VERIFIED demo FPO): mobile `9876500000`,
  password `DemoFpoAdmin123!`

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
per language). Profile completion is **computed on every read**, never
stored — see `backend/src/modules/farmers/completion.ts` for the exact
weighting.

**API** (all under `/api`, all FARMER-only + session-derived ownership):

| Endpoint | Purpose |
| --- | --- |
| `GET /farmers/me` | Full aggregate: profile + farms + crops + completion (auto-creates a bare profile on first call) |
| `POST /farmers/me/profile` | Create the selling-preference profile (409 if one already exists) |
| `PATCH /farmers/me/profile` | Update it |
| `GET /farmers/me/completion` | Just the completion percentage + missing items |
| `GET/POST /farms`, `GET/PATCH/DELETE /farms/:id` | Farm CRUD |
| `GET/POST /farmers/me/crops`, `PATCH/DELETE /farmers/me/crops/:id` | Farmer↔crop CRUD, including setting a primary crop |
| `GET /reference/{languages,irrigation-types,states,districts,talukas,crops,fpos}` | Reference/lookup data for every form above |

### Module 3 — FPO Management & Farmer Aggregation (backend only)

**Data model**: the `Fpo` model Module 2 originally added as a minimal
reference stub is **extended in place** (not duplicated) with full
registration/verification/account fields — see that model's comment in
`schema.prisma`. Three new models: `FpoAdmin` (who administers which FPO —
an `FPO_ADMIN` role alone never grants access to a specific FPO, see
`modules/fpo/fpo.authorization.ts`), `FpoMembership` (the admin-approved
farmer↔FPO join workflow — deliberately separate from Module 2's
self-declared `FarmerProfile.fpoMembershipStatus`, see that field's
comment), and `AggregationGroup` (a planning target only — never a sale/
order/contract/lot/shipment).

**API** (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /fpos` | Search FPOs (public-safe) / register a new one (`FPO_ADMIN`/`ADMIN`, auto-assigns the creator as `PRIMARY_ADMIN` if they're an `FPO_ADMIN`) |
| `GET /fpos/:fpoId` | Details — public-safe by default, richer for the FPO's own admin/platform `ADMIN` |
| `POST /fpos/:fpoId/membership-requests` | Farmer requests to join (identity always from the session, never the body) |
| `GET /fpos/:fpoId/members` | Private member directory (own `FPO_ADMIN`/`ADMIN` only) |
| `POST /fpo-memberships/:membershipId/{approve,reject,remove,suspend,reactivate}` | Membership state machine |
| `GET /farmers/me/fpo` | The authenticated farmer's own current/pending membership |
| `GET /fpos/:fpoId/crop-aggregation` | Live crop-wise estimated supply from active members (`FPO_ADMIN` own / `ADMIN` / `GOVERNMENT_VIEWER` aggregate) |
| `GET /fpos/:fpoId/crop-aggregation/:cropId/members` | Per-farmer breakdown for one crop (admin-only) |
| `GET/POST /fpos/:fpoId/aggregation-groups`, `PATCH/POST .../:aggregationId{,/cancel}` | Aggregation targets vs. live estimate, with `gapQuantity` |
| `GET /fpos/:fpoId/analytics/overview` | Member counts, top crops, active targets |
| `GET /admin/fpos`, `.../:fpoId`, `.../{verify,reject,suspend,reactivate}`, `.../:fpoId/admins` | Platform `ADMIN`-only lifecycle + admin assignment |
| `GET /government/fpo-summary` | Read-only national FPO/crop-supply summary (`GOVERNMENT_VIEWER`) |

**Crop-aggregation math** (`modules/fpo/unit-conversion.ts`): normalizes
every farmer-crop row's free-text `yieldUnit` (e.g. `"QTL/ACRE"`) into KG
internally before summing, converts back to QTL for display. A missing
`typicalYield` or an unrecognized `yieldUnit` string is **never** treated
as zero or guessed — it's excluded from the sum and reported via an
`estimateCoverage` field (`farmersWithEstimate` vs. `totalFarmers`), so a
partial estimate is never silently indistinguishable from a complete one.
The whole engine is two batched queries (active member ids, then their
crop rows) plus in-memory grouping — never a per-farmer query loop.

**Security**: `FpoAuthorizationService.canManageFpo` is the single place
every FPO-scoped admin action checks ownership through — an `FPO_ADMIN`
role alone is never sufficient, an active `FpoAdmin` row for that specific
`(userId, fpoId)` (or platform `ADMIN`) is required. Every membership/
aggregation-group state change goes through a conditional/atomic
`transition()` primitive (only applies if the row is still in an expected
starting status), so double-approval, double-removal, and races fail with
a clear 409 rather than corrupting data. See
`tests/integration/fpo.security.test.ts` for the mandatory cross-FPO IDOR,
farmer-identity-spoofing, and government-read-only test cases.

- 178 backend tests total (127 from Modules 1 & 2, unchanged and still
  passing, + 51 new for Module 3: registration/search/details, the full
  membership workflow including the worked crop-aggregation example from
  the build spec (20+30+50=100 QTL), missing-yield/unit-conversion cases,
  aggregation targets, analytics, admin verification/suspension/admin-
  assignment, and the mandatory security suite).

### Module 4 — Crop / Lot Management (backend only)

**Data model**: two additive models. `CropLot` — `ownerType`
(`FARMER`/`FPO`) + `sourceType` (`FARMER_CREATED`/`FPO_AGGREGATED`)
tracked separately for future traceability; a server-generated unique
`lotNumber` (e.g. `LOT-2026-000123`) alongside the usual `publicId`;
quantities stored as Prisma `Decimal` (not `Float`, unlike Module 2/3's
quantity columns — see `schema.prisma`'s comment on `CropLot` for why);
and an origin (village/taluka/district/state) snapshotted from the farm
(or the FPO's own registered location for an FPO-owned lot) at creation
time, never re-derived later. `LotStatusHistory` — an append-only
transition log kept alongside `CropLot.status`, not instead of it.

**API** (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `POST /lots` | Create a lot — `farmId` for a farmer's own farm (`FARMER`), or `fpoId` for an FPO-owned lot (`FPO_ADMIN`, must actively administer that FPO) |
| `GET /lots` | The authenticated farmer's own lots (`status`/`cropId`/`farmId` filters, paginated) |
| `GET/PATCH/DELETE /lots/:id` | Get / edit-while-`DRAFT` / delete-while-`DRAFT` a single lot by `publicId` |
| `POST /lots/:id/publish` | `DRAFT` → `AVAILABLE` |
| `POST /lots/:id/cancel` | `DRAFT`/`AVAILABLE` → `CANCELLED` (blocked once a lot is past `AVAILABLE`) |
| `GET /lots/:id/history` | The lot's full status transition history |
| `GET /farmers/me/lots/summary` | Farmer dashboard: total/draft/available/cancelled counts + total available quantity |
| `GET /fpos/:fpoId/lots` | An FPO's own lots (own `FPO_ADMIN`/`ADMIN` only) |

**Status state machine** (`modules/lots/lot-status.service.ts`): the full
`DRAFT → AVAILABLE → PARTIALLY_COMMITTED → COMMITTED → STORED →
IN_TRANSACTION → DELIVERED → COMPLETED` chain (plus `CANCELLED` from
`DRAFT`/`AVAILABLE`) is defined and validated, but only `publish` and
`cancel` are reachable through a route today — the rest exists for future
reservation/warehouse/logistics/delivery/payment modules to reuse without
re-inventing status legality. Every transition is a guarded conditional
`UPDATE` (mirrors Module 3's `AggregationGroupRepository.transition()`),
never a separate read-then-write, so concurrent requests fail with a clear
409 instead of racing.

**Quantity**: `modules/fpo/unit-conversion.ts` (Module 3's own KG/QTL/
TONNE conversion) is reused directly rather than duplicated.
`LotQuantityService` (`reserve`/`release`/`consume`) is a deliberately
internal-only foundation — nothing in Module 4 calls it yet, but
`CropLotRepository.adjustAvailableQuantity`'s atomic "only decrement if
still enough available" guard already means `availableQuantityKg` can
never go negative, for whichever future module wires reservations up.

**Security**: farm/FPO ownership is never trusted from the request —
`farmId` is checked against the authenticated farmer's own `FarmerProfile`
(404 if the farm doesn't exist at all, 403 if it exists but belongs to
someone else, mirroring Module 2's `CropsService` convention), and FPO-lot
creation/management reuses Module 3's own `FpoAuthorizationService`
unchanged. A lot's existence itself is not public: an unauthorized viewer
gets the same 404 a nonexistent `publicId` would produce, never a 403 that
would confirm the lot exists.

- 20 new backend tests (198 total): the full create→publish→list→view→
  history→cancel lifecycle, farm/crop-association validation, quantity
  conversion and rejection (negative/zero/NaN/infinite), every state
  transition legality case from the build spec, cross-farmer and
  cross-FPO security (IDOR), and request-shape validation.

## Verification status (read this before assuming something's broken)

This was built in a network-sandboxed environment that could reach npm and
GitHub but **not** `binaries.prisma.sh`, so Prisma's query/schema-engine
binaries couldn't be downloaded here — same situation Modules 1 & 2 were
originally delivered under (see `backend/prisma/README-engines.md`):

- Backend logic, RBAC, ownership, and the full Jest+Supertest suite
  (198/198 passing, `isolatedModules: true` in ts-jest means this runs
  without full cross-file type-checking) were verified using in-memory fake
  repositories instead of a live Prisma client for **all four** modules —
  see `backend/tests/testUtils/`. Module 3's fakes
  (`inMemoryFpoRepository.ts`, `inMemoryFpoAdminRepository.ts`,
  `inMemoryFpoMembershipRepository.ts`, `inMemoryAggregationGroupRepository.ts`)
  and Module 4's (`inMemoryCropLotRepository.ts`, which joins across the
  Module 2/3 fakes the same way `inMemoryAggregationGroupRepository.ts`
  joins against reference data) follow the exact same pattern.
- `npx tsc --noEmit` cannot succeed in this sandbox for *any* module (the
  same "no exported member" errors from `@prisma/client`'s placeholder
  default client appear across every module, old and new alike, including
  Module 4's) — this is the missing-generated-client limitation above, not
  a code defect; `prisma/README-engines.md` documents the same finding
  from Modules 1-3's original build. `npx eslint` passes clean on every
  Module 4 file.
- `prisma/schema.prisma` was hand-verified against Prisma's documented
  syntax rather than `prisma validate`, for the same reason. There is
  still no `prisma/migrations/` folder checked in. `FpoMembership`'s
  "one ACTIVE membership per farmer" rule is enforced server-side in
  `membership.service.ts`; the ideal *additional* DB-level enforcement is a
  partial unique index that Prisma's schema DSL can't express
  declaratively — the exact SQL to hand-add is documented in a comment
  above the `FpoMembership` model. Run `npx prisma generate && npx prisma
  migrate dev --name module_4_lot_management` once on a machine with
  normal internet access and everything (including Modules 1-3's
  original caveat) resolves together.

## Design notes worth knowing before you extend this

- **`app.ts` is still fully dependency-injected**, now with five more
  Module 3/4 repositories (`fpoRepository`, `fpoAdminRepository`,
  `fpoMembershipRepository`, `aggregationGroupRepository`,
  `cropLotRepository`) alongside Module 2's four and Module 1's
  `authRepository`/`auditService`. `server.ts` is still the only file that
  constructs real Prisma-backed repositories; `tests/testUtils/buildTestApp.ts`
  constructs the in-memory fakes instead.
- **Every Module 3/4 URL segment (`:fpoId`, `:membershipId`,
  `:aggregationId`, a lot's `:id`) is a `publicId`, never the internal
  database id** — same externally-facing-identifier convention as
  `User.publicId`.
- **Two intentionally separate "is this farmer in this FPO" signals.**
  Module 2's `FarmerProfile.fpoMembershipStatus`/`fpoId` (self-declared,
  no approval) is left completely untouched; `FpoMembership` (this module)
  is the audited, admin-approved source of truth. They are not merged —
  see the comment on `fpoMembershipStatus` in `schema.prisma` for why.
- **FPO `suspend`/`reactivate` moves both `accountStatus` and
  `verificationStatus` together** — the build spec describes the
  operational gate via one and the state-machine transition via the other
  for the same action; `fpo-verification.service.ts`'s doc comment walks
  through the reasoning.
- **Cookies vs. bearer tokens:** unchanged from Modules 1 & 2.
- **`GET /fpos/:fpoId/lots` is a second, separate router mounted at the
  same `/api/fpos` prefix as Module 3's `fpo.routes.ts`**
  (`modules/lots/lots.routes.ts`'s `createFpoLotsRouter`, wired in
  `app.ts`) rather than a change to that file — Express falls through an
  unmatched router to the next one mounted at the same prefix, so this
  works without touching Module 3's own route composition.
- **Lot quantities are Prisma `Decimal`, not `Float`** — the one place
  Module 4 deliberately diverges from Module 2/3's numeric convention; see
  the `CropLot` model's comment in `schema.prisma`.

## What's next (Module 5+, not in this repo)

Quality Grading (consumes `CropLot` — never fakes a `lotId` today), Market
Intelligence, Price Forecasting, Sell vs. Store, Warehouse, Buyer
Management/Matching (consumes `AVAILABLE` lots plus
`FpoAggregationService.getFpoCropAvailability`), Offers/RFQ, and
Logistics/Shipment/Payment/Grievance. All of them are expected to read
Module 3/4's data through the services in `backend/src/modules/fpo` and
`backend/src/modules/lots` rather than duplicating FPO/membership/
aggregation/lot state of their own.

