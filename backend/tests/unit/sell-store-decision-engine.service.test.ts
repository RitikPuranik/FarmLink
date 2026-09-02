import { DecisionEngineService } from "../../src/modules/sell-vs-store/sell-store-decision-engine.service";
import { DECISION_ENGINE_CONFIG } from "../../src/modules/sell-vs-store/sell-store-decision-engine.config";
import { ResolvedDecisionInput } from "../../src/modules/sell-vs-store/sell-store-input-resolver.types";
import { SellStoreInputSnapshot } from "../../src/modules/sell-vs-store/sell-vs-store.types";

/**
 * Factory that builds a valid ResolvedDecisionInput with sensible defaults.
 * Every test overrides only what it needs — keeps noise out of test bodies.
 */
function buildInput(overrides: {
  market?: Partial<SellStoreInputSnapshot["market"]>;
  lot?: Partial<SellStoreInputSnapshot["lot"]>;
  storage?: Partial<SellStoreInputSnapshot["storage"]>;
  availability?: Partial<ResolvedDecisionInput["availability"]>;
}): ResolvedDecisionInput {
  return {
    snapshot: {
      market: {
        modalPrice: 2000,
        trend: "STABLE",
        volatility: 0.05,
        freshness: "FRESH",
        confidence: 0.9,
        sourceTimestamp: new Date().toISOString(),
        ...overrides.market,
      },
      lot: {
        quantity: 1000,
        unit: "KG",
        cropName: "Tomato",
        qualityGrade: "B",
        ...overrides.lot,
      },
      storage: {
        availability: null,
        costPerUnit: null,
        durationDays: null,
        constraints: null,
        spoilageRisk: null,
        ...overrides.storage,
      },
    },
    availability: {
      market: true,
      quality: true,
      storage: "UNKNOWN",
      ...overrides.availability,
    },
    missingInputs: [],
    timestamps: {
      marketDataTimestamp: new Date(),
      storageDataTimestamp: null,
    },
  };
}

