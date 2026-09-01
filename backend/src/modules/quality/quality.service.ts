import { CropLotStatus, QualityAssessmentStatus, QualityMetricSource, QualityVerificationStatus } from "@prisma/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../common/errors";
import { trackEvent } from "../../config/posthog";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUserContext, RequestMeta } from "../auth/auth.types";
import { FarmerProfileResolver } from "../farmers/farmer-profile.resolver";
import { CropLotRepository } from "../lots/lots.repository";
import { CropLotWithRelations } from "../lots/lots.types";
import { QualityAIProvider } from "./ai/quality-ai.provider";
import { QualityAiProviderError } from "./ai/quality-ai.types";
import { QualityAuthorizationService } from "./quality.authorization";
import { QualityGradingService } from "./quality-grading.service";
import { EDITABLE_STATUSES, QualityStatusService, SUPERSEDABLE_STATUSES } from "./quality-status.service";
import { QualityRepository } from "./quality.repository";
import { AddImageInput, CreateAssessmentInput, ListAssessmentsQuery, UpdateAssessmentInput, VerifyAssessmentInput } from "./quality.schemas";
import {
  FarmerQualitySummaryDTO,
  LotQualitySummaryDTO,
  QualityAssessmentDTO,
  QualityAssessmentWithRelations,
  toQualityAssessmentDTO,
} from "./quality.types";

export interface QualityListResult {
  items: QualityAssessmentDTO[];
  total: number;
  page: number;
  limit: number;
}

// Build spec section 17: 10 images per assessment, 3 minimum for AI.
const MAX_IMAGES_PER_ASSESSMENT = 10;
const MIN_IMAGES_FOR_AI = 3;
// Build spec section 39/40: a hard ceiling on AI attempts per assessment —
// "do not allow infinite AI API cost loops."
const MAX_AI_ATTEMPTS = 5;
// Build spec section 24.
const LOW_CONFIDENCE_THRESHOLD = 0.7;

// Build spec section 30: lots further along the transaction pipeline
// (COMMITTED and beyond) or already CANCELLED are not assessable here.
const ASSESSABLE_LOT_STATUSES: CropLotStatus[] = ["DRAFT", "AVAILABLE", "PARTIALLY_COMMITTED", "STORED"];

const VERIFIABLE_FROM_STATUSES: QualityAssessmentStatus[] = ["DRAFT", "PENDING_IMAGES", "AI_COMPLETED", "PENDING_REVIEW"];

/** Build spec section 28: anything a human typed into this API (as
 * opposed to something the AI provider produced) is MANUAL-sourced,
 * except for a LAB-source assessment, where the same human action means
 * "I am entering lab results". */
function deriveManualMetricSource(assessmentSource: string): QualityMetricSource {
  return assessmentSource === "LAB" ? "LAB" : "MANUAL";
}

/**
 * Build spec section 73/74/82: the orchestration layer for Module 5.
 * Controllers only parse/validate/call/respond; every ownership check,
 * state-machine rule, grading call and audit/analytics event for a
 * QualityAssessment lives here — reusing Module 4's own lot resolution and
 * authorization (`CropLotRepository`, `LotAuthorizationService` via
 * `QualityAuthorizationService`) rather than re-deriving lot ownership a
 * second time.
 */
export class QualityService {
  constructor(
    private readonly quality: QualityRepository,
    private readonly lots: CropLotRepository,
    private readonly farmerProfiles: FarmerProfileResolver,
    private readonly grading: QualityGradingService,
    private readonly statusService: QualityStatusService,
    private readonly authorization: QualityAuthorizationService,
    private readonly aiProvider: QualityAIProvider,
    private readonly audit: AuditService,
  ) {}

