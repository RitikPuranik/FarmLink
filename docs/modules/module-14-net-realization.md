# Module 14 — Net Realization Calculator

## Purpose

Given a crop lot, answer: "if the farmer sells through this particular
buyer offer, market, or a hypothetical price, approximately how much will
they actually realize after known costs and deductions?"

The calculator is **deterministic only** — no AI/LLM, no machine learning,
no price-forecasting algorithm, no probabilistic recommendation is used
anywhere in this module. The same input always produces the same output.

Its single most important behavior: **a cost or a price this module has no
real data for is never fabricated and never treated as zero.** A missing
transport cost stays missing — it is surfaced as an explicit
`unavailable` entry, not silently absorbed into a confident-looking
`netRealization` number.

## Parts A–T status

| Part | Scope | Status |
| --- | --- | --- |
| A | Data model (`NetRealizationCalculation` + enums) | Done |
| B | Calculation input contract (`net-realization.types.ts`) | Done |
| C/D | Input resolution — price + costs (`net-realization-input-resolver.service.ts`) | Done, scoped to what this schema actually has (see "Cost resolution" below) |
| E/F/G | Deterministic engine, completeness, explanation (`net-realization-calculator.service.ts`) | Done |
| H | Persistence (`net-realization.repository.ts`) | Done |
| I | Orchestration (`net-realization-orchestration.service.ts`) | Done |
| J | Authorization (`net-realization.controller.ts`, reusing `LotAuthorizationService`) | Done |
| K | REST API (`net-realization.routes.ts`) | Done |
| L | Request validation (`net-realization.schemas.ts`) | Done |
| M | DTO mapping | Done (`NetRealizationOrchestrationService.mapToDTO`) |
| N | Centralized disclaimer | Done (`net-realization.config.ts`) |
| O | Caching | Not added — see "Non-goals / deliberate omissions" |
| P | Observability (PostHog/Sentry/audit) | Done |
| Q | Swagger | Done (inline `@openapi` blocks in `net-realization.routes.ts`) |
| R | Tests | Done — see "Tests" below for exact coverage, not a re-listing of every bullet in the original spec |
| S | Performance (bounded/paginated queries) | Done |
| T | Future compatibility | Done — see "Cost resolution" and "Future integration points" |

## Architecture

```
resolve inputs (NetRealizationInputResolverService)
  -> pure deterministic engine (NetRealizationCalculatorService)
  -> persist immutable snapshot + metadata (NetRealizationRepository)
  -> mark COMPLETED / INSUFFICIENT_DATA / FAILED
  -> return DTO (NetRealizationOrchestrationService.mapToDTO)
```

Coordinated by `NetRealizationOrchestrationService.calculate`, called from
`net-realization.controller.ts`'s `calculate` handler. This mirrors Module
8 (Sell vs Store)'s own resolver → engine → repository → orchestration →
controller → routes shape almost exactly, since Module 8 is this module's
closest architectural precedent in the codebase.

### The engine never guesses

`NetRealizationCalculatorService.evaluate` is a pure function: no database
calls, no HTTP calls, no clock reads, no randomness (mirrors
`sell-store-decision-engine.service.ts`'s own zero-Prisma-dependency
design). Given the same `NetRealizationInput`, it always returns the same
`CalculationEngineResult` — asserted directly in
`tests/unit/net-realization-calculator.service.test.ts`'s determinism
test.

Formula:

```
grossRevenue   = salePricePerUnit x saleQuantity
netRealization = grossRevenue - totalKnownCosts - totalEstimatedCosts - totalUserProvidedCosts
```

Only cost components with an actually-resolved amount (`ACTUAL`,
`ESTIMATED`, `USER_PROVIDED`, or `MARKET_REFERENCE`) are ever subtracted.
A category the resolver could not resolve is returned in
`omittedComponents` and is **never** subtracted as if it were zero. If the
sale price or quantity itself could not be resolved, the engine returns
`completeness: "INSUFFICIENT"` and `grossRevenue`/`netRealization: null` —
never `0`, which would misrepresent "unknown" as "the farmer gets
nothing."

### Completeness, not confidence

`RealizationCompleteness` is `COMPLETE` / `PARTIAL` / `INSUFFICIENT`,
computed purely from which cost categories actually resolved — never a
statistical or AI confidence score. `dataCompletenessScore` is
`resolved / (resolved + unavailable)` among the categories that were
actually applicable to this calculation, named exactly that (not
"confidence") to avoid implying prediction.