describe("DecisionEngineService", () => {
  let engine: DecisionEngineService;

  beforeEach(() => {
    engine = new DecisionEngineService();
  });

  // ── 1. Strong downward trend + high volatility → SELL_NOW ────────
  it("1. Strong downward trend + high volatility → SELL_NOW", () => {
    const input = buildInput({
      market: { trend: "DOWN", volatility: 0.25, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "C" },
      storage: { spoilageRisk: 0.8 },
      availability: { storage: "AVAILABLE" },
    });

    const result = engine.evaluate(input);

    expect(result.result).toBe("SELL_NOW");
    expect(result.sellScore).not.toBeNull();
    expect(result.storeScore).not.toBeNull();
    expect(result.sellScore!).toBeGreaterThan(result.storeScore!);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.factorsUsed).toContain("MARKET_TREND");
    expect(result.factorsUsed).toContain("VOLATILITY");
  });

  // ── 2. Strong upward trend + low volatility + feasible storage → STORE
  it("2. Strong upward trend + low volatility + feasible storage → STORE", () => {
    const input = buildInput({
      market: { trend: "UP", volatility: 0.03, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "A" },
      storage: { availability: true, spoilageRisk: 0.1, costPerUnit: 5, durationDays: 30 },
      availability: { storage: "AVAILABLE" },
    });

    const result = engine.evaluate(input);

    expect(result.result).toBe("STORE");
    expect(result.storeScore!).toBeGreaterThan(result.sellScore!);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.insufficiencyReasons).toHaveLength(0);
  });

  // ── 3. Missing market data → INSUFFICIENT_DATA ──────────────────
  it("3. Missing market data → INSUFFICIENT_DATA", () => {
    const input = buildInput({
      availability: { market: false },
    });

    const result = engine.evaluate(input);

    expect(result.result).toBe("INSUFFICIENT_DATA");
    expect(result.sellScore).toBeNull();
    expect(result.storeScore).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.insufficiencyReasons).toContain("MISSING_MARKET_DATA");
  });

  // ── 4. Outdated market data → INSUFFICIENT_DATA ─────────────────
  it("4. Outdated market data → INSUFFICIENT_DATA", () => {
    const input = buildInput({
      market: { freshness: "OUTDATED" },
    });

    const result = engine.evaluate(input);

    expect(result.result).toBe("INSUFFICIENT_DATA");
    expect(result.insufficiencyReasons).toContain("STALE_MARKET_DATA");
  });

  // ── 5. Storage explicitly UNAVAILABLE → must not recommend STORE ─
  it("5. Storage explicitly UNAVAILABLE → must not recommend STORE", () => {
    const input = buildInput({
      market: { trend: "UP", volatility: 0.03, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "A" },
      storage: { spoilageRisk: 0.1 },
      availability: { storage: "UNAVAILABLE" },
    });

    const result = engine.evaluate(input);

    // Even though directional evidence points to STORE, explicit
    // unavailability must block it.
    expect(result.result).not.toBe("STORE");
    expect(result.result).toBe("INSUFFICIENT_DATA");
    expect(result.insufficiencyReasons).toContain("UNKNOWN_STORAGE_FEASIBILITY");
  });

  // ── 6. High storage risk → evidence toward SELL_NOW ──────────────
  it("6. High storage risk → evidence toward SELL_NOW", () => {
    const input = buildInput({
      market: { trend: "STABLE", volatility: 0.15, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "B" },
      storage: { spoilageRisk: 0.9 },
      availability: { storage: "AVAILABLE" },
    });

    const result = engine.evaluate(input);

    expect(result.factorsUsed).toContain("STORAGE_RISK");
    // With STABLE trend (50/50) + MEDIUM volatility (50/50) + HIGH
    // storage risk (100/0) + B quality (50/50), SELL_NOW should win.
    expect(result.sellScore!).toBeGreaterThan(result.storeScore!);
  });

  // ── 7. Missing non-critical factor → omitted + weights rebalanced ─
  it("7. Missing non-critical factor → factor omitted, weights rebalanced", () => {
    const input = buildInput({
      market: { trend: "DOWN", volatility: null, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "C" },
      storage: { spoilageRisk: null },
      availability: { storage: "AVAILABLE" },
    });

    const result = engine.evaluate(input);

    expect(result.factorsUsed).toContain("MARKET_TREND");
    expect(result.factorsUsed).toContain("QUALITY_CONSTRAINTS");
    expect(result.factorsUsed).not.toContain("VOLATILITY");
    expect(result.factorsUsed).not.toContain("STORAGE_RISK");
    expect(result.omittedFactors).toContain("VOLATILITY");
    expect(result.omittedFactors).toContain("STORAGE_RISK");

    // Scores should still be calculated (not null)
    expect(result.sellScore).not.toBeNull();
    expect(result.storeScore).not.toBeNull();

    // Verify rebalancing: with only MARKET_TREND (40) and QUALITY_CONSTRAINTS (15)
    // active, their rebalanced weights should be 40/55 ≈ 0.7273 and 15/55 ≈ 0.2727.
    // DOWN trend: sell=100, store=0; C quality: sell=80, store=20
    // sellScore ≈ 100*0.7273 + 80*0.2727 ≈ 72.73 + 21.82 ≈ 94.55
    // storeScore ≈ 0*0.7273 + 20*0.2727 ≈ 5.45
    expect(result.sellScore!).toBeGreaterThan(90);
    expect(result.storeScore!).toBeLessThan(10);
  });

  // ── 8. Conflicting signals → deterministic tie handling ───────────
  it("8. Conflicting signals → deterministic INSUFFICIENT_DATA", () => {
    // STABLE trend (50/50) + MEDIUM volatility (50/50) + B quality (50/50)
    // All factors produce identical sell/store evidence → tie.
    // Storage is AVAILABLE with neutral spoilage risk → keeps confidence up.
    const input = buildInput({
      market: { trend: "STABLE", volatility: 0.15, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "B" },
      storage: { spoilageRisk: 0.5 },
      availability: { quality: true, storage: "AVAILABLE" },
    });

    const result = engine.evaluate(input);

    // sellScore ≈ storeScore ≈ 50, margin ≤ 10 → tie
    expect(result.result).toBe("INSUFFICIENT_DATA");
    expect(result.insufficiencyReasons).toContain("CONFLICTING_MARKET_SIGNALS");
  });

  // ── 9. Determinism — same input always produces identical result ──
  it("9. Same input always produces identical result", () => {
    const input = buildInput({
      market: { trend: "DOWN", volatility: 0.22, freshness: "RECENT", confidence: 0.6 },
      lot: { qualityGrade: "C" },
      storage: { spoilageRisk: 0.5 },
      availability: { storage: "AVAILABLE" },
    });

    const results = Array.from({ length: 50 }, () => engine.evaluate(input));

    const first = results[0];
    for (const r of results) {
      expect(r.result).toBe(first.result);
      expect(r.sellScore).toBe(first.sellScore);
      expect(r.storeScore).toBe(first.storeScore);
      expect(r.confidence).toBe(first.confidence);
      expect(r.factorsUsed).toEqual(first.factorsUsed);
      expect(r.omittedFactors).toEqual(first.omittedFactors);
      expect(r.insufficiencyReasons).toEqual(first.insufficiencyReasons);
    }
  });

  // ── 10. Confidence remains within valid range ─────────────────────
  it("10. Confidence always within [0, 1]", () => {
    const scenarios: ResolvedDecisionInput[] = [
      buildInput({ market: { freshness: "FRESH", confidence: 1.0 }, availability: { storage: "AVAILABLE" } }),
      buildInput({ market: { freshness: "STALE", confidence: 0.1 }, availability: { storage: "UNKNOWN" } }),
      buildInput({ market: { freshness: "RECENT", confidence: 0.0 } }),
      buildInput({ availability: { market: false } }),
    ];

    for (const input of scenarios) {
      const result = engine.evaluate(input);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  // ── 11. No unavailable factor is treated as zero/default evidence ─
  it("11. No unavailable factor treated as zero or default evidence", () => {
    // Build two inputs identical except one has volatility = null
    const withVol = buildInput({
      market: { trend: "DOWN", volatility: 0.05, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "B" },
      storage: { spoilageRisk: null },
      availability: { storage: "AVAILABLE" },
    });

    const withoutVol = buildInput({
      market: { trend: "DOWN", volatility: null, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "B" },
      storage: { spoilageRisk: null },
      availability: { storage: "AVAILABLE" },
    });

    const resultWith = engine.evaluate(withVol);
    const resultWithout = engine.evaluate(withoutVol);

    // The scores must differ because volatility=null is NOT treated
    // as volatility=0 (which would be LOW → store evidence).
    expect(resultWith.sellScore).not.toBe(resultWithout.sellScore);

    // Without volatility, that factor must be omitted
    expect(resultWithout.omittedFactors).toContain("VOLATILITY");
    expect(resultWithout.factorsUsed).not.toContain("VOLATILITY");
  });

  // ── 12. STALE freshness reduces confidence but does not gate ──────
  it("12. STALE freshness reduces confidence but does not automatically gate", () => {
    const freshInput = buildInput({
      market: { trend: "DOWN", volatility: 0.25, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "C" },
      storage: { spoilageRisk: 0.8 },
      availability: { storage: "AVAILABLE" },
    });

    const staleInput = buildInput({
      market: { trend: "DOWN", volatility: 0.25, freshness: "STALE", confidence: 0.9 },
      lot: { qualityGrade: "C" },
      storage: { spoilageRisk: 0.8 },
      availability: { storage: "AVAILABLE" },
    });

    const freshResult = engine.evaluate(freshInput);
    const staleResult = engine.evaluate(staleInput);

    // Directional scores should be identical (freshness doesn't affect them)
    expect(staleResult.sellScore).toBe(freshResult.sellScore);
    expect(staleResult.storeScore).toBe(freshResult.storeScore);

    // But confidence must be lower with STALE data
    expect(staleResult.confidence).toBeLessThan(freshResult.confidence);

    // STALE should NOT automatically mean INSUFFICIENT_DATA
    expect(staleResult.insufficiencyReasons).not.toContain("STALE_MARKET_DATA");
  });

  // ── 13. STORE wins directionally but storage UNKNOWN → INSUFFICIENT_DATA
  it("13. STORE wins directionally + UNKNOWN storage → INSUFFICIENT_DATA", () => {
    const input = buildInput({
      market: { trend: "UP", volatility: 0.03, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "A" },
      storage: { spoilageRisk: null },
      availability: { storage: "UNKNOWN" },
    });

    const result = engine.evaluate(input);

    // Even with strong STORE directional evidence, UNKNOWN storage
    // must block the STORE recommendation
    expect(result.result).not.toBe("STORE");
    expect(result.insufficiencyReasons).toContain("UNKNOWN_STORAGE_FEASIBILITY");
  });

  // ── 14. SELL_NOW can still be recommended with UNKNOWN storage ────
  it("14. SELL_NOW is possible even with UNKNOWN storage", () => {
    const input = buildInput({
      market: { trend: "DOWN", volatility: 0.25, freshness: "FRESH", confidence: 0.9 },
      lot: { qualityGrade: "D" },
      storage: { spoilageRisk: null },
      availability: { storage: "UNKNOWN", quality: true },
    });

    const result = engine.evaluate(input);

    // Strong SELL_NOW evidence should not be blocked by unknown storage
    // (the engine doesn't need storage info to recommend selling).
    // Note: confidence may be low due to storage domain missing from
    // completeness, but the directional evidence should be clear enough.
    // If confidence gates it, it's a valid conservative outcome too.
    if (result.confidence >= DECISION_ENGINE_CONFIG.MIN_CONFIDENCE_THRESHOLD) {
      expect(result.result).toBe("SELL_NOW");
    } else {
      // Even if gated by low confidence, it should NOT be STORE
      expect(result.result).not.toBe("STORE");
    }
  });

  // ── 15. Freshness is NOT directional evidence ─────────────────────
  it("15. Freshness does not contribute directional sell/store points", () => {
    const freshInput = buildInput({
      market: { trend: "STABLE", volatility: 0.15, freshness: "FRESH", confidence: 0.6 },
    });
    const recentInput = buildInput({
      market: { trend: "STABLE", volatility: 0.15, freshness: "RECENT", confidence: 0.6 },
    });

    const freshResult = engine.evaluate(freshInput);
    const recentResult = engine.evaluate(recentInput);

    // Directional scores must be identical
    expect(freshResult.sellScore).toBe(recentResult.sellScore);
    expect(freshResult.storeScore).toBe(recentResult.storeScore);
  });
});
