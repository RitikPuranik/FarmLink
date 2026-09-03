# Module 8 — Sell vs Store Decision Engine

## Purpose

Given a crop lot, decide whether the farmer should sell now or store the
produce, using deterministic rules over market, quality, and storage data.
The result is one of `SELL_NOW`, `STORE`, or `INSUFFICIENT_DATA`.

## Parts 1–7 status

| Part | Scope | Status |
| --- | --- | --- |
| 1 | Input resolution (`DecisionInputResolverService`) | Done |
| 2 | Storage data source | Not implemented — storage is always resolved as `UNKNOWN`/null (see `sell-store-input-resolver.service.ts`) |
| 3 | Deterministic decision engine (`DecisionEngineService`) | Done |
| 4 | Persistence (`SellStoreDecisionRepository`) | Done |
| 5 | Orchestration, controller, routes | Done |
| 6 | AI Advisory Layer | Done |
| 7 | Final integration, hardening, verification | Done — this document |

## Architecture

```
resolve inputs (DecisionInputResolverService)
  -> deterministic engine (DecisionEngineService)
  -> persist deterministic decision (SellStoreDecisionRepository)
  -> build AI context (ai/sell-store-ai-context.builder.ts)
  -> attempt AI advisory (SellStoreAIProvider)
  -> return { ...deterministicDecision, aiAdvisory }
```

All of this is coordinated by `SellStoreOrchestrationService.generateDecision`,
called from `sell-vs-store.controller.ts`'s `analyze` handler.

### The deterministic engine is authoritative

`DecisionEngineService` produces `result`, `sellScore`, `storeScore`,
`confidence`, `factorsUsed`, `omittedFactors`, and `insufficiencyReasons`.
These are computed and persisted (via `SellStoreDecisionRepository.completeDecision`)
**before** any AI code runs. Nothing after that point — including the AI
advisory step — can change them. `SellStoreDecisionDTO.result`,
`.confidenceScore`, `.decisionMetadata`, and `.inputSnapshot` always reflect
exactly what the deterministic engine computed.

### AI is optional and advisory-only

Module 8 Part 6 adds an AI advisory layer under `src/modules/sell-vs-store/ai/`:

- `sell-store-ai.types.ts` — `SellStoreAIContext` (the compact input),
  `SellStoreAdvisoryResult` (the validated output shape), and
  `SellStoreAIProviderError` (the single typed failure).
- `sell-store-ai.provider.ts` — the `SellStoreAIProvider` interface
  (`analyze(context): Promise<unknown>`) plus `UnavailableSellStoreAIProvider`,
  the default implementation.
- `sell-store-ai-context.builder.ts` — `buildSellStoreAIContext(input, decision)`,
  a pure allow-list mapping from already-resolved decision data to the
  compact context. Never touches raw Prisma rows.
- `sell-store-ai-guardrails.ts` — `SELL_STORE_AI_SYSTEM_PROMPT`, the concise
  system prompt a real provider implementation should send, plus a JSON
  payload serializer.
- `sell-store-ai-response.schema.ts` — a `.strict()` Zod schema
  (`parseSellStoreAdvisoryResponse`) that bounds string lengths and array
  sizes and rejects any response with unexpected fields.

The AI's job is limited to: explaining the decision, summarizing evidence,
naming risks, naming data limitations, and stating whether it agrees with
the deterministic result (`advisoryAlignment`). It cannot change the result,
scores, confidence, `decisionMetadata`, or `inputSnapshot` — the code path
never gives it the ability to; `aiAdvisory` is a separate, additive field.

### Provider boundary

The core engine and orchestrator depend only on the `SellStoreAIProvider`
interface, never on a specific vendor SDK. This repository currently has no
AI vendor SDK, credentials, or endpoint configured for sell/store advisory —
the same situation as the existing Quality module's
`UnavailableQualityAIProvider` — so `UnavailableSellStoreAIProvider` is wired
as the default in `app.ts`. It always rejects with
`SellStoreAIProviderError("AI_ADVISORY_UNAVAILABLE", ...)`; it never
fabricates advice. A real provider (e.g. a Gemini REST call) can be added
later by implementing `SellStoreAIProvider.analyze` and swapping the
`sellStoreAiProvider` passed into `SellStoreOrchestrationService` in
`app.ts` — no other file needs to change. If a real provider is added, its
raw output must still pass through `parseSellStoreAdvisoryResponse` before
being trusted.

### AI failure behavior

`SellStoreOrchestrationService.attemptAdvisory` runs strictly after the
deterministic decision is persisted and is written so it can never throw:
any failure — no provider configured, timeout, quota, network failure,
malformed response, or schema validation failure — is caught, converted to
`SellStoreAIProviderError`, reported via `advisory_failed`
(`config/posthog.ts`) and `captureException` (`config/sentry.ts`), and
resolved as `aiAdvisory: null`. The deterministic decision is never marked
`FAILED` because of an AI problem. Successful analyze attempts fire
`advisory_success`; every attempt fires `advisory_requested` first. None of
these events include the AI context, the provider's raw payload, or any PII
— only the lot's public ID, the provider name, and (on failure) the error
code.

### Privacy

