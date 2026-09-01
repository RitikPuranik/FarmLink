import { QualityDefectSeverity, QualityGrade } from "@prisma/client";
import { QualityStandardRepository } from "./quality.repository";

export interface GradingMetricInput {
  metricCode: string;
  value: number;
}

export interface GradingDefectInput {
  severity: QualityDefectSeverity;
  affectedPercentage?: number | null;
}

// Build spec section 46: a generic starting-point heuristic, never
// presented as an official standard (section 48/49) — a defect with no
// recorded affectedPercentage falls back to a per-severity default so a
// detected-but-unmeasured defect still moves the score.
const SEVERITY_DEFAULT_IMPACT: Record<QualityDefectSeverity, number> = {
  LOW: 2,
  MEDIUM: 8,
  HIGH: 20,
  CRITICAL: 40,
};

const GRADE_RANK: QualityGrade[] = ["A", "B", "C", "D", "REJECTED"];

/**
 * Build spec section 47/48: score/grade calculation lives here, never in a
 * controller. Grading is crop-agnostic — it reads whatever
 * `QualityStandard` rows exist for the lot's crop rather than branching on
 * crop name (build spec section 10: "Do not build a giant hardcoded `if
 * crop === onion` service").
 */
export class QualityGradingService {
  constructor(private readonly standards: QualityStandardRepository) {}

  /**
   * Build spec section 46: produce condition, 0-100, never confused with
   * an AI confidence score. Starts at 100 and is reduced by each detected
   * defect's impact — a placeholder heuristic (see the comment on
   * SEVERITY_DEFAULT_IMPACT above), not a sourced agricultural formula.
   * Returns null when there is nothing to score from (no defects and no
   * caller-supplied basis), so the caller can leave qualityScore unset
   * rather than store a meaningless 100.
   */
  calculateScore(defects: GradingDefectInput[]): number | null {
    if (defects.length === 0) return null;
    const totalImpact = defects.reduce((sum, defect) => {
      const impact = defect.affectedPercentage ?? SEVERITY_DEFAULT_IMPACT[defect.severity];
      return sum + impact;
    }, 0);
    return Math.max(0, Math.round((100 - totalImpact) * 100) / 100);
  }

  /**
   * Build spec section 14/48: walks configured grades best-to-worst (A,
   * B, C, D) and returns the first grade whose every configured metric
   * rule is satisfied by the submitted metrics. A metric configured for a
   * grade but not present in the submission fails that grade (an
   * incomplete submission can't earn a grade it didn't actually
   * demonstrate). Returns null when the crop has no configured standards
   * at all, or none of them pass — the caller falls back to whatever
   * grade was directly supplied (manual/AI-suggested) rather than
   * treating null as REJECTED outright.
   */
  async determineGrade(cropId: string, metrics: GradingMetricInput[]): Promise<QualityGrade | null> {
    const rules = await this.standards.findByCropId(cropId);
    if (rules.length === 0) return null;

    const byGrade = new Map<QualityGrade, typeof rules>();
    for (const rule of rules) {
      const existing = byGrade.get(rule.grade) ?? [];
      existing.push(rule);
      byGrade.set(rule.grade, existing);
    }

    const metricByCode = new Map(metrics.map((m) => [m.metricCode, m.value]));

    for (const grade of GRADE_RANK) {
      const gradeRules = byGrade.get(grade);
      if (!gradeRules || gradeRules.length === 0) continue;

      const passes = gradeRules.every((rule) => {
        const value = metricByCode.get(rule.metricCode);
        if (value === undefined) return false;
        if (rule.minValue !== null && value < Number(rule.minValue)) return false;
        if (rule.maxValue !== null && value > Number(rule.maxValue)) return false;
        return true;
      });

      if (passes) return grade;
    }

    return null;
  }
}
