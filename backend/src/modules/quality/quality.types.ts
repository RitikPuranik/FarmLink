import {
  QualityAIAnalysis,
  QualityAIAnalysisStatus,
  QualityAssessment,
  QualityAssessmentSource,
  QualityAssessmentStatus,
  QualityDefect,
  QualityDefectSeverity,
  QualityGrade,
  QualityImage,
  QualityImageType,
  QualityMetric,
  QualityMetricSource,
  QualityVerificationStatus,
} from "@prisma/client";
import { CropLotWithRelations } from "../lots/lots.types";

export type QualityAssessmentWithRelations = QualityAssessment & {
  // Reuses Module 4's own with-relations type (crop/farm/fpo already
  // included) rather than a second, narrower CropLot shape — this module
  // needs `lot.crop.name` for AI requests/grading and `lot.farmerId`/
  // `lot.fpoId`/`lot.ownerType`/`lot.status` for authorization, all of
  // which CropLotWithRelations already carries.
  lot: CropLotWithRelations;
  metrics: QualityMetric[];
  images: QualityImage[];
  defects: QualityDefect[];
  // Build spec section 38-39: one row per AI attempt, most recent first —
  // the repository always loads these ordered `createdAt desc`.
  aiAnalyses: QualityAIAnalysis[];
  // Build spec section 33: only populated once something has superseded
  // this row.
  supersededBy: { publicId: string } | null;
};

export interface QualityMetricDTO {
  metricCode: string;
  metricName: string;
  value: number;
  unit: string | null;
  minAllowed: number | null;
  maxAllowed: number | null;
  source: QualityMetricSource;
}

export interface QualityImageDTO {
  id: string;
  storageProvider: string;
  externalId: string;
  secureUrl: string;
  imageType: QualityImageType;
  uploadedAt: string;
}

export interface QualityDefectDTO {
  code: string;
  name: string;
  severity: QualityDefectSeverity;
  affectedPercentage: number | null;
  confidence: number | null;
}

export interface QualityAIAnalysisDTO {
  id: string;
  provider: string;
  modelVersion: string;
  status: QualityAIAnalysisStatus;
  confidenceScore: number | null;
  requestedAt: string;
  processedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface QualityAssessmentDTO {
  publicId: string;
  assessmentNumber: string;
  lot: { publicId: string; lotNumber: string };
  source: QualityAssessmentSource;
  status: QualityAssessmentStatus;
  verificationStatus: QualityVerificationStatus;
  overallGrade: QualityGrade | null;
  qualityScore: number | null;
  confidenceScore: number | null;
  notes: string | null;
  metrics: QualityMetricDTO[];
  images: QualityImageDTO[];
  defects: QualityDefectDTO[];
  latestAiAnalysis: QualityAIAnalysisDTO | null;
  supersededByAssessmentPublicId: string | null;
  assessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toNum(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function toQualityAssessmentDTO(assessment: QualityAssessmentWithRelations): QualityAssessmentDTO {
  const latestAi = assessment.aiAnalyses[0] ?? null;

  return {
    publicId: assessment.publicId,
    assessmentNumber: assessment.assessmentNumber,
    lot: { publicId: assessment.lot.publicId, lotNumber: assessment.lot.lotNumber },
    source: assessment.source,
    status: assessment.status,
    verificationStatus: assessment.verificationStatus,
    overallGrade: assessment.overallGrade,
    qualityScore: toNum(assessment.qualityScore),
    confidenceScore: toNum(assessment.confidenceScore),
    notes: assessment.notes,
    metrics: assessment.metrics.map((m) => ({
      metricCode: m.metricCode,
      metricName: m.metricName,
      value: Number(m.value),
      unit: m.unit,
      minAllowed: toNum(m.minAllowed),
      maxAllowed: toNum(m.maxAllowed),
      source: m.source,
    })),
    images: assessment.images.map((img) => ({
      id: img.id,
      storageProvider: img.storageProvider,
      externalId: img.externalId,
      secureUrl: img.secureUrl,
      imageType: img.imageType,
      uploadedAt: img.uploadedAt.toISOString(),
    })),
    defects: assessment.defects.map((d) => ({
      code: d.code,
      name: d.name,
      severity: d.severity,
      affectedPercentage: toNum(d.affectedPercentage),
      confidence: toNum(d.confidence),
    })),
    latestAiAnalysis: latestAi
      ? {
          id: latestAi.id,
          provider: latestAi.provider,
          modelVersion: latestAi.modelVersion,
          status: latestAi.status,
          confidenceScore: toNum(latestAi.confidenceScore),
          requestedAt: latestAi.requestedAt.toISOString(),
          processedAt: latestAi.processedAt ? latestAi.processedAt.toISOString() : null,
          errorCode: latestAi.errorCode,
          errorMessage: latestAi.errorMessage,
        }
      : null,
    supersededByAssessmentPublicId: assessment.supersededBy ? assessment.supersededBy.publicId : null,
    assessedAt: assessment.assessedAt ? assessment.assessedAt.toISOString() : null,
    createdAt: assessment.createdAt.toISOString(),
    updatedAt: assessment.updatedAt.toISOString(),
  };
}

export interface FarmerQualitySummaryDTO {
  totalAssessments: number;
  verified: number;
  aiEstimated: number;
  pendingReview: number;
  averageQualityScore: number | null;
  gradeDistribution: Record<string, number>;
}

export interface LotQualitySummaryDTO {
  hasAssessment: boolean;
  currentAssessment: {
    publicId: string;
    grade: QualityGrade | null;
    qualityScore: number | null;
    verificationStatus: QualityVerificationStatus;
    confidence: number | null;
    assessedAt: string | null;
  } | null;
}
