import {
  PrismaClient,
  QualityAIAnalysisStatus,
  QualityAssessmentSource,
  QualityAssessmentStatus,
  QualityDefectSeverity,
  QualityGrade,
  QualityImageType,
  QualityMetricSource,
  QualityVerificationStatus,
} from "@prisma/client";
import { FarmerQualitySummaryDTO, QualityAssessmentWithRelations } from "./quality.types";

const ASSESSMENT_INCLUDE = {
  lot: { include: { crop: true, farm: true, fpo: true } },
  metrics: true,
  images: true,
  defects: true,
  aiAnalyses: { orderBy: { createdAt: "desc" as const } },
  supersededBy: { select: { publicId: true } },
} as const;

export interface MetricInputData {
  metricCode: string;
  metricName: string;
  value: number;
  unit?: string | null;
  minAllowed?: number | null;
  maxAllowed?: number | null;
  source: QualityMetricSource;
}

export interface DefectInputData {
  code: string;
  name: string;
  severity: QualityDefectSeverity;
  affectedPercentage?: number | null;
  confidence?: number | null;
}

export interface CreateAssessmentData {
  lotId: string;
  source: QualityAssessmentSource;
  status: QualityAssessmentStatus;
  verificationStatus: QualityVerificationStatus;
  overallGrade?: QualityGrade | null;
  qualityScore?: number | null;
  notes?: string | null;
  metrics?: MetricInputData[];
}

export interface UpdateAssessmentData {
  overallGrade?: QualityGrade | null;
  qualityScore?: number | null;
  notes?: string | null;
  // When present, replaces the assessment's entire metric set (build spec
  // section 53 — only reachable while still DRAFT/PENDING_IMAGES).
  metrics?: MetricInputData[];
}

export interface TransitionMeta {
  actorUserId: string | null;
  fromStatus: QualityAssessmentStatus;
  verificationStatus?: QualityVerificationStatus;
  overallGrade?: QualityGrade | null;
  qualityScore?: number | null;
  confidenceScore?: number | null;
  markAssessed?: boolean;
  notes?: string;
}

export interface AddImageData {
  storageProvider: string;
  externalId: string;
  secureUrl: string;
  imageType: QualityImageType;
  checksum?: string | null;
  uploadedByUserId: string | null;
}

export interface CreateAIAnalysisData {
  provider: string;
  modelVersion: string;
  status: QualityAIAnalysisStatus;
  requestedByUserId: string | null;
}

export interface UpdateAIAnalysisData {
  status?: QualityAIAnalysisStatus;
  confidenceScore?: number | null;
  rawResultJson?: Record<string, unknown> | null;
  processedAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface QualityListResult {
  items: QualityAssessmentWithRelations[];
  total: number;
}

/**
 * Data-access boundary for QualityAssessment + its metrics/images/defects/
 * AI-analysis-attempt history (build spec section 73/74). Ownership and
 * state-machine legality are decided in quality.authorization.ts /
 * quality-status.service.ts — this repository only reads/writes rows and
 * provides the atomic transition primitive those layers rely on.
 */
export interface QualityRepository {
  findById(id: string): Promise<QualityAssessmentWithRelations | null>;
  findByPublicId(publicId: string): Promise<QualityAssessmentWithRelations | null>;
  listByLotId(lotId: string, page: number, limit: number): Promise<QualityListResult>;
  /** Build spec section 32/60: the most recent assessment for a lot that
   * is neither SUPERSEDED nor REJECTED — used for the lot quality summary
   * and (with `excludeId`) to find what a newly-verified assessment
   * should supersede. `excludeId` matters because the assessment being
   * verified is itself already the most recently *created* row for the
   * lot by the time this runs — without excluding it, this would always
   * just return the caller's own assessment instead of whatever was
   * "current" before it. */
  findCurrentByLotId(lotId: string, excludeId?: string): Promise<QualityAssessmentWithRelations | null>;

  create(data: CreateAssessmentData, actorUserId: string | null): Promise<QualityAssessmentWithRelations>;
  updateEditable(id: string, data: UpdateAssessmentData): Promise<QualityAssessmentWithRelations>;

