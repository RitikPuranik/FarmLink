import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, seedAndLoginAdmin, setupFarmerWithCrop } from "../testUtils/fpoTestHelpers";
import { ONION_CROP_ID } from "../testUtils/referenceDataFixtures";
import { QualityAIProvider } from "../../src/modules/quality/ai/quality-ai.provider";
import { QualityAiProviderError, QualityAnalysisRequest, QualityAnalysisResult } from "../../src/modules/quality/ai/quality-ai.types";

function authed(app: Express, token: string) {
  return {
    get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set("Authorization", `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

const AVAILABILITY_DATE = "2026-09-15";

class FakeAIProvider implements QualityAIProvider {
  readonly name = "fake-vision";
  readonly modelVersion = "test-1";
  callCount = 0;
  nextResult: QualityAnalysisResult | (() => QualityAnalysisResult) = {
    confidence: 0.9,
    suggestedGrade: "A",
    metrics: [{ code: "MOISTURE", name: "Moisture", value: 12, unit: "%" }],
    detectedDefects: [],
  };

  async analyze(_request: QualityAnalysisRequest): Promise<QualityAnalysisResult> {
    this.callCount += 1;
    return typeof this.nextResult === "function" ? this.nextResult() : this.nextResult;
  }
}

class AlwaysFailingAIProvider implements QualityAIProvider {
  readonly name = "always-fails";
  readonly modelVersion = "test-1";
  callCount = 0;

  async analyze(): Promise<QualityAnalysisResult> {
    this.callCount += 1;
    throw new QualityAiProviderError("PROVIDER_DOWN", "Simulated provider outage.");
  }
}

async function createAvailableLot(app: Express, token: string, farmId: string) {
  const createRes = await authed(app, token)
    .post("/api/lots")
    .send({ farmId, cropId: ONION_CROP_ID, quantity: 50, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
  const lot = createRes.body.data.lot as { publicId: string };
  await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();
  return lot;
}

describe("Quality Grading & Assessment (Module 5)", () => {
  describe("manual assessment lifecycle (build spec section 9/26/54)", () => {
    it("a farmer can self-report, but only an admin can verify it", async () => {
      const { app, authRepository } = buildTestApp();
      const { token: farmerToken, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, farmerToken, farmId);

      const createRes = await authed(app, farmerToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({
          source: "MANUAL",
          metrics: [
            { code: "MOISTURE", name: "Moisture", value: 12, unit: "%" },
            { code: "DAMAGE", name: "Damaged Produce", value: 3, unit: "%" },
          ],
          overallGrade: "A",
          notes: "Visual inspection completed",
        });

      expect(createRes.status).toEqual(201);
      const assessment = createRes.body.data.assessment;
      expect(assessment.status).toEqual("DRAFT");
      expect(assessment.verificationStatus).toEqual("SELF_REPORTED");
      expect(assessment.assessmentNumber).toMatch(/^QA-\d{4}-\d{6}$/);
      expect(assessment.overallGrade).toEqual("A");
      expect(assessment.metrics).toHaveLength(2);

      // Build spec section 55: the farmer who created it cannot verify it.
      const farmerVerify = await authed(app, farmerToken).post(`/api/quality-assessments/${assessment.publicId}/verify`).send();
      expect(farmerVerify.status).toEqual(403);

      const { token: adminToken } = await seedAndLoginAdmin(app, authRepository);
      const verifyRes = await authed(app, adminToken)
        .post(`/api/quality-assessments/${assessment.publicId}/verify`)
        .send({ notes: "Confirmed on site" });

      expect(verifyRes.status).toEqual(200);
      expect(verifyRes.body.data.assessment.status).toEqual("VERIFIED");
      expect(verifyRes.body.data.assessment.verificationStatus).toEqual("VERIFIED");
      expect(verifyRes.body.data.assessment.notes).toEqual("Confirmed on site");

      const summaryRes = await authed(app, farmerToken).get(`/api/lots/${lot.publicId}/quality-summary`);
      expect(summaryRes.body.data.hasAssessment).toBe(true);
      expect(summaryRes.body.data.currentAssessment.grade).toEqual("A");
      expect(summaryRes.body.data.currentAssessment.verificationStatus).toEqual("VERIFIED");
    });

    it("404s a lot the caller cannot access, and rejects assessing a lot in the wrong status", async () => {
      const { app } = buildTestApp();
      const { token: farmerToken, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, farmerToken, farmId);

      const { token: otherToken } = await registerAndLoginFarmer(app);
      const forbidden = await authed(app, otherToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "A" });
      expect(forbidden.status).toEqual(404);

      await authed(app, farmerToken).post(`/api/lots/${lot.publicId}/cancel`).send();
      const wrongStatus = await authed(app, farmerToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "A" });
      expect(wrongStatus.status).toEqual(409);
    });

    it("only allows editing/deleting images while DRAFT or PENDING_IMAGES", async () => {
      const { app, authRepository } = buildTestApp();
      const { token: farmerToken, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, farmerToken, farmId);

      const createRes = await authed(app, farmerToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "B" });
      const assessment = createRes.body.data.assessment;

      const editRes = await authed(app, farmerToken)
        .patch(`/api/quality-assessments/${assessment.publicId}`)
        .send({ overallGrade: "A", notes: "Updated after re-inspection" });
      expect(editRes.status).toEqual(200);
      expect(editRes.body.data.assessment.overallGrade).toEqual("A");

      const { token: adminToken } = await seedAndLoginAdmin(app, authRepository);
      await authed(app, adminToken).post(`/api/quality-assessments/${assessment.publicId}/verify`).send();

      const editAfterVerify = await authed(app, farmerToken)
        .patch(`/api/quality-assessments/${assessment.publicId}`)
        .send({ notes: "Trying to change history" });
      expect(editAfterVerify.status).toEqual(409);
    });
  });

  describe("AI pipeline (build spec section 19-25/38-42)", () => {
    it("requires at least 3 images before analysis can start", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);

      const createRes = await authed(app, token).post(`/api/lots/${lot.publicId}/quality-assessments`).send({ source: "AI" });
      const assessment = createRes.body.data.assessment;
      expect(assessment.status).toEqual("PENDING_IMAGES");

      const analyzeRes = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze`).send();
      expect(analyzeRes.status).toEqual(400);

      for (let i = 0; i < 3; i++) {
        const imgRes = await authed(app, token)
          .post(`/api/quality-assessments/${assessment.publicId}/images`)
          .send({ externalId: `img-${i}`, secureUrl: `https://cdn.example.com/img-${i}.jpg`, imageType: "OVERVIEW" });
        expect(imgRes.status).toEqual(201);
      }

      const finalGet = await authed(app, token).get(`/api/quality-assessments/${assessment.publicId}`);
      expect(finalGet.body.data.assessment.images).toHaveLength(3);
    });

    it("never fakes a result when no AI provider is available — stores a real FAILED attempt instead", async () => {
      const provider = new AlwaysFailingAIProvider();
      const { app } = buildTestApp({ qualityAiProvider: provider });
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);

      const createRes = await authed(app, token).post(`/api/lots/${lot.publicId}/quality-assessments`).send({ source: "AI" });
      const assessment = createRes.body.data.assessment;

      for (let i = 0; i < 3; i++) {
        await authed(app, token)
          .post(`/api/quality-assessments/${assessment.publicId}/images`)
          .send({ externalId: `img-${i}`, secureUrl: `https://cdn.example.com/img-${i}.jpg` });
      }

      const analyzeRes = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze`).send();
      expect(analyzeRes.status).toEqual(200);
      expect(analyzeRes.body.data.assessment.status).toEqual("FAILED");
      expect(analyzeRes.body.data.assessment.latestAiAnalysis.status).toEqual("FAILED");
      expect(analyzeRes.body.data.assessment.latestAiAnalysis.errorCode).toEqual("PROVIDER_DOWN");
      // Never a fabricated grade/confidence on a failed attempt.
      expect(analyzeRes.body.data.assessment.overallGrade).toBeNull();

      const retryRes = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze/retry`).send();
      expect(retryRes.status).toEqual(200);
      expect(retryRes.body.data.assessment.status).toEqual("FAILED");
      expect(provider.callCount).toEqual(2);

      // Analyze (not retry) no longer applies once already FAILED once —
      // only the dedicated retry endpoint does.
      const wrongEndpoint = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze`).send();
      expect(wrongEndpoint.status).toEqual(409);
    });

    it("enforces a retry limit so a farmer can't loop AI calls forever", async () => {
      const provider = new AlwaysFailingAIProvider();
      const { app } = buildTestApp({ qualityAiProvider: provider });
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);

      const createRes = await authed(app, token).post(`/api/lots/${lot.publicId}/quality-assessments`).send({ source: "AI" });
      const assessment = createRes.body.data.assessment;
      for (let i = 0; i < 3; i++) {
        await authed(app, token)
          .post(`/api/quality-assessments/${assessment.publicId}/images`)
          .send({ externalId: `img-${i}`, secureUrl: `https://cdn.example.com/img-${i}.jpg` });
      }

      await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze`).send();
      for (let i = 0; i < 3; i++) {
        await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze/retry`).send();
      }
      // That's 4 attempts so far (1 analyze + 3 retries); the 5th (a 4th
      // retry) should still be allowed (limit is 5), the 6th should not.
      const fifth = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze/retry`).send();
      expect(fifth.status).toEqual(200);
      const sixth = await authed(app, token).post(`/api/quality-assessments/${assessment.publicId}/analyze/retry`).send();
      expect(sixth.status).toEqual(409);
    });

    it("a successful high-confidence result completes normally; a low-confidence one routes to human review", async () => {
      const provider = new FakeAIProvider();
      const { app } = buildTestApp({ qualityAiProvider: provider });
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      // High confidence -> AI_COMPLETED.
      const lotA = await createAvailableLot(app, token, farmId);
      const aRes = await authed(app, token).post(`/api/lots/${lotA.publicId}/quality-assessments`).send({ source: "AI" });
      const aAssessment = aRes.body.data.assessment;
      for (let i = 0; i < 3; i++) {
        await authed(app, token)
          .post(`/api/quality-assessments/${aAssessment.publicId}/images`)
          .send({ externalId: `a-${i}`, secureUrl: `https://cdn.example.com/a-${i}.jpg` });
      }
      provider.nextResult = { confidence: 0.92, suggestedGrade: "A", metrics: [{ code: "MOISTURE", name: "Moisture", value: 11 }] };
      const aAnalyze = await authed(app, token).post(`/api/quality-assessments/${aAssessment.publicId}/analyze`).send();
      expect(aAnalyze.status).toEqual(200);
      expect(aAnalyze.body.data.assessment.status).toEqual("AI_COMPLETED");
      expect(aAnalyze.body.data.assessment.verificationStatus).toEqual("AI_ESTIMATED");
      expect(aAnalyze.body.data.assessment.overallGrade).toEqual("A");
      expect(aAnalyze.body.data.assessment.confidenceScore).toEqual(0.92);
      expect(aAnalyze.body.data.assessment.metrics).toHaveLength(1);

      // Build spec section 40: re-analyzing an already-completed
      // assessment returns the same result without a second provider call.
      const callsBeforeReanalyze = provider.callCount;
      const reanalyze = await authed(app, token).post(`/api/quality-assessments/${aAssessment.publicId}/analyze`).send();
      expect(reanalyze.status).toEqual(200);
      expect(reanalyze.body.data.assessment.status).toEqual("AI_COMPLETED");
      expect(provider.callCount).toEqual(callsBeforeReanalyze);

      // Low confidence -> PENDING_REVIEW, never auto-verified.
      const lotB = await createAvailableLot(app, token, farmId);
      const bRes = await authed(app, token).post(`/api/lots/${lotB.publicId}/quality-assessments`).send({ source: "AI" });
      const bAssessment = bRes.body.data.assessment;
      for (let i = 0; i < 3; i++) {
        await authed(app, token)
          .post(`/api/quality-assessments/${bAssessment.publicId}/images`)
          .send({ externalId: `b-${i}`, secureUrl: `https://cdn.example.com/b-${i}.jpg` });
      }
      provider.nextResult = { confidence: 0.4, suggestedGrade: "B", metrics: [] };
      const bAnalyze = await authed(app, token).post(`/api/quality-assessments/${bAssessment.publicId}/analyze`).send();
      expect(bAnalyze.status).toEqual(200);
      expect(bAnalyze.body.data.assessment.status).toEqual("PENDING_REVIEW");
    });
  });

  describe("image rules (build spec section 17-18/52)", () => {
    it("rejects more than 10 images on one assessment", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);
      const createRes = await authed(app, token).post(`/api/lots/${lot.publicId}/quality-assessments`).send({ source: "AI" });
      const assessment = createRes.body.data.assessment;

      for (let i = 0; i < 10; i++) {
        const res = await authed(app, token)
          .post(`/api/quality-assessments/${assessment.publicId}/images`)
          .send({ externalId: `img-${i}`, secureUrl: `https://cdn.example.com/img-${i}.jpg` });
        expect(res.status).toEqual(201);
      }
      const eleventh = await authed(app, token)
        .post(`/api/quality-assessments/${assessment.publicId}/images`)
        .send({ externalId: "img-11", secureUrl: "https://cdn.example.com/img-11.jpg" });
      expect(eleventh.status).toEqual(400);
    });

    it("removes an image while still editable", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);
      const createRes = await authed(app, token).post(`/api/lots/${lot.publicId}/quality-assessments`).send({ source: "AI" });
      const assessment = createRes.body.data.assessment;

      const imgRes = await authed(app, token)
        .post(`/api/quality-assessments/${assessment.publicId}/images`)
        .send({ externalId: "img-0", secureUrl: "https://cdn.example.com/img-0.jpg" });
      const imageId = imgRes.body.data.assessment.images[0].id;

      const deleteRes = await authed(app, token).delete(`/api/quality-assessments/${assessment.publicId}/images/${imageId}`);
      expect(deleteRes.status).toEqual(200);
      expect(deleteRes.body.data.assessment.images).toHaveLength(0);
    });
  });

  describe("supersession & history (build spec section 31-33)", () => {
    it("preserves a superseded assessment and links it to whatever replaced it", async () => {
      const { app, authRepository } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);
      const { token: adminToken } = await seedAndLoginAdmin(app, authRepository);

      const firstRes = await authed(app, token)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "B" });
      const first = firstRes.body.data.assessment;
      await authed(app, adminToken).post(`/api/quality-assessments/${first.publicId}/verify`).send();

      const secondRes = await authed(app, token)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "A" });
      const second = secondRes.body.data.assessment;
      const secondVerify = await authed(app, adminToken).post(`/api/quality-assessments/${second.publicId}/verify`).send();
      expect(secondVerify.status).toEqual(200);

      const firstAfter = await authed(app, token).get(`/api/quality-assessments/${first.publicId}`);
      expect(firstAfter.body.data.assessment.status).toEqual("SUPERSEDED");
      expect(firstAfter.body.data.assessment.supersededByAssessmentPublicId).toEqual(second.publicId);

      const historyRes = await authed(app, token).get(`/api/lots/${lot.publicId}/quality-assessments`);
      expect(historyRes.body.data.total).toEqual(2);

      const summaryRes = await authed(app, token).get(`/api/lots/${lot.publicId}/quality-summary`);
      expect(summaryRes.body.data.currentAssessment.publicId).toEqual(second.publicId);
    });
  });

  describe("FPO-owned lots (build spec section 27/56)", () => {
    it("lets an FPO admin verify an assessment on their own FPO's lot", async () => {
      const { app, authRepository } = buildTestApp();
      const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

      const lotRes = await authed(app, adminToken)
        .post("/api/lots")
        .send({ fpoId, cropId: ONION_CROP_ID, quantity: 50, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      const lot = lotRes.body.data.lot;
      await authed(app, adminToken).post(`/api/lots/${lot.publicId}/publish`).send();

      const createRes = await authed(app, adminToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "LAB", overallGrade: "A" });
      const assessment = createRes.body.data.assessment;

      const verifyRes = await authed(app, adminToken).post(`/api/quality-assessments/${assessment.publicId}/verify`).send();
      expect(verifyRes.status).toEqual(200);
      // Build spec section 28: a LAB-source assessment becomes
      // LAB_VERIFIED, never plain VERIFIED.
      expect(verifyRes.body.data.assessment.verificationStatus).toEqual("LAB_VERIFIED");
    });

    it("403s an FPO admin from a different FPO trying to verify", async () => {
      const { app, authRepository } = buildTestApp();
      const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
      const { token: otherAdminToken } = await createFpoAsAdmin(app, authRepository, { name: "Other FPO" });

      const lotRes = await authed(app, adminToken)
        .post("/api/lots")
        .send({ fpoId, cropId: ONION_CROP_ID, quantity: 50, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      const lot = lotRes.body.data.lot;
      await authed(app, adminToken).post(`/api/lots/${lot.publicId}/publish`).send();

      const createRes = await authed(app, adminToken)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "A" });
      const assessment = createRes.body.data.assessment;

      // A different FPO's admin cannot even see this FPO-owned lot's
      // assessment (mirrors Module 4's lot-visibility rule) — 404, not 403.
      const otherView = await authed(app, otherAdminToken).get(`/api/quality-assessments/${assessment.publicId}`);
      expect(otherView.status).toEqual(404);
    });
  });

  describe("summaries", () => {
    it("computes a farmer's quality dashboard summary", async () => {
      const { app, authRepository } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const { token: adminToken } = await seedAndLoginAdmin(app, authRepository);

      const lot1 = await createAvailableLot(app, token, farmId);
      const a1 = (
        await authed(app, token).post(`/api/lots/${lot1.publicId}/quality-assessments`).send({ source: "MANUAL", overallGrade: "A" })
      ).body.data.assessment;
      await authed(app, adminToken).post(`/api/quality-assessments/${a1.publicId}/verify`).send();

      const lot2 = await createAvailableLot(app, token, farmId);
      await authed(app, token).post(`/api/lots/${lot2.publicId}/quality-assessments`).send({ source: "MANUAL", overallGrade: "B" });

      const summaryRes = await authed(app, token).get("/api/farmers/me/quality-summary");
      expect(summaryRes.status).toEqual(200);
      expect(summaryRes.body.data.totalAssessments).toEqual(2);
      expect(summaryRes.body.data.verified).toEqual(1);
      expect(summaryRes.body.data.gradeDistribution).toEqual({ A: 1, B: 1 });
    });
  });

  describe("crop-specific grading standards (build spec section 14/47-48)", () => {
    it("auto-computes a grade from configured QualityStandard rules", async () => {
      const { app, qualityStandardRepository } = buildTestApp();
      qualityStandardRepository.seed(ONION_CROP_ID, [
        { grade: "A", metricCode: "DAMAGE", minValue: null, maxValue: 5 },
        { grade: "A", metricCode: "UNIFORMITY", minValue: 90, maxValue: null },
        { grade: "B", metricCode: "DAMAGE", minValue: null, maxValue: 10 },
      ]);
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createAvailableLot(app, token, farmId);

      // Meets grade A on both configured metrics.
      const gradeA = await authed(app, token)
        .post(`/api/lots/${lot.publicId}/quality-assessments`)
        .send({
          source: "MANUAL",
          metrics: [
            { code: "DAMAGE", name: "Damage", value: 3 },
            { code: "UNIFORMITY", name: "Uniformity", value: 92 },
          ],
        });
      expect(gradeA.body.data.assessment.overallGrade).toEqual("A");

      // Fails grade A (uniformity too low) but passes grade B.
      const lot2 = await createAvailableLot(app, token, farmId);
      const gradeB = await authed(app, token)
        .post(`/api/lots/${lot2.publicId}/quality-assessments`)
        .send({
          source: "MANUAL",
          metrics: [
            { code: "DAMAGE", name: "Damage", value: 8 },
            { code: "UNIFORMITY", name: "Uniformity", value: 60 },
          ],
        });
      expect(gradeB.body.data.assessment.overallGrade).toEqual("B");

      // An explicit grade from the caller always wins over the computed one.
      const lot3 = await createAvailableLot(app, token, farmId);
      const explicit = await authed(app, token)
        .post(`/api/lots/${lot3.publicId}/quality-assessments`)
        .send({ source: "MANUAL", overallGrade: "C", metrics: [{ code: "DAMAGE", name: "Damage", value: 3 }] });
      expect(explicit.body.data.assessment.overallGrade).toEqual("C");
    });
  });

  it("requires authentication", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/farmers/me/quality-summary");
    expect(res.status).toEqual(401);
  });
});
