# FarmLink Intelligence — AI Project Context

> Canonical context for coding agents working on this repository. Read this file first for future module work. Inspect only files directly relevant to the current task unless a dependency requires deeper inspection.

## Product
- Product: FarmLink Intelligence
- SIH: Smart India Hackathon 2026
- Problem Statement: SIH26132 — Strengthening market linkages and price discovery for farmers
- Core idea: AI-powered market decision + transaction orchestration platform that helps farmers/FPOs decide where, when, and to whom to sell, how to store/move produce, and expected net realization.

## Repository
- GitHub: https://github.com/RitikPuranik/FarmLink
- Default branch: `main`
- Top-level areas: `backend/`, `frontend/`, `e2e/`

## Current Implementation Status
1. Module 1 — Authentication & RBAC: implemented
2. Module 2 — Farmer & Farm Profile: implemented
3. Module 3 — FPO Management & Farmer Aggregation: implemented

Next planned business modules include Crop/Lot, Quality, Market Intelligence, Price Forecasting, Sell-vs-Store, Warehouse, Buyers, Buyer Matching, RFQ/Offers, Net Realization, Logistics, Shipment/Tracking, Delivery, Payment Status, Ledger, Grievance, Notifications, multilingual/voice/offline, Risk, Analytics, Admin/Government, integrations, audit/security/monitoring and AI platform capabilities.

## Backend — Actual Current Stack
- Express.js 4.x
- TypeScript 5.x
- Prisma 5.x
- PostgreSQL
- Redis/ioredis (used/optional infrastructure, including rate limiting)
- Argon2id password hashing
- JWT access tokens + rotating HttpOnly refresh-cookie/session approach
- Zod validation
- Swagger/OpenAPI via `swagger-jsdoc` + `swagger-ui-express`
- Jest + Supertest
- Pino/Pino HTTP logging
- Helmet, CORS, express-rate-limit
- Sentry integration/stub
- PostHog integration/stub/pattern

## Backend Structure
`backend/src/` currently follows a modular architecture. Main areas include:
- `config/` — env, logger, Prisma client, Redis, Swagger, Sentry/PostHog
- `common/` — errors, API response envelope, async handling
- `middleware/` — error handling, 404, rate limiting, security, validation
- `modules/auth/` — Module 1 auth/session/RBAC/OTP abstraction
- `modules/audit/` — shared audit logging
- `modules/users/` — admin demo/RBAC route
- `modules/farmers/` — Module 2 FarmerProfile aggregate/completion
- `modules/farms/` — Module 2 farm CRUD/ownership
- `modules/crops/` — Module 2 farmer-crop CRUD/primary crop transaction
- `modules/reference-data/` — states/districts/talukas/crops/FPOs/languages/irrigation types
- `modules/fpo/` — Module 3 FPO registration/verification/admins, membership, aggregation, analytics, government summary
- `app.ts` — dependency-injected Express app factory
- `server.ts` — composition root; only place that constructs the real PrismaClient

## Important Backend Architecture Rules
- Reuse the existing Prisma client. Do not instantiate another one.
- Reuse Module 1 authentication and RBAC. Do not create another auth system.
- Backend is authoritative for identity, authorization, state transitions and calculations.
- Controllers should be thin; business logic belongs in services; DB access in repositories.
- Use authenticated session identity for `/me` and ownership-scoped operations. Do not trust client-supplied `userId`/`farmerId` for self-service authorization.
- Use public IDs in URLs where current modules do so; resolve to internal DB IDs server-side.
- Enforce organization scope: an `FPO_ADMIN` can manage only FPOs to which they have an active `FpoAdmin` relationship, unless they are platform `ADMIN`.
- Do not duplicate FarmerProfile/Farm/FarmerCrop/Crop data in future modules.
- Do not fabricate live data. Clearly distinguish LIVE, ESTIMATED, AI PREDICTION and SIMULATED values.
- Extend existing Swagger, Sentry, PostHog and audit infrastructure instead of creating parallel systems.

## Current Prisma Data Model Highlights
### Module 1
- `User`
- `Session`
- `PasswordResetToken`
- `OtpChallenge`
- `AuditLog`

### Module 2
- `State`
- `District`
- `Taluka`
- `Crop`
- `CropTranslation`
- `FarmerProfile`
- `Farm`
- `FarmerCrop`

Important Module 2 design decision:
- Farmer selling preferences (`fpoMembershipStatus`, `liquidityPreference`, `willingToStore`, `communicationPreference`) live on `FarmerProfile`; there is no separate FarmerPreferences table.
- `profileCompletionPercentage` is computed on read, not persisted.

### Module 3
- `Fpo`
- `FpoAdmin`
- `FpoMembership`
- `AggregationGroup`