  private async loadAccessibleLotOrThrow(user: AuthenticatedUserContext, lotPublicId: string): Promise<CropLotWithRelations> {
    const lot = await this.lots.findByPublicId(lotPublicId);
    if (!lot) throw new NotFoundError("Lot not found.");

    const callerFarmerProfileId = user.role === "FARMER" ? (await this.farmerProfiles.ensure(user.id)).id : null;
    const canAccess = await this.authorization.canAccessLot(user, lot, callerFarmerProfileId);
    if (!canAccess) throw new NotFoundError("Lot not found.");

    return lot;
  }

  /** Build spec section 76: a quality assessment is exactly as private as
   * the lot it belongs to — an unauthorized caller gets the same 404 an
   * unauthorized lot lookup would (mirrors lots.service.ts's
   * loadOwnedLotOrThrow). */
  private async loadAccessibleAssessmentOrThrow(
    user: AuthenticatedUserContext,
    publicId: string,
  ): Promise<QualityAssessmentWithRelations> {
    const assessment = await this.quality.findByPublicId(publicId);
    if (!assessment) throw new NotFoundError("Quality assessment not found.");

    const callerFarmerProfileId = user.role === "FARMER" ? (await this.farmerProfiles.ensure(user.id)).id : null;
    const canAccess = await this.authorization.canAccessLot(user, assessment.lot, callerFarmerProfileId);
    if (!canAccess) throw new NotFoundError("Quality assessment not found.");

    return assessment;
  }