### Explanation is template-based, not AI-generated

`buildExplanation` in `net-realization-calculator.service.ts` assembles
`includedFactors`, `omittedFactors`, `assumptions`, and `warnings` from a
fixed set of string templates keyed off the resolved price source type and
which cost categories were/weren't available. The same input always
produces the same explanation text, exactly as reproducible as the numbers
it describes.

### Decimal-safe arithmetic without a live Prisma client dependency

The rest of this codebase does money math with `Prisma.Decimal` wherever a
live `PrismaClient` is already in scope (see `buyer-matching.service.ts`).
The calculation engine deliberately has **no** Prisma dependency at all,
matching `sell-store-decision-engine.service.ts`'s own zero-Prisma-import
precedent, so it can be unit-tested with zero infrastructure. To still
satisfy "never use floating-point arithmetic for money" without that
dependency, `net-realization-money.ts` implements a small `Money` helper:
amounts are represented internally as a `bigint` count of paise, so
summing many cost components can never accumulate the drift native
IEEE-754 floats would (see `net-realization-money.test.ts`, including a
0.1-rupee-repeated-1000-times regression case). Amounts only leave `Money`
(via `.toNumber()`) at the engine's output boundary — the same "Decimal
internally, plain `number` above the boundary" convention
`PROJECT_CONTEXT.md`'s Module 4 quantity-normalization section already
documents for this codebase.

### Price resolution — adapted to what this schema actually has

The original spec's suggested priority order assumed a separate
RFQ/negotiation model. This repository only has Module 7's `TradeOffer`
(no distinct RFQ model), so the resolver's real, deterministic priority
is:

1. An explicitly requested `offerPublicId` (must belong to the lot being
   calculated) — labeled `OFFER` (or `ACCEPTED_OFFER` if that offer's
   status happens to be `ACCEPTED`), source `ACTUAL`.
2. The lot's own `ACCEPTED` `TradeOffer`, auto-detected — labeled
   `ACCEPTED_OFFER`, source `ACTUAL`. This is the closest thing the
   system has to a confirmed sale.
3. An explicit `salePricePerUnit` on the request — a what-if calculation,
   labeled `USER_PROVIDED`.
4. A recent `MandiPrice` market reference for the crop near the lot's
   origin (district → state → national fallback, reusing
   `MarketIntelligenceRepository.latestMarkets` exactly as
   `sell-store-input-resolver.service.ts` does) — labeled
   `MARKET_REFERENCE`, explicitly **not** a confirmed sale price.
5. Otherwise: `type: "UNAVAILABLE"` — never fabricated.

Sale quantity defaults to the resolved offer's own committed quantity when
the price came from an offer, or the lot's full `availableQuantityKg`
otherwise; an explicit `saleQuantity` override always wins. All of this is
validated (`INVALID_SALE_PRICE`, `INVALID_QUANTITY`) before it ever
reaches the engine.

### Cost resolution — only ever real data, never a fabricated rate

