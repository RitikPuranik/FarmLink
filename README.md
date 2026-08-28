# FarmLink Intelligence — Module 1: Authentication & RBAC

**SIH26132** — Strengthening market linkages and price discovery for farmers.

This repository contains **Module 1 only**: identity, authentication,
session management, and role-based access control. It is the security
foundation every later FarmLink module (farms, crops, market prices,
buyers, logistics, warehouses, grievances, analytics…) builds on — those
modules are explicitly out of scope here.

```
farmlink/
  backend/    Express + TypeScript + Prisma/PostgreSQL API (see backend/README.md)
  frontend/   Next.js + TypeScript + Tailwind auth UI
  e2e/        Playwright end-to-end flow (register → login → dashboard → logout)
```

## Quick start

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env          # fill in real secrets
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed           # optional demo farmer
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

Demo login (after seeding): mobile `9876543210`, password `DemoFarmer123!`.

## What's implemented

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
- Frontend: login/register/forgot-password/reset-password screens, a real
  farmer dashboard, "not yet enabled" placeholders for the other 6 roles,
  centralized auth state (React Query), English/Hindi/Marathi i18n,
  mobile-first responsive layout
- 72 backend tests (unit + integration, including explicit privilege-
  escalation and RBAC security tests) + a Playwright E2E flow

## Verification status (read this before assuming something's broken)

This was built in a network-sandboxed environment that could reach npm and
GitHub but **not** `binaries.prisma.sh`, so Prisma's query/schema-engine
binaries couldn't be downloaded here. Practical effect:

- Backend logic, RBAC, and the full Jest+Supertest suite (72/72 passing)
  were verified using an in-memory fake repository instead of a live
  Prisma client — see `backend/tests/testUtils/`.
- `tsc --noEmit` on the backend is clean **except** for 12 errors, all of
  the same shape (`Module '@prisma/client' has no exported member 'User'`
  etc.) — these are the types Prisma generates from `schema.prisma` and
  simply don't exist until you run `npx prisma generate` on a machine with
  normal internet access. Every other file compiles cleanly.
- The frontend has a full clean `next build` and `next lint` pass in this
  sandbox — no caveats there.

Run the three backend commands in "Quick start" once and both issues
resolve themselves; nothing about the sandbox limitation should require
touching application code.

## Design notes worth knowing before you extend this

- **`app.ts` is dependency-injected.** `createApp({ authRepository,
  auditService, prisma })` never touches Prisma directly — `server.ts` is
  the only file that constructs a real `PrismaClient`. This is what let the
  test suite run without a database in this sandbox, and it's also just a
  cleaner boundary for whoever adds Module 2.
- **No generic `PATCH /api/users/:id`.** Per the spec, self-service profile
  edits go through `/api/auth/*` (identity from the verified session), and
  there is deliberately no endpoint that would let a client rewrite anyone's
  role.
- **Frontend route protection is UX only.** `ProtectedRoute` /
  `RoleProtectedPage` redirect for a better experience, but every protected
  API call is independently re-checked server-side regardless — see
  `backend/src/modules/auth/auth.middleware.ts`.
- **Cookies vs. bearer tokens:** the refresh token lives in an HttpOnly,
  Secure (in prod), SameSite cookie scoped to `/api/auth`, never reachable
  from JS. The short-lived access token is returned in the JSON body and
  kept in memory on the frontend (not localStorage), sent via
  `Authorization: Bearer`.

## What's next (Module 2+, not in this repo)

Farmer/FPO/buyer/transporter/warehouse profiles, farms, crops, lots, market
price discovery, AI features, offers, payments, shipments, grievances,
analytics. All of them consume the identity this module issues
(`userId`, `publicId`, `role`, `accountStatus`, `preferredLanguage`) without
duplicating auth logic.
