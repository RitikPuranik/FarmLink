# FarmLink Intelligence — Modules 1–8

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
- **Module 5 (backend only)** — Quality Grading & Produce Assessment,
  built on top of Modules 1-4. `QualityAssessment` records — a farmer's
  self-report, an AI estimate, or a human/lab verification — are always
  separate, permanent rows, never merged or overwritten; AI output is
  never treated as certified truth (a farmer can never verify their own
  self-assessment, and low-confidence AI results route to human review
  instead of auto-verifying). Flexible per-crop metrics/defects (no
  hardcoded columns), a crop-agnostic grading engine driven by configured
  `QualityStandard` rules, and an `AI` provider abstraction that honestly
  reports unavailability rather than fabricating a plausible-looking
  result (no AI vendor is wired into this codebase). No frontend/e2e work
  was in scope for Module 5 either — see `backend/README.md` for the full
  write-up.
- **Module 6 (backend only)** — Market Intelligence & Price Discovery.
  Read-only intelligence over the shared market data store: crop price
  analytics (average, min, max, volatility), geographic market context
  resolution (district → state → national fallback), market data freshness
  tracking (FRESH/RECENT/STALE/OUTDATED), and lot-scoped price benchmarks.
  Reuses Module 4's lot authorization and Module 2's farmer profile
  resolution. No frontend/e2e work was in scope.
- **Module 7 (backend only)** — Buyer Management & Matching. Buyer
  profiles, demand lifecycle (active/paused/fulfilled/expired with lazy
  expiration), deterministic buyer↔lot matching with quality/location
  scoring, offer management with a full state machine
  (PENDING→ACCEPTED/REJECTED/EXPIRED/WITHDRAWN/COUNTERED), concurrent
  quantity reservation with atomic guards, and demand quantity validation
  (requiredQuantity can never drop below committedQuantity). No
  frontend/e2e work was in scope.
- **Module 8 (backend only)** — Sell vs Store Decision Engine. A
  deterministic, rule-based engine that evaluates whether a farmer should
  sell now or store a crop lot — NO AI, NO LLM, NO forecasting models.
  Integrates market intelligence (Module 6), quality data (Module 5), and
  storage context to produce SELL_NOW / STORE / INSUFFICIENT_DATA
  decisions with confidence scores, full explainability metadata
  (factors used, scores, engine version), and immutable historical
  snapshots. Exposed via authenticated APIs with lot-scoped authorization.

Logistics/shipment/payment/grievance are still explicitly out of scope.

```
farmlink/
  backend/    Express + TypeScript + Prisma/PostgreSQL API (see backend/README.md)
  frontend/   Next.js + TypeScript + Tailwind UI (Modules 1 & 2 only — Modules 3, 4 & 5 are backend-only)
  e2e/        Playwright end-to-end flow (Modules 1 & 2 only)
```

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in real secrets
npx prisma generate
npx prisma migrate dev --name module_5_quality_grading
npm run prisma:seed           # demo farmer + Maharashtra locations + crop catalog + demo FPO (verified, with an admin + 50 fictional members)
npm run dev                   # http://localhost:4000, docs at /api/docs

# 2. Frontend (separate terminal — Modules 1 & 2 only, no Module 3/4/5 UI)
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

### Module 5 — Quality Grading & Produce Assessment (backend only)

**Data model**: `QualityAssessment` — one row per assessment *event*
(`source`: MANUAL/AI/LAB/HYBRID; `status`: the workflow state machine;
`verificationStatus`: SELF_REPORTED/AI_ESTIMATED/VERIFIED/LAB_VERIFIED,
tracked separately from `status` — see below) — is never mutated into a
"better" version. A newer assessment instead points the older one it
replaces at itself via `supersededByAssessmentId`; both rows persist
forever. `QualityMetric`/`QualityDefect` are flexible `metricCode`/`value`
rows, never crop-specific columns, so a new crop's parameter set needs no
migration. `QualityImage` stores metadata only (`storageProvider`/
`externalId`/`secureUrl`) — see "Images" below for why. `QualityAIAnalysis`
is one row per AI *attempt* (including retries), not a single mutable
field. `QualityStandard` is a crop-agnostic per-metric grading rule table
(crop + grade + metric code + allowed range).