The AI context (`SellStoreAIContext`) is a hard allow-list — crop
name/quantity/unit/quality grade, market price/trend/volatility/freshness/
confidence, storage availability/cost/duration/spoilage/constraints, and the
deterministic decision's own fields. It never includes database IDs, user
names, phone numbers, emails, addresses, precise coordinates, audit logs,
secrets, or raw market history/Prisma rows — those never exist in the
resolver/engine output the builder reads from, and the builder only ever
reads named fields (it never spreads its inputs), so nothing else can leak
through even if those upstream shapes grow new fields later.

### No forecasting, no override

`SELL_STORE_AI_SYSTEM_PROMPT` (`sell-store-ai-guardrails.ts`) explicitly
forbids predicting future prices, guaranteeing profit, claiming certainty,
or recommending against the deterministic result — it may only note where
the evidence feels weaker or stronger than that result. This is a prompting
guardrail; the schema validation and the "AI can't touch persisted fields"
architecture are what actually enforce the outcome regardless of what a
provider returns.

### Current limitations

- **Storage data**: `DecisionInputResolverService` has no storage data
  source yet (Part 2), so `SellStoreAIContext.storage.availability` is
  always `"UNKNOWN"` and the other storage fields are always `null`. The AI
  is expected to call this out as a data limitation, not infer it.
- **AI provider**: no real vendor is configured; `UnavailableSellStoreAIProvider`
  is always used, so `aiAdvisory` is currently always `null` in a default
  deployment. The advisory pipeline (context building, validation, failure
  handling, telemetry) is fully implemented and tested against fake
  providers so a real one can be dropped in later.
- **No persistence**: `aiAdvisory` is never written to the database.
  Historical decisions retrieved via `getDecisionByPublicId` /
  `getDecisionsForLot` always return `aiAdvisory: null`.
- **`/lots/:lotPublicId/history` has no pagination contract**: unlike
  lots/quality assessments/FPO membership (which all accept `page`/`limit`
  query params), this endpoint returns every `COMPLETED` decision for the
  lot as a flat array. `SellStoreDecisionRepository.listByLotId` applies a
  defensive `take: 200` cap so a very long-lived lot can't force an
  unbounded query, but a caller cannot page through results beyond that.
  Introducing real pagination would change the response shape and is a
  breaking API change against the existing test contract
  (`sell-vs-store.routes.test.ts` asserts a bare array today) — left as a
  follow-up rather than done in Part 7.
- **Duplicate lot lookups per `/analyze` call**: the controller's
  authorization check, `SellStoreOrchestrationService.generateDecision`,
  and `DecisionInputResolverService.resolveDecisionInputs` each
  independently call `CropLotRepository.findByPublicId` for the same lot —
  up to three reads of the same row per request. Removing the duplication
  would require changing the resolver's and/or orchestrator's public
  signatures (both have dedicated unit tests asserting the current
  `(lotPublicId, ...)` call shape), so it is documented here as a known
  inefficiency rather than fixed, consistent with not redesigning working
  Part 1–6 architecture during this hardening pass.

### Part 7 additions (integration, hardening, verification)

- **RBAC hardening**: `createSellStoreRouter` now applies
  `requireAnyRole("FARMER", "FPO_ADMIN", "ADMIN")` at the router level, the
  same coarse role gate every other lot-scoped module (`quality`,
  `market-intelligence`, `lots`) already applies before authentication-only
  access. Per-lot ownership/FPO-management authorization
  (`ensureAuthorizedForLot`) is unchanged and still runs afterward. A
  `BUYER`, `TRANSPORTER`, or `WAREHOUSE_OPERATOR` account now gets a `403`
  (and an `AUTHORIZATION_DENIED` audit entry) instead of reaching the
  controller only to be turned away by the ownership check.
- **Audit logging**: `SellStoreOrchestrationService` accepts an optional,
  additive `AuditService` (6th constructor argument, defaults to
  `undefined` — every existing 4-/5-argument construction keeps working
  unchanged). When supplied, a successful `generateDecision` call records
  a `SELL_STORE_DECISION_GENERATED` audit event (actor, decision public ID,
  lot public ID, result) — mirroring Module 6's
  `MARKET_RECOMMENDATION_GENERATED` for its analogous
  "generated recommendation" action. The call is wrapped so a
  logging failure is reported to Sentry but can never downgrade an
  already-`COMPLETED` decision to `FAILED`, and it never audits routine
  reads (`getDecisionByPublicId`/`getDecisionsForLot`), matching the
  existing "routine reads aren't audited" convention.
- **Response envelope consistency**: the controller now uses the shared
  `sendSuccess()` helper (`common/apiResponse.ts`) instead of a bespoke
  `res.json({ success, data })`, matching every other controller in the
  codebase and adding the standard `message` field to the response.
- **Swagger completeness**: all three routes' `responses` blocks now
  reference `#/components/schemas/SuccessResponse` /
  `.../ErrorResponse` and document the `403` role-gate case, matching the
  convention used by `quality.routes.ts` / `lots.routes.ts`.
- **Test additions**: unit coverage was added for previously-untested
  orchestrator paths — `generateDecision` and `getDecisionsForLot` both
  throwing `NotFoundError` for a missing lot without touching the
  resolver/engine/AI provider, `getDecisionsForLot` never recomputing,
  repeated sequential `generateDecision` calls behaving independently, and
  the new audit-logging call (including that an audit failure doesn't
  affect the returned decision) — plus a routes-level test confirming the
  new role gate rejects a `BUYER` account with `403`.