Important Module 3 design decisions:
- `Fpo` extends the pre-existing Module 2 FPO reference instead of creating a new FPO table.
- Admin-approved FPO membership is authoritative and is represented by `FpoMembership`; Module 2's self-declared `FarmerProfile.fpoMembershipStatus`/`fpoId` remains for backward compatibility and is not the authoritative approval record.
- Crop-wise estimated supply is calculated live from active FPO memberships -> Module 2 farmer/farm/crop data. It is not stored as a duplicate inventory table.
- `AggregationGroup` is a planning target only, not a sale, order, contract, lot, shipment or inventory reservation.
- Quantity is normalized internally to KG where aggregation logic requires unit conversion and may be displayed as QTL/tonne.

## Market Data — Existing Foundation (important for future modules)
The project has an existing real market-data foundation from the user's previous implementation:
- Existing `Crop` table
- Existing `Mandi` table
- Existing `MandiPrice` table
- Government market-price ingestion from the Open Government Data/data.gov.in ecosystem
- Daily 2 AM IST cron sync that fetches new/latest available daily market records and upserts them
- Historical market data can be backfilled once, then daily incremental sync should continue
- Do NOT recreate this data model or rebuild the market ingestion from scratch when implementing Market Intelligence
- `MandiPrice` should remain the date-wise historical time-series store used later for trends and price forecasting
- UI wording should distinguish daily/last-updated market data from truly real-time feeds

## Planned Core Business Flow
Farmer -> Farm/Profile -> Crop Lot -> Quality -> Market Intelligence -> Price Forecast -> Sell/Store Decision -> Warehouse (if storing) -> Buyer Discovery -> Buyer Matching -> RFQ/Offers -> Net Realization -> Logistics -> Shipment/Tracking -> Delivery/Quality Reconciliation -> Payment Status -> Transaction Ledger -> Dispute/Grievance

## Planned Logistics Architecture
Transport data should be provider-agnostic:
- Registered local transporters in FarmLink
- FPO/local transporter network
- Commercial/partner logistics APIs where credentials/partnerships exist
- Government transporter/compliance integrations where appropriate
- Mock provider for SIH/demo when live partner credentials are unavailable

Do not claim there is a universal public API containing every truck driver's live rate and availability.

## Planned File Storage
- Cloudinary for images/documents when needed
- Store media metadata/references in PostgreSQL, not binary files

## Planned Monitoring / Analytics
- Sentry = technical errors/performance
- PostHog = product/user analytics
- Never send passwords, OTPs, auth tokens or unnecessary sensitive personal data to analytics/monitoring

## Frontend — Target Stack
- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query/React Query where already configured
- React Hook Form + Zod where already configured
- Reuse existing auth state, API client, routing, i18n and component system
- Farmer experience is mobile-first
- Supported languages: English, Hindi, Marathi

## External Integration Principles
Create provider adapters/interfaces for market, logistics, maps/routing, payments, notifications and verification. Do not tightly couple domain services to one vendor. Mock adapters are acceptable for SIH prototype/demo where production credentials are unavailable.

## Data Trust Rules
Always preserve provenance/freshness where external data is consumed:
- source
- source type
- retrieved/updated timestamp
- estimate/prediction/simulation status
- confidence where applicable

Never present simulated logistics availability, simulated GPS or simulated payment state as live.

## AI Principles
- AI should solve measurable problems, not exist only as decoration.
- Price forecast feeds Sell-vs-Store economics.
- Buyer matching should consider net realization, quality, quantity, trust, logistics and payment reliability.
- Logistics ranking should consider cost, ETA, vehicle suitability and reliability.
- AI predictions must include explanation/confidence and must not be represented as guarantees.

## Future Module Dependency Rules
- Market Intelligence consumes existing `MandiPrice`, `Crop`, `Mandi` and farmer location/crop context.
- Sell-vs-Store consumes market history/forecast + storage/logistics economics + `FarmerProfile` liquidity/storage preferences.
- Buyer Matching consumes actual lot/quality/demand data and FPO availability.
- Warehouse consumes farm location + crop/quantity + storage preference.
- Logistics consumes pickup/destination + quantity + shipment requirements.
- Future modules must reference existing entities instead of cloning them.

## Development Workflow for Coding Agents
1. Read this file first.
2. Read the module-specific build spec provided in the task.
3. Inspect only the current module's directly relevant files and dependencies.
4. Reuse existing utilities/services/components before adding new ones.
5. Make the smallest coherent change required.
6. Run typecheck/lint/tests relevant to changed code.
7. Run existing regression tests for prior modules.
8. Update module docs/readme only when implementation materially changes architecture.
9. Never reset or destructively replace the database to make a module work.

## Current Backend README
`backend/README.md` documents Modules 1–3, scripts, architecture, security decisions, demo accounts and test coverage.

## Quality Bar
A module is not complete merely because endpoints/pages exist. It must preserve:
- correct ownership/authorization
- data integrity and state transitions
- validation
- error/loading/empty states where frontend is involved
- API documentation
- tests
- observability
- compatibility with previous modules

## Do Not Assume
- Do not assume all external APIs are public.
- Do not assume warehouse vacancy or truck availability is live unless actually integrated.
- Do not assume payment/escrow functionality is regulated or live unless actually integrated.
- Do not assume AI forecasts are certain.
- Do not assume estimated crop supply is committed inventory.