  /** Atomic conditional transition (mirrors CropLotRepository.transition())
   * — returns null if the row was no longer in one of `fromStatuses`. */
  transition(
    id: string,
    fromStatuses: QualityAssessmentStatus[],
    toStatus: QualityAssessmentStatus,
    meta: TransitionMeta,
  ): Promise<QualityAssessmentWithRelations | null>;

  /** Build spec section 33: marks `oldAssessmentId` SUPERSEDED and points
   * it at `newAssessmentId`, atomically and only if it was still in one of
   * SUPERSEDABLE_STATUSES — returns false (no-op) otherwise so the caller
   * can decide how to react rather than silently losing the link. */
  supersede(oldAssessmentId: string, newAssessmentId: string, fromStatuses: QualityAssessmentStatus[]): Promise<boolean>;

  addImage(assessmentId: string, data: AddImageData): Promise<QualityAssessmentWithRelations>;
  removeImage(assessmentId: string, imageId: string): Promise<QualityAssessmentWithRelations>;
  countImages(assessmentId: string): Promise<number>;

  /** Build spec section 20/22: appends AI-suggested metrics/defects
   * without touching whatever metrics a human already entered (unlike
   * `updateEditable`'s replace-all semantics, which only ever runs while
   * still DRAFT/PENDING_IMAGES — this runs from PROCESSING). */
  appendMetrics(assessmentId: string, metrics: MetricInputData[]): Promise<void>;
  appendDefects(assessmentId: string, defects: DefectInputData[]): Promise<void>;

  createAIAnalysis(assessmentId: string, data: CreateAIAnalysisData): Promise<{ id: string }>;
  updateAIAnalysis(id: string, data: UpdateAIAnalysisData): Promise<void>;
  /** Build spec section 40/69: idempotency guard — a second `/analyze`
   * call while one is already running is a 409, never a second provider
   * call. */
  findProcessingAIAnalysis(assessmentId: string): Promise<{ id: string } | null>;
  countAIAnalysisAttempts(assessmentId: string): Promise<number>;