No Transport/Logistics, Payment, or Transaction Ledger module exists yet
in this schema (see `PROJECT_CONTEXT.md`'s "Next planned business
modules"). Accordingly:

- **TRANSPORT, LOADING, UNLOADING, PACKAGING, COMMISSION, MARKET_FEE,
  TAX, INSURANCE** can only ever be resolved from an explicit
  `USER_PROVIDED` value on the request today. There is deliberately no
  per-km rate, no guessed commission percentage, and no invented market
  fee anywhere in this module — a category with nothing supplied is
  always returned in `costs.unavailable` with a `*_COST_UNAVAILABLE`
  reason.
- **STORAGE** is the one category with a real, already-implemented,
  non-fabricated estimator: Module 9 Part 6's
  `StorageIntelligenceProvider.resolveStorageContext()`. When it returns a
  non-null `estimatedCost`, that becomes the `STORAGE` component, source
  `ESTIMATED`. This is consumed as-is; this module adds no new storage-
  cost logic of its own. If a caller supplies their own `STORAGE` cost
  override, that wins instead (labeled `USER_PROVIDED`).
- **OTHER** is a variable-length, caller-only category for anything not
  covered by a named one (e.g. a weighbridge fee), each entry
  distinguished by a required `name`.

Every named category is still *evaluated* on every calculation — a
category with no backing data is explicit (`unavailable`, with a reason),
never simply absent from the response.

### Future integration points (Part T)

Adding a real Transport/Logistics, Commission/Fee, or Payment/Ledger
module later only means implementing another cost resolver inside
`NetRealizationInputResolverService.resolveCosts` and wiring its output
the same way `STORAGE` already is — the calculation engine itself never
needs to change, since it only ever consumes already-resolved
`CostComponent[]`/`UnavailableCostComponent[]` arrays.

## Authorization

Reuses the exact same `LotAuthorizationService` Module 8 already uses —
no second, Net-Realization-specific authorization system.
`net-realization.controller.ts`'s `ensureAuthorizedForLot` resolves the
lot, resolves the caller's `FarmerProfile` only when the caller is a
`FARMER`, and calls `LotAuthorizationService.canViewLot`. An unauthorized
or nonexistent lot both return `404` (never `403`), so the response never
confirms which lots exist for someone who shouldn't be able to see them.
`GET /:publicId` authorizes against the calculation's own `lotId` after
fetching it — the calculation is never recomputed, only gated.

The router applies the same coarse `requireAnyRole("FARMER", "FPO_ADMIN",
"ADMIN")` gate Module 8 uses before authentication-only access; a
`BUYER`, `TRANSPORTER`, or `WAREHOUSE_OPERATOR` account gets `403` before
any lot lookup happens at all.

## API

- `POST /api/net-realization/lots/:lotPublicId/calculate` — runs a new
  calculation. Every field in the body is optional.
- `GET /api/net-realization/:publicId` — returns a persisted historical
  calculation exactly as resolved. Never recomputed.
- `GET /api/lots/:lotPublicId/net-realizations` — paginated history for a
  lot (`page`, `pageSize`, capped at 100 per page), newest first.

Full request/response schemas are documented inline via `@openapi` blocks
in `net-realization.routes.ts` and served at `/api/docs`.

## Observability

- **PostHog**: `net_realization_requested`, `net_realization_completed`,
  `net_realization_insufficient_data`, `net_realization_failed` — each
  carries only `lotPublicId` and `completeness`/status, never an exact
  financial figure (see `config/posthog.ts`'s allow-list comment for this
  module).
- **Sentry**: unexpected failures are captured with `operation:
  "net_realization_calculation"`, the lot's public ID, and
  `calculationVersion` — never the full financial snapshot.
- **Audit**: `NET_REALIZATION_CALCULATION_CREATED`, `_COMPLETED`,
  `_INSUFFICIENT_DATA`, and `_FAILED` are recorded via the existing
  `AuditService` (Module 8's own optional-6th-argument pattern). An
  audit-logging failure is reported to Sentry but never fails or
  downgrades the calculation. Routine `GET` reads are intentionally not
  audited, matching the codebase-wide "reads aren't audited" convention.

## Data limitations (read this before trusting a number from this module)

- If a lot has no accepted offer, no user-supplied price, and no recent
  mandi price for its crop/region, **no net realization can be
  calculated at all** — the response will be `INSUFFICIENT_DATA` with
  `netRealization: null`.
- Even a `COMPLETE` result only reflects costs this system actually has
  data for today. Because no Transport/Logistics/Payment module exists
  yet, "COMPLETE" in practice usually means "every cost category that
  *could* be resolved was — including possibly none, if nothing was
  user-provided and storage estimation didn't apply." Always read
  `costs.unavailable` and the disclaimer, not just the completeness
  label.
- `MARKET_REFERENCE` prices are recent mandi averages, not a confirmed
  sale — treat any resulting `netRealization` as an estimate, not a
  guarantee, exactly as the disclaimer says.

## Disclaimer

Every response — `COMPLETE`, `PARTIAL`, or `INSUFFICIENT_DATA` — includes,
verbatim, from `net-realization.config.ts`:

> Net realization is calculated from currently available price and cost
> data. Unavailable costs are not treated as zero and may change the
> final amount. This calculation is informational and does not guarantee
> final settlement.

## Non-goals / deliberate omissions

Confirmed **not** implemented, per the original task's explicit
non-goals:

- No AI/LLM/Gemini/OpenAI integration, no machine learning, no price
  forecasting algorithm.
- No fabricated per-km transport rate, no guessed commission/fee
  percentage, no invented logistics optimization.
- No payment processing, transaction ledger, or shipment tracking.
- No frontend/UI.
- No Redis caching (Part O) — was optional in the spec, and with no
  automatic cost resolver besides `STORAGE` (already backed by Module
  9's own caching, if any) there was no clear win from adding a second
  caching layer here; historical calculations are already immutable and
  cheap to read by `publicId`.

## Known inefficiency (documented, not fixed)

`NetRealizationInputResolverService.resolve` and
`NetRealizationOrchestrationService.calculate` each independently call
`CropLotRepository.findByPublicId`/`findById` for the same lot — the same
duplicated-lookup shape `module-08-sell-vs-store.md` documents for its own
resolver/orchestrator split. Not fixed here for the same reason: doing so
would change either service's public call shape, and both already have
dedicated unit tests asserting the current one.

## Tests

- `tests/unit/net-realization-money.test.ts` (7 tests) — Decimal-safe
  arithmetic: no float drift on repeated fractional sums, subtraction,
  multiplication/rounding, rejecting non-finite input.
- `tests/unit/net-realization-calculator.service.test.ts` (16 tests) —
  gross revenue, COMPLETE/PARTIAL/INSUFFICIENT outcomes, missing costs
  never treated as zero, known/estimated/user-provided cost separation,
  `isIncludedInPrice` never double-subtracted, multiple `OTHER` lines,
  zero-valued (but resolved) costs, determinism, and the disclaimer
  appearing in every outcome.
- `tests/unit/net-realization-input-resolver.service.test.ts` (14 tests)
  — the full price priority cascade (explicit offer → accepted offer →
  user-provided → market reference → unavailable), offer-lot ownership
  validation, negative price/quantity/cost rejection, `STORAGE`
  resolution via the existing `StorageIntelligenceProvider`, every named
  category surfacing as `unavailable` with a real reason when nothing
  backs it, and multiple `OTHER` cost entries.
- `tests/unit/net-realization-orchestration.service.test.ts` (9 tests) —
  full successful lifecycle, `INSUFFICIENT_DATA` as a valid non-exception
  outcome, unexpected errors marking `FAILED` and rethrowing, missing-lot
  short-circuiting before touching the resolver/engine/repository,
  historical retrieval never recomputing, audit calls (including that an
  audit failure never fails the calculation), and paginated listing.
- `tests/unit/net-realization.repository.test.ts` (8 tests) — every
  lifecycle persistence call (`createPendingCalculation`,
  `completeCalculation`, `markInsufficient`, `failCalculation`,
  `findByPublicId`, `listByLotId`), plus pagination bounds/clamping.
- `tests/integration/net-realization.routes.test.ts` (16 tests) —
  authentication, per-lot authorization (including obfuscated 404s),
  role-gate `403`s, request-body validation (negative price/cost, a
  nameless `OTHER` line, an unknown field), `INSUFFICIENT_DATA` returning
  `200` not an error, and pagination query clamping.

This is deliberately not a line-by-line re-implementation of every bullet
in the original task's Part R test list (some of those bullets describe
the same behavior from a slightly different angle, and some — e.g.
"Swagger route registration" — are better verified by inspecting the
generated spec than by a dedicated test). What's covered above is every
distinct *behavior* that list was checking for.

## Verification

Run inside `backend/`:

```
npm install
npx prisma format
npx prisma validate
npx prisma generate
npx tsc --noEmit
npm test
```

In this development sandbox, `prisma format`/`validate`/`generate` all
fail with an engine-download `403 Forbidden` from `binaries.prisma.sh` —
a pre-existing, already-documented environment limitation
(`prisma/README-engines.md`), not something introduced by this module.
Because the Prisma Client was never generated here, `tsc --noEmit`
reports "no exported member" for every model/enum across the *entire*
codebase (not just this module) and a few `Prisma.Decimal`-related
failures in pre-existing files (`buyer-matching.service.ts`,
`sell-store-orchestration.service.test.ts`) — all in the same class of
error, confirmed by grepping the output: every one of this module's own
23 reported errors is exactly "`@prisma/client` has no exported member
X" or "`Prisma.InputJsonValue` doesn't exist," never a genuine logic or
type error. `npm test` (which uses `ts-jest` in transpile-only mode and
therefore never needs the generated client) passes all 70 of this
module's own tests; the only 3 pre-existing failing suites elsewhere in
the repo are unrelated to this module (2 for the identical
`Prisma.Decimal`-not-generated reason, 1 a pre-existing warehouse-ranking
assertion).

`tests/setupEnv.ts` loads `backend/.env.test`, which did not exist in
this checkout; a local-only `.env.test` with dummy (non-secret) values
matching `.env.example`'s shape was added so the suite could run here —
whatever real environment runs this repo's CI/dev setup should already
have its own `.env.test`, or needs one created the same way.
