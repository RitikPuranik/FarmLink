# FarmLink Intelligence — Backend (Module 1: Auth & RBAC)

SIH26132 — Strengthening market linkages and price discovery for farmers.
This is **Module 1 only**: identity, authentication, session management, and
role-based access control. Every future FarmLink module (farms, crops,
market prices, buyers, logistics, warehouses…) builds on the user identity
this module issues — it does not duplicate auth logic.

## Stack

Express + TypeScript, Prisma + PostgreSQL, Redis (rate limiting, optional),
Argon2id password hashing, JWT access tokens + rotating HttpOnly refresh
cookies, Zod validation, Swagger/OpenAPI, Jest + Supertest.

## Getting started

```bash
npm install
cp .env.example .env      # fill in real secrets — never commit .env
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed       # optional — creates a demo FARMER account
npm run dev
```

The API is at `http://localhost:4000`, docs at `http://localhost:4000/api/docs`.

> **Note on this build environment:** the sandbox this project was built in
> could not reach `binaries.prisma.sh` to download Prisma's query/schema
> engine binaries, so `prisma generate`/`migrate` could not be run here.
> Everything else — repository/service/controller logic, RBAC, validation,
> the full Jest+Supertest suite (72 tests) — was written and verified
> against an in-memory fake repository instead (`tests/testUtils/`), and
> `tsc --noEmit` was run to confirm the **only** compile errors in the whole
> codebase are the 12 Prisma-generated type imports (`User`, `UserRole`,
> etc.) that don't exist until you run `prisma generate` locally. Run the
> three commands above once and everything resolves normally.

### Demo account (development only)

```
Mobile:    9876543210
Password:  DemoFarmer123!
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with hot reload |
| `npm run build` / `npm start` | Production build + run |
| `npm test` | Full Jest suite (unit + integration, in-memory repo) |
| `npm run test:unit` / `test:integration` | Just one half of the suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | Create/apply a dev migration |
| `npm run prisma:seed` | Seed the demo farmer |

## Architecture

```
src/
  config/       env validation, logger, prisma client, redis, swagger, sentry/posthog stubs
  common/       error classes, API response envelope, asyncHandler
  middleware/   error handler, 404, rate limiters, security headers, body validation
  modules/
    auth/       controller → service → repository, RBAC middleware, schemas, OTP abstraction
    audit/      audit log service
    users/      minimal ADMIN-only demo route (proves RBAC end-to-end)
  app.ts        Express app factory — takes injected dependencies, never touches Prisma directly
  server.ts     composition root — the only file that constructs the real PrismaClient
```

`app.ts` is dependency-injected on purpose: `createApp({ authRepository, auditService, prisma })`.
Tests pass an in-memory fake `AuthRepository`; `server.ts` passes the real
Prisma-backed one. This is also why the test suite runs without a live
database — see `tests/testUtils/`.

### Security model (what to point reviewers at)

- **Role is never client-supplied.** `registerRequestSchema` uses Zod's
  `.strict()`, so a `role` field anywhere in a registration payload makes
  the *whole request* fail validation — it's never silently dropped or
  assigned. There is deliberately no `PATCH /api/users/:id` endpoint that
  could let anyone rewrite their own or someone else's role.
- **Backend is authoritative.** `authenticate()` re-verifies the JWT and
  re-checks account status against the database on *every* request — a
  forged header, a stale token, or a suspended-but-still-unexpired token
  are all rejected.
- **Generic auth errors.** Wrong password vs. unknown mobile return the
  exact same message/status, so login can't be used to enumerate accounts.
- **Password reset tokens** are single-use, short-lived, and only the
  SHA-256 hash is stored — same pattern as refresh tokens.
- **Refresh token rotation.** Every `/api/auth/refresh` call revokes the
  used token and issues a new one.
- **`change-password` and `reset-password`** revoke every other session —
  see spec section 18/20.

See `tests/integration/rbac.security.test.ts` for the executable version of
all of the above (privilege escalation, RBAC enforcement, suspended-account
handling, oversized payloads).

## What's intentionally not in Module 1

Per the build spec: no farmer profiles/farms/crops/lots/market
prices/AI/warehouses/buyers/logistics/offers/payments/shipments/grievances/
analytics. Only `FARMER` gets a real registration UX; every other role in
`UserRole` exists in the schema/RBAC system today so future modules don't
need a migration to add them, but has no dashboard yet.
