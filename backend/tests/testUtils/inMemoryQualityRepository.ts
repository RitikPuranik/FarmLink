import { randomUUID } from "crypto";
import type {
  AddImageData,
  CreateAIAnalysisData,
  CreateAssessmentData,
  DefectInputData,
  MetricInputData,
  QualityListResult,
  QualityRepository,
  QualityStandardRepository,
  QualityStandardRow,
  TransitionMeta,
  UpdateAIAnalysisData,
  UpdateAssessmentData,
} from "../../src/modules/quality/quality.repository";
import { FarmerQualitySummaryDTO } from "../../src/modules/quality/quality.types";
import { InMemoryCropLotRepository } from "./inMemoryCropLotRepository";

interface FakeImage {
  id: string;
  storageProvider: string;
  externalId: string;
  secureUrl: string;
  imageType: string;
  checksum: string | null;
  uploadedByUserId: string | null;
  uploadedAt: Date;
}

interface FakeAiAnalysis {
  id: string;
  assessmentId: string;
  provider: string;
  modelVersion: string;
  status: string;
  confidenceScore: number | null;
  rawResultJson: Record<string, unknown> | null;
  requestedByUserId: string | null;
  requestedAt: Date;
  processedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FakeAssessment {
  id: string;
  publicId: string;
  lotId: string;
  assessmentNumber: string;
  source: string;
  status: string;
  verificationStatus: string;
  overallGrade: string | null;
  qualityScore: number | null;
  confidenceScore: number | null;
  assessedByUserId: string | null;
  assessedAt: Date | null;
  supersededByAssessmentId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  metrics: MetricInputData[];
  images: FakeImage[];
  defects: DefectInputData[];
  aiAnalyses: FakeAiAnalysis[];
}

/** Mirrors InMemoryCropLotRepository's pattern — joins against that fake
 * for the `lot` (crop/farm/fpo already included there) rather than
 * duplicating farm/FPO fixtures a second time. */
export class InMemoryQualityRepository implements QualityRepository {
  assessments: FakeAssessment[] = [];

  constructor(private readonly cropLots: InMemoryCropLotRepository) {}

  private async withRelations(a: FakeAssessment) {
    const lot = await this.cropLots.findById(a.lotId);
    const supersededBy = a.supersededByAssessmentId
      ? this.assessments.find((x) => x.id === a.supersededByAssessmentId)
      : null;
    return {
      ...a,
      lot,
      supersededBy: supersededBy ? { publicId: supersededBy.publicId } : null,
      aiAnalyses: [...a.aiAnalyses].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()),
    } as never;
  }

  async findById(id: string) {
    const a = this.assessments.find((x) => x.id === id);
    return a ? this.withRelations(a) : null;
  }

  async findByPublicId(publicId: string) {
    const a = this.assessments.find((x) => x.publicId === publicId);
    return a ? this.withRelations(a) : null;
  }

  async listByLotId(lotId: string, page: number, limit: number): Promise<QualityListResult> {
    const matches = this.assessments.filter((a) => a.lotId === lotId).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    const total = matches.length;
    const start = (page - 1) * limit;
    const items = await Promise.all(matches.slice(start, start + limit).map((a) => this.withRelations(a)));
    return { items, total } as never;
  }

  async findCurrentByLotId(lotId: string, excludeId?: string) {
    const matches = this.assessments
      .filter((a) => a.lotId === lotId && a.status !== "SUPERSEDED" && a.status !== "REJECTED" && a.id !== excludeId)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    return matches.length ? this.withRelations(matches[0]) : null;
  }

  async create(data: CreateAssessmentData, actorUserId: string | null) {
    const now = new Date();
    const year = now.getFullYear();
    const sequence = this.assessments.filter((a) => a.assessmentNumber.startsWith(`QA-${year}-`)).length + 1;
    const a: FakeAssessment = {
      id: randomUUID(),
      publicId: randomUUID(),
      lotId: data.lotId,
      assessmentNumber: `QA-${year}-${String(sequence).padStart(6, "0")}`,
      source: data.source,
      status: data.status,
      verificationStatus: data.verificationStatus,
      overallGrade: data.overallGrade ?? null,
      qualityScore: data.qualityScore ?? null,
      confidenceScore: null,
      assessedByUserId: data.status === "VERIFIED" ? actorUserId : null,
      assessedAt: data.status === "VERIFIED" ? now : null,
      supersededByAssessmentId: null,
      notes: data.notes ?? null,
      createdAt: now,
      updatedAt: now,
      metrics: (data.metrics ?? []).map((m) => ({ ...m })),
      images: [],
      defects: [],
      aiAnalyses: [],
    };
    this.assessments.push(a);
    return this.withRelations(a);
  }

  async updateEditable(id: string, data: UpdateAssessmentData) {
    const a = this.assessments.find((x) => x.id === id);
    if (!a) throw new Error("QualityAssessment not found in fake repository.");
    if (data.metrics !== undefined) a.metrics = data.metrics.map((m) => ({ ...m }));
    if (data.overallGrade !== undefined) a.overallGrade = data.overallGrade;
    if (data.qualityScore !== undefined) a.qualityScore = data.qualityScore;
    if (data.notes !== undefined) a.notes = data.notes;
    a.updatedAt = new Date();
    return this.withRelations(a);
  }