**API** (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `POST /lots/:lotPublicId/quality-assessments` | Create an assessment for a lot the caller can already access |
| `GET /lots/:lotPublicId/quality-assessments` | Full chronological history for a lot, most recent first |
| `GET /lots/:lotPublicId/quality-summary` | The lot's current (non-superseded, non-rejected) assessment |
| `GET/PATCH /quality-assessments/:publicId` | Get / edit-while-DRAFT-or-PENDING_IMAGES a single assessment |
| `POST/DELETE /quality-assessments/:publicId/images[/​:imageId]` | Attach or remove an already-uploaded image's metadata |
| `POST /quality-assessments/:publicId/analyze` | Request AI analysis (idempotent — see "AI pipeline" below) |
| `POST /quality-assessments/:publicId/analyze/retry` | Retry, only reachable from FAILED |
| `POST /quality-assessments/:publicId/verify` | Authorized-verifier-only: DRAFT/PENDING_IMAGES/AI_COMPLETED/PENDING_REVIEW → VERIFIED |
| `GET /farmers/me/quality-summary` | Farmer dashboard: counts by status/verification + grade distribution |

**Trust, never faked**: creation always starts `verificationStatus:
SELF_REPORTED`, no matter who created it or what grade they claimed —
only the AI pipeline (→ `AI_ESTIMATED`) or the role-gated `/verify`
endpoint (→ `VERIFIED`/`LAB_VERIFIED`) can move it forward.
`QualityAuthorizationService.canVerify` is never true for the lot's own
farmer, full stop — it reuses Module 4's `LotAuthorizationService` for
general access, but verification is its own, stricter check (an FPO's own
admin, or `ADMIN`; a plain farmer-owned lot can only be verified by
`ADMIN` today, since there's no inspector role yet — see "RBAC" below).

**AI pipeline, honestly**: this codebase has no AI vendor SDK, credentials,
or endpoint configured — there is genuinely nothing to call.
`UnavailableQualityAIProvider` (`modules/quality/ai/`) always throws a
typed `AI_ANALYSIS_UNAVAILABLE` error rather than returning a
plausible-looking `Grade A, 95% confidence` result, and the pipeline
stores that as a real `FAILED` attempt (never a fabricated success) — a
real provider (Gemini Vision, a custom CV model, ...) can be dropped in
later behind the exact same `QualityAIProvider` interface without
touching `quality.service.ts`. Cost/abuse protection is real, not just
described: a second `/analyze` call while one is already running is a 409
(idempotency guard), a completed result is returned as-is instead of
re-calling the provider, and there's a hard 5-attempt ceiling per
assessment. A low-confidence result (<0.70) never auto-verifies — it moves
straight to `PENDING_REVIEW`.

**Images, without inventing infrastructure**: there is no Cloudinary (or
any) file-storage SDK, credentials, or multipart upload middleware in this
codebase. Rather than fabricate one, the image endpoint accepts metadata
for an image the client already uploaded to its own storage (a very common
real-world Cloudinary pattern — a signed direct-upload widget) — the
`storageProvider`/`externalId` columns are deliberately generic so a real
integration can be wired in later without another migration.

**Grading**: `QualityGradingService` reads whatever `QualityStandard` rows
exist for a lot's crop and walks grades best-to-worst (A→D), returning the
first grade whose every configured metric rule the submission satisfies —
never a hardcoded `if (crop === "onion")` branch. A crop with no
configured standards simply gets no auto-computed grade; an explicitly
supplied grade always wins over a computed one.

- 15 new backend tests (213 total): the manual self-report→verify
  lifecycle (including the farmer-cannot-verify-own-work rule), the full
  AI pipeline against both a fake-succeeding and an always-failing
  provider (including the retry limit and the idempotent-already-completed
  path), image count limits, supersession, FPO-owned-lot verification
  scope, both summary endpoints, and crop-standard-driven grading. Two
  real bugs were caught this way during development — a missing
  `confidenceScore` write-through on AI completion, and a supersession
  target that was matching itself — and are covered by the passing
  regression suite now, not just fixed.

### Module 6 — Market Intelligence & Price Discovery (backend only)

**Data model**: uses the existing `MarketPrice` table (populated by data
ingestion) and adds `MarketIntelligenceRepository` for analytics queries.
No new Prisma models — this module is read-only over the shared market
data store.

**Key concepts**:
- **Price analytics**: average, min, max, volatility, and trend direction
  (UP/DOWN/STABLE) for a crop in a given market/time range.
- **Geographic market resolution**: district-level → state-level → national
  fallback, with the geographic scope of the selected data always explicit
  (never silently switching to a national average without the caller
  knowing).
- **Market data freshness**: every price data point is classified as
  FRESH (≤24h) / RECENT (≤72h) / STALE (≤7d) / OUTDATED (>7d).
  OUTDATED data is treated as insufficient for decision-making by
  downstream modules (Module 8).
- **Lot-scoped price benchmarks**: given a lot's crop and origin
  (district/state), resolves the best available local market context.

**API** (all under `/api/market-intelligence`):

| Endpoint | Purpose |
| --- | --- |
| `GET /crops/:cropId/prices` | Price analytics for a crop (market, date range, trend) |
| `GET /lots/:lotPublicId/market-context` | Lot-scoped market context (requires lot authorization) |

**Security**: reuses `LotAuthorizationService` for lot-scoped endpoints and
`FarmerProfileResolver` for caller identity. An unauthorized caller gets
a 404 (obfuscated), never a 403 that confirms the lot exists.

### Module 7 — Buyer Management & Matching (backend only)

**Data model**: `BuyerProfile` (1:1 with `User`, holds buyer-specific
preferences and verification status), `BuyerDemand` (a buyer's declared
need: crop, quantity, quality requirements, price range, location
preferences, with a full lifecycle state machine), and buyer↔lot
matching/offer models. Demand quantity validation ensures
`requiredQuantity` can never be updated below `committedQuantity` — the
`REQUIRED_QUANTITY_BELOW_COMMITTED` domain error was added specifically
for this.

**Key concepts**:
- **Demand lifecycle**: ACTIVE → PAUSED / FULFILLED / EXPIRED, with lazy
  expiration (demands are marked expired on read if past their
  `expiresAt`, not by a cron job).
- **Deterministic matching**: buyer↔lot matching scores lots against a
  demand based on quality grade, location proximity, and quantity fit.
  No AI, no ML — the same inputs always produce the same ranking.
- **Offer state machine**: PENDING → ACCEPTED / REJECTED / EXPIRED /
  WITHDRAWN / COUNTERED, with atomic quantity reservation guards that
  prevent double-booking and ensure `availableQuantityKg` never goes
  negative.
- **Concurrency safety**: quantity reservation uses conditional atomic
  updates (only decrement if still enough available), so concurrent
  offers against the same lot fail with a clear error rather than
  silently over-committing.

**API** (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `POST /buyer-profiles` | Create a buyer profile |
| `GET/PATCH /buyer-profiles/me` | View/update the authenticated buyer's profile |
| `POST /buyer-demands` | Create a demand |
| `GET /buyer-demands` | List the authenticated buyer's demands |
| `GET/PATCH /buyer-demands/:id` | View/update a single demand |
| `POST /buyer-demands/:id/matches` | Find matching lots for a demand |
| `POST /offers` | Create an offer against a lot |
| `GET /offers` | List the authenticated user's offers |
| `POST /offers/:id/{accept,reject,withdraw,counter}` | Offer state transitions |

### Module 8 — Sell vs Store Decision Engine (backend only)

**Data model**: `SellStoreDecision` — a single row per decision evaluation,
with `status` (PENDING/COMPLETED/FAILED), `result` (SELL_NOW/STORE/
INSUFFICIENT_DATA), `confidenceScore` (Decimal 5,4, validated 0–1),
immutable `inputSnapshot` (Json — the exact market/quality/storage data
used), and `decisionMetadata` (Json — engine version, sell/store scores,
factors used, omitted factors, insufficiency reasons). The lot relation
uses `onDelete: Restrict` so historical decisions are never silently
deleted with lots.

**Architecture** (five layers, each testable in isolation):

1. **Part 1 — Foundation**: `SellStoreDecision` Prisma model,
   `SellStoreDecisionRepository`, and `SellStoreInputSnapshot` types.
2. **Part 2 — Input Resolution**: `DecisionInputResolverService` gathers
   lot context, quality data (latest non-superseded assessment), and
   market intelligence (reusing Module 6's analytics). Reports exactly
   which inputs are available/missing and never fabricates data.
3. **Part 3 — Decision Engine**: `DecisionEngineService` — a pure,
   deterministic function `(ResolvedDecisionInput → DecisionEngineResult)`.
   Four directional factors (MARKET_TREND, VOLATILITY, STORAGE_RISK,
   QUALITY_CONSTRAINTS) contribute evidence toward SELL_NOW or STORE.
   Market data freshness affects confidence (not direction). Storage
   availability uses an explicit tri-state (AVAILABLE/UNAVAILABLE/UNKNOWN).
   Centralized weights/thresholds in
   `sell-store-decision-engine.config.ts`.
4. **Part 4 — Orchestration**: `SellStoreOrchestrationService` coordinates
   resolver → engine → repository with a strict PENDING → COMPLETED|FAILED
   lifecycle. Persists immutable `inputSnapshot` + `decisionMetadata`
   (engine version `v1`, all scores and factors) so historical decisions
   remain reproducible without recomputation. `INSUFFICIENT_DATA` is a
   valid completed outcome, not a failure.
5. **Part 5 — API & Authorization**: Three authenticated endpoints
   exposed via `createSellStoreRouter`, using the project's existing
   `createAuthMiddleware`, `validateParams`, and `asyncHandler` patterns.

**API** (all under `/api/sell-vs-store`):

| Endpoint | Purpose |
| --- | --- |
| `POST /lots/:lotPublicId/analyze` | Generate a new deterministic decision |
| `GET /lots/:lotPublicId/history` | List historical decisions for a lot (newest first) |
| `GET /decisions/:publicId` | Retrieve a specific historical decision |

**Key design rules**:
- **Deterministic**: NO AI, NO LLM, NO forecasting models, NO fabricated
  future prices. The same inputs always produce the same result.
- **Immutable history**: retrieval endpoints return exactly what was
  persisted — they never recompute scores, re-run the engine, or fetch
  current market prices to replace old values.
- **Authorization**: reuses `LotAuthorizationService.canViewLot()` —
  FARMER can only access their own lots, FPO_ADMIN their FPO's lots,
  ADMIN all lots. Unauthorized access returns 404 (obfuscated).
- **Controllers are thin**: extract params, authorize, call orchestrator,
  return DTO. Zero business logic in the API layer.
- **`INSUFFICIENT_DATA` is HTTP 200**: it's a valid completed analysis
  reflecting sparse data, not an operational failure.

**Security**: the client cannot inject arbitrary prices, market values, or
scoring weights — the server resolves all authoritative data internally
from Modules 5 and 6.

- 35 new Module 8 backend tests (15 engine unit + 5 orchestration unit +
  15 integration): deterministic scoring across all factor combinations,
  confidence gating, INSUFFICIENT_DATA handling, PENDING→FAILED exception
  safety, full authorization flow (farmer/admin/unauthorized), parameter
  validation, and verification that historical retrieval never triggers
  recomputation.

## Verification status (read this before assuming something's broken)

This was built in a network-sandboxed environment that could reach npm and
GitHub but **not** `binaries.prisma.sh`, so Prisma's query/schema-engine
binaries couldn't be downloaded here — same situation Modules 1 & 2 were
originally delivered under (see `backend/prisma/README-engines.md`):

- Backend logic, RBAC, ownership, and the full Jest+Supertest suite
  (248+ passing, `isolatedModules: true` in ts-jest means this runs
  without full cross-file type-checking) were verified using in-memory fake
  repositories instead of a live Prisma client for **all eight** modules —
  see `backend/tests/testUtils/`. Module 8's tests mock the orchestration
  dependencies (resolver, engine, repository) and auth middleware to test
  the full API→authorization→orchestration→persistence flow in isolation.
- `npx tsc --noEmit` passes clean on the current codebase (Module 8 was
  developed with Prisma client generation available).
- `prisma/schema.prisma` includes the `SellStoreDecision` model with
  `decisionMetadata` (Json), `inputSnapshot` (Json), `confidenceScore`
  (Decimal 5,4), and indexes on `lotId`+`status` and
  `requestedByUserId`. Run `npx prisma generate && npx prisma migrate dev`
  once on a machine with normal internet access.

## Design notes worth knowing before you extend this

- **`app.ts` is still fully dependency-injected**, now with Module 6/7/8
  repositories and services alongside Modules 1-5's. Module 8 adds
  `SellStoreDecisionRepository`, `DecisionInputResolverService`,
  `DecisionEngineService`, and `SellStoreOrchestrationService`, all
  wired in `app.ts` and mounted at `/api/sell-vs-store`.
- **Every Module 3/4/5/6/7/8 URL segment (`:fpoId`, `:membershipId`,
  `:aggregationId`, a lot's `:id`, an assessment's `:publicId`, a
  decision's `:publicId`) is a `publicId`, never the internal database
  id** — same externally-facing-identifier convention as `User.publicId`.
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
  works without touching Module 3's own route composition. Module 5's
  `/lots/:lotPublicId/quality-assessments` and
  `/lots/:lotPublicId/quality-summary` reuse the exact same trick at the
  `/api/lots` prefix instead, against Module 4's own router.
- **Lot quantities are Prisma `Decimal`, not `Float`** — the one place
  Module 4 deliberately diverges from Module 2/3's numeric convention; see
  the `CropLot` model's comment in `schema.prisma`.
- **`status` (workflow state) and `verificationStatus` (trust level) are
  two different columns on `QualityAssessment`, on purpose** — a status of
  `AI_COMPLETED` and a `verificationStatus` of `AI_ESTIMATED` describe the
  same moment from two different angles; conflating them would make it
  impossible to ask "is this actually verified" without also asking
  "where is it in the pipeline". See `quality-status.service.ts`'s comment.
- **`QualityAssessment.qualityScore`/`confidenceScore` are Prisma
  `Decimal`, matching `CropLot`'s quantity fields** — the same
  DB-precision reasoning applies to anything a future module (Buyer
  Matching, pricing) might do arithmetic against.
- **Module 8's `inputSnapshot` and `decisionMetadata` are `Json?`, not
  structured Prisma relations** — deliberately, because decision snapshots
  must remain historically reproducible even when the schema of market
  prices, quality metrics, or storage infrastructure evolves. The service
  layer treats completed snapshots as immutable.

## What's next (Module 9+, not yet implemented)

Warehouse discovery/booking, logistics/shipment tracking, payment
integration, and grievance/dispute resolution. All of them are expected
to read Modules 3-8's data through the established service layer rather
than duplicating state. Module 8's decision engine is designed to be
extended with new factors (e.g. warehouse proximity, logistics cost) by
adding new `DecisionFactor` entries and corresponding scoring logic in
`sell-store-decision-engine.service.ts` without changing the orchestration
or API layers.

