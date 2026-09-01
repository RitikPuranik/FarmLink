import { QualityAssessmentStatus } from "@prisma/client";
import { ConflictError } from "../../common/errors";

/**
 * Build spec section 9/78/82. Two entry paths from DRAFT — the AI pipeline
 * (PENDING_IMAGES -> PROCESSING -> AI_COMPLETED -> PENDING_REVIEW ->
 * VERIFIED) and the direct manual path (DRAFT -> VERIFIED, section 9's
 * "Manual: DRAFT -> VERIFIED") — plus FAILED (section 21/67: a failed AI
 * attempt must be stored, never faked) and SUPERSEDED (section 33: any
 * still-active assessment can be superseded by a newer one; a terminal
 * REJECTED/FAILED/SUPERSEDED assessment cannot be superseded again).
 */
const ALLOWED_TRANSITIONS: Record<QualityAssessmentStatus, QualityAssessmentStatus[]> = {
  DRAFT: ["PENDING_IMAGES", "VERIFIED", "REJECTED", "SUPERSEDED"],
  PENDING_IMAGES: ["PROCESSING", "SUPERSEDED"],
  PROCESSING: ["AI_COMPLETED", "FAILED"],
  // Build spec section 39: retry only from FAILED.
  FAILED: ["PROCESSING"],
  AI_COMPLETED: ["PENDING_REVIEW", "VERIFIED", "REJECTED", "SUPERSEDED"],
  PENDING_REVIEW: ["VERIFIED", "REJECTED", "SUPERSEDED"],
  VERIFIED: ["SUPERSEDED"],
  REJECTED: [],
  SUPERSEDED: [],
};

// Build spec section 33/54: which statuses a *new* assessment is allowed
// to supersede.
export const SUPERSEDABLE_STATUSES: QualityAssessmentStatus[] = [
  "DRAFT",
  "PENDING_IMAGES",
  "AI_COMPLETED",
  "PENDING_REVIEW",
  "VERIFIED",
];

// Build spec section 53: only these statuses allow editing metrics/notes/
// overallGrade directly, rather than requiring a new assessment.
export const EDITABLE_STATUSES: QualityAssessmentStatus[] = ["DRAFT", "PENDING_IMAGES"];

export class QualityStatusService {
  isTransitionAllowed(from: QualityAssessmentStatus, to: QualityAssessmentStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  validateTransition(from: QualityAssessmentStatus, to: QualityAssessmentStatus): void {
    if (!this.isTransitionAllowed(from, to)) {
      throw new ConflictError(`A quality assessment cannot move from ${from} to ${to}.`);
    }
  }
}
