// ---------------------------------------------------------------------------
// Module 9 — shared deterministic weight-rebalancing arithmetic. Both
// Part 4's suitability score (warehouse-risk-analysis.engine.ts) and
// Part 5's ranking score (warehouse-recommendation.engine.ts) need the
// identical "score only the factors with known data, rebalance the
// remaining weights proportionally, never fabricate a neutral value for
// an omitted one" algorithm. Extracted once here so the two engines
// can't silently drift into two different rebalancing behaviors under
// the same name.
// ---------------------------------------------------------------------------

export interface WeightedRebalanceResult<K extends string> {
  score: number | null;
  factorsUsed: K[];
  omittedFactors: K[];
}

/**
 * `scores[key] === null | undefined` means that factor could not be
 * evaluated and must be omitted, not scored as 0 or an average. Returns
 * `score: null` only when every single factor was omitted (nothing at
 * all could be evaluated) — callers decide separately whether a
 * *critical* factor being among the omitted ones should force an
 * overall unknown/insufficient-data outcome regardless of this score.
 */
export function computeRebalancedWeightedScore<K extends string>(
  weights: Record<K, number>,
  scores: Partial<Record<K, number | null>>,
): WeightedRebalanceResult<K> {
  const factorsUsed: K[] = [];
  const omittedFactors: K[] = [];
  let usedWeight = 0;
  let weightedSum = 0;

  for (const key of Object.keys(weights) as K[]) {
    const value = scores[key];
    if (value === null || value === undefined) {
      omittedFactors.push(key);
      continue;
    }
    factorsUsed.push(key);
    usedWeight += weights[key];
    weightedSum += weights[key] * value;
  }

  if (usedWeight === 0) return { score: null, factorsUsed, omittedFactors };
  const score = Math.round((weightedSum / usedWeight) * 100) / 100;
  return { score, factorsUsed, omittedFactors };
}