  async transition(id: string, fromStatuses: string[], toStatus: string, meta: TransitionMeta) {
    const a = this.assessments.find((x) => x.id === id);
    if (!a || !fromStatuses.includes(a.status)) return null;
    a.status = toStatus;
    if (meta.verificationStatus) a.verificationStatus = meta.verificationStatus;
    if (meta.overallGrade !== undefined) a.overallGrade = meta.overallGrade;
    if (meta.qualityScore !== undefined) a.qualityScore = meta.qualityScore;
    if (meta.confidenceScore !== undefined) a.confidenceScore = meta.confidenceScore;
    if (meta.markAssessed) {
      a.assessedByUserId = meta.actorUserId;
      a.assessedAt = new Date();
    }
    if (meta.notes !== undefined) a.notes = meta.notes;
    a.updatedAt = new Date();
    return this.withRelations(a);
  }

  async supersede(oldAssessmentId: string, newAssessmentId: string, fromStatuses: string[]) {
    const a = this.assessments.find((x) => x.id === oldAssessmentId);
    if (!a || !fromStatuses.includes(a.status)) return false;
    a.status = "SUPERSEDED";
    a.supersededByAssessmentId = newAssessmentId;
    a.updatedAt = new Date();
    return true;
  }

  async addImage(assessmentId: string, data: AddImageData) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) throw new Error("QualityAssessment not found in fake repository.");
    a.images.push({
      id: randomUUID(),
      storageProvider: data.storageProvider,
      externalId: data.externalId,
      secureUrl: data.secureUrl,
      imageType: data.imageType,
      checksum: data.checksum ?? null,
      uploadedByUserId: data.uploadedByUserId,
      uploadedAt: new Date(),
    });
    a.updatedAt = new Date();
    return this.withRelations(a);
  }

  async removeImage(assessmentId: string, imageId: string) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) throw new Error("QualityAssessment not found in fake repository.");
    a.images = a.images.filter((img) => img.id !== imageId);
    a.updatedAt = new Date();
    return this.withRelations(a);
  }

  async countImages(assessmentId: string) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    return a ? a.images.length : 0;
  }

  async appendMetrics(assessmentId: string, metrics: MetricInputData[]) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) return;
    a.metrics.push(...metrics.map((m) => ({ ...m })));
    a.updatedAt = new Date();
  }

  async appendDefects(assessmentId: string, defects: DefectInputData[]) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) return;
    a.defects.push(...defects.map((d) => ({ ...d })));
    a.updatedAt = new Date();
  }

  async createAIAnalysis(assessmentId: string, data: CreateAIAnalysisData) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) throw new Error("QualityAssessment not found in fake repository.");
    const now = new Date();
    const row: FakeAiAnalysis = {
      id: randomUUID(),
      assessmentId,
      provider: data.provider,
      modelVersion: data.modelVersion,
      status: data.status,
      confidenceScore: null,
      rawResultJson: null,
      requestedByUserId: data.requestedByUserId,
      requestedAt: now,
      processedAt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    a.aiAnalyses.push(row);
    return { id: row.id };
  }

  async updateAIAnalysis(id: string, data: UpdateAIAnalysisData) {
    for (const a of this.assessments) {
      const row = a.aiAnalyses.find((r) => r.id === id);
      if (row) {
        if (data.status !== undefined) row.status = data.status;
        if (data.confidenceScore !== undefined) row.confidenceScore = data.confidenceScore;
        if (data.rawResultJson !== undefined) row.rawResultJson = data.rawResultJson;
        if (data.processedAt !== undefined) row.processedAt = data.processedAt;
        if (data.errorCode !== undefined) row.errorCode = data.errorCode;
        if (data.errorMessage !== undefined) row.errorMessage = data.errorMessage;
        row.updatedAt = new Date();
        return;
      }
    }
  }

  async findProcessingAIAnalysis(assessmentId: string) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    if (!a) return null;
    const row = a.aiAnalyses.find((r) => r.status === "QUEUED" || r.status === "PROCESSING");
    return row ? { id: row.id } : null;
  }

  async countAIAnalysisAttempts(assessmentId: string) {
    const a = this.assessments.find((x) => x.id === assessmentId);
    return a ? a.aiAnalyses.length : 0;
  }

  async farmerSummary(farmerId: string): Promise<FarmerQualitySummaryDTO> {
    const lots = this.cropLots.lots.filter((l) => l.farmerId === farmerId).map((l) => l.id);
    const mine = this.assessments.filter((a) => lots.includes(a.lotId));

    const gradeDistribution: Record<string, number> = {};
    for (const a of mine) {
      if (a.overallGrade) gradeDistribution[a.overallGrade] = (gradeDistribution[a.overallGrade] ?? 0) + 1;
    }
    const scored = mine.filter((a) => a.qualityScore !== null);
    const averageQualityScore = scored.length
      ? Math.round((scored.reduce((sum, a) => sum + (a.qualityScore ?? 0), 0) / scored.length) * 100) / 100
      : null;

    return {
      totalAssessments: mine.length,
      verified: mine.filter((a) => a.status === "VERIFIED").length,
      aiEstimated: mine.filter((a) => a.verificationStatus === "AI_ESTIMATED").length,
      pendingReview: mine.filter((a) => a.status === "PENDING_REVIEW").length,
      averageQualityScore,
      gradeDistribution,
    };
  }
}

export class InMemoryQualityStandardRepository implements QualityStandardRepository {
  private byCrop = new Map<string, QualityStandardRow[]>();

  seed(cropId: string, rows: QualityStandardRow[]): void {
    this.byCrop.set(cropId, rows);
  }

  async findByCropId(cropId: string): Promise<QualityStandardRow[]> {
    return this.byCrop.get(cropId) ?? [];
  }
}
