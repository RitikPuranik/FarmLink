/**
 * Human-facing assessment reference (build spec section 57):
 * "QA-2026-000001" — unique, server-generated, immutable. Mirrors
 * lots/lot-number.ts exactly (same per-year sequence + retry-on-conflict
 * approach); see that file's comment for the reasoning.
 */

const SEQUENCE_WIDTH = 6;

export function buildAssessmentNumber(year: number, sequence: number): string {
  return `QA-${year}-${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;
}

export function nextAssessmentNumberCandidate(year: number, baseSequence: number, attempt: number): string {
  return buildAssessmentNumber(year, baseSequence + attempt);
}