  farmerSummary(farmerId: string): Promise<FarmerQualitySummaryDTO>;
}

export interface QualityStandardRow {
  grade: QualityGrade;
  metricCode: string;
  minValue: number | null;
  maxValue: number | null;
}

export interface QualityStandardRepository {
  findByCropId(cropId: string): Promise<QualityStandardRow[]>;
}

export class PrismaQualityRepository implements QualityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string) {
    return this.prisma.qualityAssessment.findUnique({ where: { id }, include: ASSESSMENT_INCLUDE });
  }

  findByPublicId(publicId: string) {
    return this.prisma.qualityAssessment.findUnique({ where: { publicId }, include: ASSESSMENT_INCLUDE });
  }

  async listByLotId(lotId: string, page: number, limit: number) {
    const where = { lotId };
    const [items, total] = await Promise.all([
      this.prisma.qualityAssessment.findMany({
        where,
        include: ASSESSMENT_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.qualityAssessment.count({ where }),
    ]);
    return { items, total };
  }

  findCurrentByLotId(lotId: string, excludeId?: string) {
    return this.prisma.qualityAssessment.findFirst({
      where: { lotId, status: { notIn: ["SUPERSEDED", "REJECTED"] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      include: ASSESSMENT_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Assessment-number generation mirrors CropLotRepository.create()'s
   * per-year-sequence-plus-retry approach exactly — see that method's
   * comment for the reasoning.
   */
  async create(data: CreateAssessmentData, actorUserId: string | null): Promise<QualityAssessmentWithRelations> {
    const year = new Date().getFullYear();
    const yearPrefix = `QA-${year}-`;
    const baseSequence =
      (await this.prisma.qualityAssessment.count({ where: { assessmentNumber: { startsWith: yearPrefix } } })) + 1;

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const assessmentNumber = `${yearPrefix}${String(baseSequence + attempt).padStart(6, "0")}`;
      try {
        return await this.prisma.qualityAssessment.create({
          data: {
            lotId: data.lotId,
            assessmentNumber,
            source: data.source,
            status: data.status,
            verificationStatus: data.verificationStatus,
            overallGrade: data.overallGrade ?? null,
            qualityScore: data.qualityScore ?? null,
            notes: data.notes ?? null,
            assessedByUserId: data.status === "VERIFIED" ? actorUserId : null,
            assessedAt: data.status === "VERIFIED" ? new Date() : null,
            metrics: data.metrics?.length
              ? {
                  create: data.metrics.map((m) => ({
                    metricCode: m.metricCode,
                    metricName: m.metricName,
                    value: m.value,
                    unit: m.unit ?? null,
                    minAllowed: m.minAllowed ?? null,
                    maxAllowed: m.maxAllowed ?? null,
                    source: m.source,
                  })),
                }
              : undefined,
          },
          include: ASSESSMENT_INCLUDE,
        });
      } catch (err) {
        if (isUniqueConflict(err) && attempt < maxAttempts - 1) continue;
        throw err;
      }
    }
    throw new Error("Failed to generate a unique assessment number.");
  }

  async updateEditable(id: string, data: UpdateAssessmentData): Promise<QualityAssessmentWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      if (data.metrics !== undefined) {
        await tx.qualityMetric.deleteMany({ where: { assessmentId: id } });
        if (data.metrics.length) {
          await tx.qualityMetric.createMany({
            data: data.metrics.map((m) => ({
              assessmentId: id,
              metricCode: m.metricCode,
              metricName: m.metricName,
              value: m.value,
              unit: m.unit ?? null,
              minAllowed: m.minAllowed ?? null,
              maxAllowed: m.maxAllowed ?? null,
              source: m.source,
            })),
          });
        }
      }

      await tx.qualityAssessment.update({
        where: { id },
        data: {
          ...(data.overallGrade !== undefined ? { overallGrade: data.overallGrade } : {}),
          ...(data.qualityScore !== undefined ? { qualityScore: data.qualityScore } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      });

      return tx.qualityAssessment.findUniqueOrThrow({ where: { id }, include: ASSESSMENT_INCLUDE });
    });
  }

  async transition(
    id: string,
    fromStatuses: QualityAssessmentStatus[],
    toStatus: QualityAssessmentStatus,
    meta: TransitionMeta,
  ): Promise<QualityAssessmentWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.qualityAssessment.updateMany({
        where: { id, status: { in: fromStatuses } },
        data: {
          status: toStatus,
          ...(meta.verificationStatus ? { verificationStatus: meta.verificationStatus } : {}),
          ...(meta.overallGrade !== undefined ? { overallGrade: meta.overallGrade } : {}),
          ...(meta.qualityScore !== undefined ? { qualityScore: meta.qualityScore } : {}),
          ...(meta.confidenceScore !== undefined ? { confidenceScore: meta.confidenceScore } : {}),
          ...(meta.markAssessed ? { assessedByUserId: meta.actorUserId, assessedAt: new Date() } : {}),
          ...(meta.notes !== undefined ? { notes: meta.notes } : {}),
        },
      });
      if (result.count === 0) return null;

      return tx.qualityAssessment.findUnique({ where: { id }, include: ASSESSMENT_INCLUDE });
    });
  }

  async supersede(oldAssessmentId: string, newAssessmentId: string, fromStatuses: QualityAssessmentStatus[]): Promise<boolean> {
    const result = await this.prisma.qualityAssessment.updateMany({
      where: { id: oldAssessmentId, status: { in: fromStatuses } },
      data: { status: "SUPERSEDED", supersededByAssessmentId: newAssessmentId },
    });
    return result.count > 0;
  }

  addImage(assessmentId: string, data: AddImageData) {
    return this.prisma.qualityAssessment.update({
      where: { id: assessmentId },
      data: {
        images: {
          create: {
            storageProvider: data.storageProvider,
            externalId: data.externalId,
            secureUrl: data.secureUrl,
            imageType: data.imageType,
            checksum: data.checksum ?? null,
            uploadedByUserId: data.uploadedByUserId,
          },
        },
      },
      include: ASSESSMENT_INCLUDE,
    });
  }

  async removeImage(assessmentId: string, imageId: string) {
    await this.prisma.qualityImage.deleteMany({ where: { id: imageId, assessmentId } });
    return this.prisma.qualityAssessment.findUniqueOrThrow({ where: { id: assessmentId }, include: ASSESSMENT_INCLUDE });
  }

  countImages(assessmentId: string) {
    return this.prisma.qualityImage.count({ where: { assessmentId } });
  }

  async appendMetrics(assessmentId: string, metrics: MetricInputData[]): Promise<void> {
    if (metrics.length === 0) return;
    await this.prisma.qualityMetric.createMany({
      data: metrics.map((m) => ({
        assessmentId,
        metricCode: m.metricCode,
        metricName: m.metricName,
        value: m.value,
        unit: m.unit ?? null,
        minAllowed: m.minAllowed ?? null,
        maxAllowed: m.maxAllowed ?? null,
        source: m.source,
      })),
    });
  }

  async appendDefects(assessmentId: string, defects: DefectInputData[]): Promise<void> {
    if (defects.length === 0) return;
    await this.prisma.qualityDefect.createMany({
      data: defects.map((d) => ({
        assessmentId,
        code: d.code,
        name: d.name,
        severity: d.severity,
        affectedPercentage: d.affectedPercentage ?? null,
        confidence: d.confidence ?? null,
      })),
    });
  }

  async createAIAnalysis(assessmentId: string, data: CreateAIAnalysisData) {
    const row = await this.prisma.qualityAIAnalysis.create({
      data: {
        assessmentId,
        provider: data.provider,
        modelVersion: data.modelVersion,
        status: data.status,
        requestedByUserId: data.requestedByUserId,
      },
      select: { id: true },
    });
    return row;
  }

  async updateAIAnalysis(id: string, data: UpdateAIAnalysisData): Promise<void> {
    await this.prisma.qualityAIAnalysis.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.confidenceScore !== undefined ? { confidenceScore: data.confidenceScore } : {}),
        ...(data.rawResultJson !== undefined ? { rawResultJson: data.rawResultJson as never } : {}),
        ...(data.processedAt !== undefined ? { processedAt: data.processedAt } : {}),
        ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
      },
    });
  }

  findProcessingAIAnalysis(assessmentId: string) {
    return this.prisma.qualityAIAnalysis.findFirst({
      where: { assessmentId, status: { in: ["QUEUED", "PROCESSING"] } },
      select: { id: true },
    });
  }

  countAIAnalysisAttempts(assessmentId: string) {
    return this.prisma.qualityAIAnalysis.count({ where: { assessmentId } });
  }

  async farmerSummary(farmerId: string): Promise<FarmerQualitySummaryDTO> {
    const where = { lot: { farmerId } };
    const [totalAssessments, verified, aiEstimated, pendingReview, scoreAgg, gradeGroups] = await Promise.all([
      this.prisma.qualityAssessment.count({ where }),
      this.prisma.qualityAssessment.count({ where: { ...where, status: "VERIFIED" } }),
      this.prisma.qualityAssessment.count({ where: { ...where, verificationStatus: "AI_ESTIMATED" } }),
      this.prisma.qualityAssessment.count({ where: { ...where, status: "PENDING_REVIEW" } }),
      this.prisma.qualityAssessment.aggregate({ where: { ...where, qualityScore: { not: null } }, _avg: { qualityScore: true } }),
      this.prisma.qualityAssessment.groupBy({
        by: ["overallGrade"],
        where: { ...where, overallGrade: { not: null } },
        _count: true,
      }),
    ]);

    const gradeDistribution: Record<string, number> = {};
    for (const row of gradeGroups) {
      if (row.overallGrade) gradeDistribution[row.overallGrade] = row._count;
    }

    return {
      totalAssessments,
      verified,
      aiEstimated,
      pendingReview,
      averageQualityScore: scoreAgg._avg.qualityScore === null ? null : Math.round(Number(scoreAgg._avg.qualityScore) * 100) / 100,
      gradeDistribution,
    };
  }
}

export class PrismaQualityStandardRepository implements QualityStandardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByCropId(cropId: string): Promise<QualityStandardRow[]> {
    const rows = await this.prisma.qualityStandard.findMany({ where: { cropId } });
    return rows.map((r) => ({
      grade: r.grade,
      metricCode: r.metricCode,
      minValue: r.minValue === null ? null : Number(r.minValue),
      maxValue: r.maxValue === null ? null : Number(r.maxValue),
    }));
  }
}

function isUniqueConflict(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}