  async createAssessment(
    user: AuthenticatedUserContext,
    lotPublicId: string,
    input: CreateAssessmentInput,
    meta: RequestMeta,
  ): Promise<QualityAssessmentDTO> {
    const lot = await this.loadAccessibleLotOrThrow(user, lotPublicId);

    if (!ASSESSABLE_LOT_STATUSES.includes(lot.status)) {
      throw new ConflictError(
        "Quality assessments can only be created for lots that are draft, available, partially committed, or stored.",
      );
    }

    // Build spec section 9/16: an AI or hybrid assessment needs images
    // before anything can run — a manual/lab one can go straight to
    // review/verification with no image step at all.
    const initialStatus: QualityAssessmentStatus = input.source === "AI" || input.source === "HYBRID" ? "PENDING_IMAGES" : "DRAFT";
    const metricSource = deriveManualMetricSource(input.source);

    // Build spec section 28/55: always SELF_REPORTED at creation, no
    // matter who created it or what grade they claimed — only the AI
    // pipeline (-> AI_ESTIMATED) or the role-gated /verify endpoint (->
    // VERIFIED/LAB_VERIFIED) can move this forward.
    const verificationStatus: QualityVerificationStatus = "SELF_REPORTED";

    let overallGrade = input.overallGrade ?? null;
    if (!overallGrade && input.metrics?.length) {
      overallGrade = await this.grading.determineGrade(
        lot.cropId,
        input.metrics.map((m) => ({ metricCode: m.code, value: m.value })),
      );
    }

    const created = await this.quality.create(
      {
        lotId: lot.id,
        source: input.source,
        status: initialStatus,
        verificationStatus,
        overallGrade,
        notes: input.notes ?? null,
        metrics: input.metrics?.map((m) => ({
          metricCode: m.code,
          metricName: m.name,
          value: m.value,
          unit: m.unit ?? null,
          minAllowed: m.minAllowed ?? null,
          maxAllowed: m.maxAllowed ?? null,
          source: metricSource,
        })),
      },
      user.id,
    );

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_ASSESSMENT_CREATED",
      entityType: "QualityAssessment",
      entityId: created.id,
      metadata: { lotId: lot.id, source: input.source, status: created.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("quality_assessment_created", user.id, { source: input.source });

    return toQualityAssessmentDTO(created);
  }

  async listByLot(user: AuthenticatedUserContext, lotPublicId: string, query: ListAssessmentsQuery): Promise<QualityListResult> {
    const lot = await this.loadAccessibleLotOrThrow(user, lotPublicId);
    const result = await this.quality.listByLotId(lot.id, query.page, query.limit);
    return {
      items: result.items.map(toQualityAssessmentDTO),
      total: result.total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getAssessment(user: AuthenticatedUserContext, publicId: string): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);
    return toQualityAssessmentDTO(assessment);
  }

  async updateAssessment(
    user: AuthenticatedUserContext,
    publicId: string,
    input: UpdateAssessmentInput,
    meta: RequestMeta,
  ): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    // Build spec section 53: once processing/AI/verification has started,
    // create a new assessment instead of mutating this one.
    if (!EDITABLE_STATUSES.includes(assessment.status)) {
      throw new ConflictError("Only a draft or pending-images assessment can be edited. Create a new assessment instead.");
    }

    const metricSource = deriveManualMetricSource(assessment.source);
    let overallGrade = input.overallGrade;
    if (overallGrade === undefined && input.metrics !== undefined && input.metrics.length > 0) {
      const computed = await this.grading.determineGrade(
        assessment.lot.cropId,
        input.metrics.map((m) => ({ metricCode: m.code, value: m.value })),
      );
      if (computed) overallGrade = computed;
    }

    const updated = await this.quality.updateEditable(assessment.id, {
      ...(overallGrade !== undefined ? { overallGrade } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.metrics !== undefined
        ? {
            metrics: input.metrics.map((m) => ({
              metricCode: m.code,
              metricName: m.name,
              value: m.value,
              unit: m.unit ?? null,
              minAllowed: m.minAllowed ?? null,
              maxAllowed: m.maxAllowed ?? null,
              source: metricSource,
            })),
          }
        : {}),
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_ASSESSMENT_UPDATED",
      entityType: "QualityAssessment",
      entityId: updated.id,
      metadata: { fields: Object.keys(input) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toQualityAssessmentDTO(updated);
  }

  async addImage(user: AuthenticatedUserContext, publicId: string, input: AddImageInput, meta: RequestMeta): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    if (!EDITABLE_STATUSES.includes(assessment.status)) {
      throw new ConflictError("Images can only be added while the assessment is still draft or pending images.");
    }

    const currentCount = await this.quality.countImages(assessment.id);
    if (currentCount >= MAX_IMAGES_PER_ASSESSMENT) {
      throw new ValidationError("Please correct the highlighted fields", {
        image: `A quality assessment can have at most ${MAX_IMAGES_PER_ASSESSMENT} images.`,
      });
    }

    const updated = await this.quality.addImage(assessment.id, {
      storageProvider: input.storageProvider,
      externalId: input.externalId,
      secureUrl: input.secureUrl,
      imageType: input.imageType,
      checksum: input.checksum ?? null,
      uploadedByUserId: user.id,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_IMAGE_UPLOADED",
      entityType: "QualityAssessment",
      entityId: assessment.id,
      metadata: { imageType: input.imageType },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("quality_images_uploaded", user.id, { assessmentId: assessment.id });

    return toQualityAssessmentDTO(updated);
  }

  async removeImage(user: AuthenticatedUserContext, publicId: string, imageId: string, meta: RequestMeta): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    // Build spec section 52: never after a verified assessment — that
    // would destroy evidence.
    if (!EDITABLE_STATUSES.includes(assessment.status)) {
      throw new ConflictError("Images can only be removed while the assessment is still draft or pending images.");
    }

    const image = assessment.images.find((img) => img.id === imageId);
    if (!image) throw new NotFoundError("Image not found on this assessment.");

    const updated = await this.quality.removeImage(assessment.id, imageId);

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_IMAGE_REMOVED",
      entityType: "QualityAssessment",
      entityId: assessment.id,
      metadata: { imageId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toQualityAssessmentDTO(updated);
  }

  async analyzeAssessment(user: AuthenticatedUserContext, publicId: string, meta: RequestMeta): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    // Build spec section 40: an identical successful result already
    // exists for this assessment — return it instead of spending another
    // provider call.
    if (assessment.status === "AI_COMPLETED" || assessment.status === "PENDING_REVIEW" || assessment.status === "VERIFIED") {
      return toQualityAssessmentDTO(assessment);
    }

    if (assessment.status !== "PENDING_IMAGES") {
      throw new ConflictError("This assessment is not ready for AI analysis.");
    }

    await this.assertCanStartAnalysis(assessment);

    return this.runAiAnalysis(assessment, user, meta);
  }

  async retryAnalyzeAssessment(user: AuthenticatedUserContext, publicId: string, meta: RequestMeta): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    // Build spec section 39: retry is only ever reachable from FAILED.
    if (assessment.status !== "FAILED") {
      throw new ConflictError("Only a failed analysis can be retried.");
    }

    await this.assertCanStartAnalysis(assessment);

    return this.runAiAnalysis(assessment, user, meta);
  }

  private async assertCanStartAnalysis(assessment: QualityAssessmentWithRelations): Promise<void> {
    // Build spec section 40/69: idempotency — never launch a second
    // provider call while one is already running.
    const alreadyProcessing = await this.quality.findProcessingAIAnalysis(assessment.id);
    if (alreadyProcessing) {
      throw new ConflictError("An AI analysis is already in progress for this assessment.");
    }

    const attempts = await this.quality.countAIAnalysisAttempts(assessment.id);
    if (attempts >= MAX_AI_ATTEMPTS) {
      throw new ConflictError("This assessment has reached its AI analysis retry limit.");
    }

    const imageCount = await this.quality.countImages(assessment.id);
    if (imageCount < MIN_IMAGES_FOR_AI) {
      throw new ValidationError("Please correct the highlighted fields", {
        images: `At least ${MIN_IMAGES_FOR_AI} images are required for AI analysis.`,
      });
    }
  }

  /**
   * Build spec section 20-25/67: the actual AI pipeline, shared by both
   * the first analyze call (from PENDING_IMAGES) and a retry (from
   * FAILED) — both callers have already validated their own entry status
   * before reaching here.
   */
  private async runAiAnalysis(
    assessment: QualityAssessmentWithRelations,
    user: AuthenticatedUserContext,
    meta: RequestMeta,
  ): Promise<QualityAssessmentDTO> {
    const processing = await this.quality.transition(assessment.id, [assessment.status], "PROCESSING", {
      actorUserId: user.id,
      fromStatus: assessment.status,
    });
    if (!processing) {
      throw new ConflictError("This assessment was already updated by someone else. Please refresh and try again.");
    }

    const aiRow = await this.quality.createAIAnalysis(assessment.id, {
      provider: this.aiProvider.name,
      modelVersion: this.aiProvider.modelVersion,
      status: "PROCESSING",
      requestedByUserId: user.id,
    });

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_AI_ANALYSIS_STARTED",
      entityType: "QualityAssessment",
      entityId: assessment.id,
      metadata: { provider: this.aiProvider.name, modelVersion: this.aiProvider.modelVersion },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("quality_ai_analysis_started", user.id, { provider: this.aiProvider.name });

    try {
      const result = await this.aiProvider.analyze({
        assessmentPublicId: assessment.publicId,
        cropName: assessment.lot.crop.name,
        images: assessment.images.map((img) => ({ externalId: img.externalId, secureUrl: img.secureUrl, imageType: img.imageType })),
      });

      await this.quality.updateAIAnalysis(aiRow.id, {
        status: "COMPLETED",
        confidenceScore: result.confidence,
        rawResultJson: { ...result },
        processedAt: new Date(),
      });

      if (result.metrics.length) {
        await this.quality.appendMetrics(
          assessment.id,
          result.metrics.map((m) => ({ metricCode: m.code, metricName: m.name, value: m.value, unit: m.unit ?? null, source: "AI" })),
        );
      }
      if (result.detectedDefects?.length) {
        await this.quality.appendDefects(
          assessment.id,
          result.detectedDefects.map((d) => ({
            code: d.code,
            name: d.name,
            severity: d.severity,
            affectedPercentage: d.affectedPercentage ?? null,
            confidence: d.confidence ?? null,
          })),
        );
      }

      const combinedMetrics = [
        ...assessment.metrics.map((m) => ({ metricCode: m.metricCode, value: Number(m.value) })),
        ...result.metrics.map((m) => ({ metricCode: m.code, value: m.value })),
      ];
      const grade = result.suggestedGrade ?? (await this.grading.determineGrade(assessment.lot.cropId, combinedMetrics));
      const computedScore = this.grading.calculateScore(
        (result.detectedDefects ?? []).map((d) => ({ severity: d.severity, affectedPercentage: d.affectedPercentage ?? null })),
      );
      const existingScore = assessment.qualityScore !== null ? Number(assessment.qualityScore) : null;
      const existingGrade = assessment.overallGrade ?? null;

      const completed = await this.quality.transition(assessment.id, ["PROCESSING"], "AI_COMPLETED", {
        actorUserId: user.id,
        fromStatus: "PROCESSING",
        verificationStatus: "AI_ESTIMATED",
        overallGrade: grade ?? existingGrade,
        qualityScore: computedScore ?? existingScore,
        confidenceScore: result.confidence,
      });
      if (!completed) {
        throw new ConflictError("This assessment was already updated by someone else. Please refresh and try again.");
      }

      await this.audit.record({
        actorUserId: user.id,
        action: "QUALITY_AI_ANALYSIS_COMPLETED",
        entityType: "QualityAssessment",
        entityId: assessment.id,
        metadata: { confidence: result.confidence, grade: grade ?? null },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      trackEvent("quality_ai_analysis_completed", user.id, { confidence: result.confidence });

      // Build spec section 24: low confidence never auto-verifies — move
      // straight to human review instead.
      if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
        const reviewed = await this.quality.transition(assessment.id, ["AI_COMPLETED"], "PENDING_REVIEW", {
          actorUserId: user.id,
          fromStatus: "AI_COMPLETED",
        });
        if (reviewed) return toQualityAssessmentDTO(reviewed);
      }

      return toQualityAssessmentDTO(completed);
    } catch (err) {
      const providerError =
        err instanceof QualityAiProviderError
          ? err
          : new QualityAiProviderError("AI_ANALYSIS_FAILED", "The AI analysis attempt failed unexpectedly.");

      await this.quality.updateAIAnalysis(aiRow.id, {
        status: "FAILED",
        processedAt: new Date(),
        errorCode: providerError.code,
        errorMessage: providerError.message,
      });

      const failed = await this.quality.transition(assessment.id, ["PROCESSING"], "FAILED", {
        actorUserId: user.id,
        fromStatus: "PROCESSING",
      });

      await this.audit.record({
        actorUserId: user.id,
        action: "QUALITY_AI_ANALYSIS_FAILED",
        entityType: "QualityAssessment",
        entityId: assessment.id,
        metadata: { errorCode: providerError.code },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return toQualityAssessmentDTO(failed ?? processing);
    }
  }

  async verifyAssessment(
    user: AuthenticatedUserContext,
    publicId: string,
    input: VerifyAssessmentInput,
    meta: RequestMeta,
  ): Promise<QualityAssessmentDTO> {
    const assessment = await this.loadAccessibleAssessmentOrThrow(user, publicId);

    // Build spec section 55/56: a visible-but-forbidden action — the
    // caller can already see this assessment (loadAccessibleAssessmentOrThrow
    // just proved that), so a 403 here correctly says "I can see this, you
    // just can't verify it" rather than pretending it doesn't exist.
    const canVerify = await this.authorization.canVerify(user, assessment.lot);
    if (!canVerify) {
      throw new AuthorizationError("You do not have permission to verify this assessment.");
    }

    if (!VERIFIABLE_FROM_STATUSES.includes(assessment.status)) {
      throw new ConflictError("This assessment cannot be verified from its current status.");
    }
    this.statusService.validateTransition(assessment.status, "VERIFIED");

    if (input.metrics?.length) {
      await this.quality.appendMetrics(
        assessment.id,
        input.metrics.map((m) => ({
          metricCode: m.code,
          metricName: m.name,
          value: m.value,
          unit: m.unit ?? null,
          minAllowed: m.minAllowed ?? null,
          maxAllowed: m.maxAllowed ?? null,
          source: "MANUAL",
        })),
      );
    }

    const combinedMetrics = [
      ...assessment.metrics.map((m) => ({ metricCode: m.metricCode, value: Number(m.value) })),
      ...(input.metrics ?? []).map((m) => ({ metricCode: m.code, value: m.value })),
    ];
    let overallGrade = input.overallGrade ?? assessment.overallGrade ?? null;
    if (!overallGrade) {
      overallGrade = await this.grading.determineGrade(assessment.lot.cropId, combinedMetrics);
    }
    const existingScore = assessment.qualityScore !== null ? Number(assessment.qualityScore) : null;
    const qualityScore = input.qualityScore ?? existingScore;

    // Build spec section 28: never LAB_VERIFIED for a non-LAB assessment —
    // the trust label always reflects how this data actually got here.
    const verificationStatus: QualityVerificationStatus = assessment.source === "LAB" ? "LAB_VERIFIED" : "VERIFIED";

    // Build spec section 33: whatever was the lot's "current" assessment
    // before this verification becomes superseded by it — excluding this
    // assessment itself, which would otherwise always "win" as most
    // recently created (see findCurrentByLotId's own comment).
    const previousCurrent = await this.quality.findCurrentByLotId(assessment.lotId, assessment.id);

    const verified = await this.quality.transition(assessment.id, [assessment.status], "VERIFIED", {
      actorUserId: user.id,
      fromStatus: assessment.status,
      verificationStatus,
      overallGrade,
      qualityScore,
      markAssessed: true,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    if (!verified) {
      throw new ConflictError("This assessment was already updated by someone else. Please refresh and try again.");
    }

    if (previousCurrent && previousCurrent.id !== assessment.id) {
      await this.quality.supersede(previousCurrent.id, assessment.id, SUPERSEDABLE_STATUSES);
    }

    await this.audit.record({
      actorUserId: user.id,
      action: "QUALITY_ASSESSMENT_VERIFIED",
      entityType: "QualityAssessment",
      entityId: assessment.id,
      metadata: { verificationStatus, overallGrade },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    trackEvent("quality_assessment_verified", user.id, { verificationStatus });

    return toQualityAssessmentDTO(verified);
  }

  async getLotQualitySummary(user: AuthenticatedUserContext, lotPublicId: string): Promise<LotQualitySummaryDTO> {
    const lot = await this.loadAccessibleLotOrThrow(user, lotPublicId);
    const current = await this.quality.findCurrentByLotId(lot.id);

    if (!current) return { hasAssessment: false, currentAssessment: null };

    return {
      hasAssessment: true,
      currentAssessment: {
        publicId: current.publicId,
        grade: current.overallGrade,
        qualityScore: current.qualityScore !== null ? Number(current.qualityScore) : null,
        verificationStatus: current.verificationStatus,
        confidence: current.confidenceScore !== null ? Number(current.confidenceScore) : null,
        assessedAt: current.assessedAt ? current.assessedAt.toISOString() : null,
      },
    };
  }

  async getFarmerQualitySummary(user: AuthenticatedUserContext): Promise<FarmerQualitySummaryDTO> {
    const profile = await this.farmerProfiles.ensure(user.id);
    return this.quality.farmerSummary(profile.id);
  }
}
