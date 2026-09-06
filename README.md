# FarmLink Intelligence Platform

**SIH26132** — Strengthening market linkages, price discovery, storage intelligence, and transparent agricultural trade workflows.

FarmLink is a modular backend platform built with **Express, TypeScript, Prisma, and PostgreSQL**. The project is being developed incrementally so each module reuses the authorization, audit, domain models, and service boundaries established by earlier modules.

> **Current implementation status:** Modules **1–13 are implemented**. Module **14 (Net Realization Calculator)** is the next major planned module.

## Implemented Modules

| # | Module | Status |
|---|---|---|
| 1 | Authentication & RBAC | ✅ Complete |
| 2 | Farmer & Farm Profile | ✅ Complete |
| 3 | FPO Management & Aggregation | ✅ Complete |
| 4 | Crop / Lot Management | ✅ Complete |
| 5 | Quality Grading | ✅ Complete |
| 6 | Market Intelligence & Mandi Prices | ✅ Complete |
| 7 | Price Forecasting | ✅ Complete |
| 8 | Sell vs Store Decision Engine | ✅ Complete |
| 9 | Warehouse Intelligence | ✅ Complete |
| 10 | Buyer Management & Verification | ✅ Complete |
| 11 | Buyer Demand | ✅ Complete |
| 12 | Farmer-Buyer Matching | ✅ Complete |
| 13 | RFQ / Offers / Negotiation | ✅ Complete |
| 14 | Net Realization Calculator | ⏳ Next |
| 15 | Transporter & Vehicle Network | ❌ Planned |
| 16 | Logistics Quote & Optimization | ❌ Planned |
| 17 | Shipment & GPS Tracking | ❌ Planned |
| 18 | Delivery & Quality Reconciliation | ❌ Planned |
| 19 | Payment Status Tracking | ❌ Planned |
| 20 | Digital Transaction Ledger | ❌ Planned |
| 21 | Dispute & Grievance Management | ❌ Planned |
| 22 | Notifications & Alerts | 🟡 Infrastructure/hooks exist; full module pending |
| 23 | Multilingual / Voice / Low-Connectivity | ❌ Planned |
| 24 | Fraud & Risk Detection | ❌ Planned |
| 25 | Analytics & Impact Dashboard | ❌ Planned |
| 26 | Admin & Government Dashboard | 🟡 Partial functionality exists; full module pending |
| 27 | External API / Integration Layer | 🟡 Provider/integration boundaries exist; full module pending |
| 28 | Audit, Security & Monitoring | 🟡 Shared infrastructure implemented across modules |
| 29 | AI/ML Platform | 🟡 Provider boundaries exist; standalone platform pending |

---

## Architecture

```text
farmlink/
├── backend/        Express + TypeScript + Prisma/PostgreSQL API
├── frontend/       Next.js + TypeScript + Tailwind UI
└── e2e/            Playwright end-to-end tests
```

The backend follows a modular architecture:

```text
Route
  ↓
Controller
  ↓
Service / Domain Engine
  ↓
Repository
  ↓
Prisma / PostgreSQL
```

Shared infrastructure includes authentication, RBAC, validation, response envelopes, structured errors, audit logging, Swagger, Redis caching boundaries, Sentry, and PostHog integration points.

---

# Module Overview

## Module 1 — Authentication & RBAC

Core identity and security foundation.

- Registration and login
- JWT access tokens
- Rotating HttpOnly refresh sessions
- Logout and logout-all-sessions
- Password change and reset flows
- Role-based access control
- Account status handling
- Rate limiting and security middleware
- Audit logging
- Swagger/OpenAPI
- OTP provider abstraction

---

## Module 2 — Farmer & Farm Profile

Farmer identity and agricultural context.

- Farmer profiles
- Multiple farms per farmer
- Structured location hierarchy
- Farmer crop records
- Irrigation and farm metadata
- Selling preferences
- Profile completion calculation
- Crop translations and reference data

---

## Module 3 — FPO Management & Aggregation

Farmer Producer Organization workflows.

- FPO registration and verification
- FPO administrator management
- Farmer membership lifecycle
- Membership approval and suspension
- Crop-wise supply aggregation
- Aggregation targets
- FPO analytics
- Government-facing read-only summaries
- Cross-FPO authorization protection

---

## Module 4 — Crop / Lot Management

The core transactional produce object.

- Farmer-owned and FPO-owned lots
- Draft creation and editing
- Publish/cancel lifecycle
- Append-only lot status history
- KG/QTL/TONNE normalization
- Decimal quantity handling
- Atomic quantity reservation foundations
- Farmer lot summaries
- FPO lot management

---

## Module 5 — Quality Grading & Produce Assessment

Trust-aware quality assessment.

- Manual quality assessments
- AI assessment provider boundary
- Lab/human verification workflows
- Flexible quality metrics and defects
- Crop-specific quality standards
- Grade calculation
- Image metadata handling
- Assessment history and supersession
- Confidence-aware AI workflow
- Human review for low-confidence assessments

AI output is never treated as certified truth automatically.

---

## Module 6 — Market Intelligence & Mandi Prices

Market data foundation and deterministic analytics.

- Mandi and historical price data
- Canonical INR/quintal normalization
- Historical ETL support
- Crop alias resolution
- Mandi resolution
- Import diagnostics
- data.gov.in provider integration boundary
- Incremental synchronization
- Redis locking for scheduled sync
- Price summaries and trends
- Volatility and anomaly analysis
- Arrivals analysis
- Freshness and confidence
- Nearby mandi discovery
- Regional benchmarks
- Explainable market ranking

Freshness states:

```text
FRESH → RECENT → STALE → OUTDATED
```

---

## Module 7 — Price Forecasting

Historical data preparation and deterministic price forecasting infrastructure.

- Forecast persistence model
- Mandi, regional, and crop-wide scopes
- Idempotent forecast scope keys
- Data sufficiency checks
- Historical data preparation
- Per-mandi/day aggregation
- Regional and crop-wide aggregation
- Gap and coverage analysis
- Outlier flagging
- Forecast configuration
- Forecast repository and caching
- Forecast service and API layer
- Forecast model/engine boundaries

The forecasting pipeline is designed to remain explainable and data-sufficiency-aware rather than silently generating predictions from sparse data.

---

## Module 8 — Sell vs Store Decision Engine

A decision layer combining market, quality, and storage context.

- Immutable decision snapshots
- Decision history
- Market input resolution
- Quality context resolution
- Storage context handling
- Deterministic scoring engine
- SELL_NOW / STORE / INSUFFICIENT_DATA outcomes
- Confidence scoring
- Factor tracking
- Weight rebalancing when data is unavailable
- Historical explainability metadata
- Authorized lot-scoped APIs
- Optional AI advisory provider boundary

The core decision remains deterministic. Advisory AI does not replace the stored deterministic result.

---

## Module 9 — Warehouse Intelligence

Storage discovery, suitability, risk, and recommendation.

- Warehouse management foundation
- Storage units
- Crop storage capabilities
- Storage rates
- Storage reservations
- Crop storage requirements
- Capacity and availability analysis
- Storage eligibility
- Environmental suitability
- Storage risk analysis
- Warehouse recommendation and ranking
- Weighted scoring
- Storage intelligence provider boundary
- Warehouse APIs and authorization

---

## Modules 10–13 — Buyer & Trade Workflow

These modules are implemented as connected backend capabilities.

### Module 10 — Buyer Management & Verification

- Buyer profiles
- Business information
- Location preferences
- Buyer verification status
- Buyer-specific account context

### Module 11 — Buyer Demand

- Crop demand declarations
- Required and minimum quantities
- Quality requirements
- Price ranges
- Delivery preferences
- Demand lifecycle
- Lazy expiration
- Committed quantity protection

### Module 12 — Farmer-Buyer Matching

Deterministic matching based on:

- Crop compatibility
- Quality compatibility
- Quantity fit
- Location proximity
- Ranking scores

No AI or ML is required for matching. Identical inputs produce identical rankings.

### Module 13 — RFQ / Offers / Negotiation

Trade offer lifecycle infrastructure.

- Offers against lots/demands
- Offer revisions
- Counter-offers
- Accept/reject/withdraw flows
- Expiration
- Atomic quantity reservation guards
- Double-booking protection
- Trade offer state transitions

---

# End-to-End Platform Flow

The implemented modules now support the following core intelligence and trade preparation flow:

```text
Farmer
  │
  ├── Farm & Crop Profile
  │
  ├── Produce Lot
  │
  ├── Quality Assessment
  │
  ├── Market Intelligence
  │
  ├── Price Forecast
  │
  ├── Sell vs Store Decision
  │
  ├── Warehouse Intelligence
  │
  └── Buyer Matching
         │
         ├── Buyer Demand
         └── Offers / Negotiation
```

The next stage extends this into complete economic and logistics execution:

```text
Offer
 ↓
Net Realization Calculation
 ↓
Transporter Selection
 ↓
Logistics Optimization
 ↓
Shipment Tracking
 ↓
Delivery Reconciliation
 ↓
Payment & Ledger
 ↓
Dispute Resolution
```

---

# Next Module

## Module 14 — Net Realization Calculator

This is the next planned major module.

It will provide a transparent calculation of the farmer's expected realization after accounting for available costs and deductions.

Conceptually:

```text
Gross Sale Value
− Storage Cost
− Transport Cost
− Platform / Handling Charges
− Other Applicable Costs
────────────────────────────
= Estimated Net Realization
```

Unknown costs should remain explicitly unavailable rather than fabricated.

---

## Quick Start

### Backend

```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
npm run dev
```

Backend runs on:

```text
http://localhost:4000
```

Swagger documentation:

```text
http://localhost:4000/api/docs
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Tests

```bash
cd backend
npm test
```

---

# Engineering Principles

FarmLink follows several important implementation rules:

- **Authorization is server-side**
- **Ownership is derived from the authenticated session**
- **Public IDs are used for externally exposed resources**
- **Financial and quantity values use precise Decimal storage where required**
- **Historical decisions and assessments remain explainable**
- **AI providers fail honestly instead of fabricating results**
- **Deterministic engines remain reproducible**
- **Atomic guards protect against concurrent over-commitment**
- **Existing module logic is reused instead of duplicated**
- **Unknown data is represented as unavailable, not guessed**
- **Audit trails are preferred for important state transitions**

---

## Technology Stack

- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Caching / locking:** Redis
- **Validation:** Zod-based schemas
- **API documentation:** Swagger / OpenAPI
- **Observability:** Sentry + PostHog integration
- **Testing:** Jest + Supertest
- **Frontend:** Next.js + TypeScript + Tailwind CSS
- **E2E:** Playwright

---

## Roadmap

**Completed:** Agricultural identity → production lots → quality → market intelligence → forecasting → sell/store intelligence → warehouse intelligence → buyer demand/matching → offers.

**Next:** Net realization → logistics → shipment → delivery → payments → ledger → disputes → notifications → analytics → platform intelligence.

FarmLink is evolving from a farmer information system into a full agricultural decision and transaction infrastructure platform. 🌾
