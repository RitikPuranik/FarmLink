import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, setupFarmerWithCrop } from "../testUtils/fpoTestHelpers";
import { ONION_CROP_ID, SOYBEAN_CROP_ID, INACTIVE_CROP_ID } from "../testUtils/referenceDataFixtures";

function authed(app: import("express").Express, token: string) {
  return {
    get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set("Authorization", `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set("Authorization", `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
  };
}

const AVAILABILITY_DATE = "2026-09-15";

describe("Crop lots (Module 4)", () => {
  // Build spec section 101: the full acceptance scenario end to end.
  it("full lifecycle: create draft -> publish -> list -> view -> history -> cancel", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

    const createRes = await authed(app, token)
      .post("/api/lots")
      .send({
        farmId,
        cropId: ONION_CROP_ID,
        quantity: 100,
        unit: "QTL",
        variety: "Local",
        availabilityDate: AVAILABILITY_DATE,
      });

    expect(createRes.status).toEqual(201);
    const lot = createRes.body.data.lot;
    expect(lot.status).toEqual("DRAFT");
    expect(lot.lotNumber).toMatch(/^LOT-\d{4}-\d{6}$/);
    expect(lot.sourceType).toEqual("FARMER_CREATED");
    expect(lot.ownerType).toEqual("FARMER");
    expect(lot.crop.name).toEqual("Onion");
    expect(lot.farm.id).toEqual(farmId);
    // Build spec section 67: 100 QTL stored/echoed correctly.
    expect(lot.quantity).toEqual({ value: 100, unit: "QTL", quantityKg: 10000 });
    expect(lot.availableQuantity).toEqual({ value: 100, unit: "QTL" });
    expect(lot.origin).toEqual({ village: "Pimpalgaon", taluka: "Niphad", district: "Nashik", state: "Maharashtra" });
    expect(lot.qrCodeValue).toContain(lot.publicId);

    const publishRes = await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();
    expect(publishRes.status).toEqual(200);
    expect(publishRes.body.data.lot.status).toEqual("AVAILABLE");

    const listRes = await authed(app, token).get("/api/lots?status=AVAILABLE");
    expect(listRes.status).toEqual(200);
    expect(listRes.body.data.total).toEqual(1);
    expect(listRes.body.data.items[0].publicId).toEqual(lot.publicId);

    const getRes = await authed(app, token).get(`/api/lots/${lot.publicId}`);
    expect(getRes.status).toEqual(200);
    expect(getRes.body.data.lot.status).toEqual("AVAILABLE");

    const historyRes = await authed(app, token).get(`/api/lots/${lot.publicId}/history`);
    expect(historyRes.status).toEqual(200);
    expect(historyRes.body.data.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: "DRAFT" }),
      expect.objectContaining({ fromStatus: "DRAFT", toStatus: "AVAILABLE" }),
    ]);

    const summaryRes = await authed(app, token).get("/api/farmers/me/lots/summary");
    expect(summaryRes.status).toEqual(200);
    expect(summaryRes.body.data).toEqual({
      totalLots: 1,
      draftLots: 0,
      availableLots: 1,
      cancelledLots: 0,
      totalAvailableQuantityKg: 10000,
    });

    const cancelRes = await authed(app, token).post(`/api/lots/${lot.publicId}/cancel`).send();
    expect(cancelRes.status).toEqual(200);
    expect(cancelRes.body.data.lot.status).toEqual("CANCELLED");

    const finalHistory = await authed(app, token).get(`/api/lots/${lot.publicId}/history`);
    expect(finalHistory.body.data.history).toHaveLength(3);
    expect(finalHistory.body.data.history[2]).toEqual(
      expect.objectContaining({ fromStatus: "AVAILABLE", toStatus: "CANCELLED" }),
    );
  });

  describe("farm/crop validation (build spec section 80)", () => {
    it("403s when creating a lot against a farm owned by a different farmer", async () => {
      const { app } = buildTestApp();
      const { farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const { token: otherToken } = await registerAndLoginFarmer(app);

      const res = await authed(app, otherToken)
        .post("/api/lots")
        .send({ farmId, cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });

      expect(res.status).toEqual(403);
    });

    it("404s when the farmId does not exist at all", async () => {
      const { app } = buildTestApp();
      const { token } = await registerAndLoginFarmer(app);

      const res = await authed(app, token)
        .post("/api/lots")
        .send({
          farmId: "00000000-0000-0000-0000-000000000000",
          cropId: ONION_CROP_ID,
          quantity: 10,
          unit: "QTL",
          availabilityDate: AVAILABILITY_DATE,
        });

      expect(res.status).toEqual(404);
    });

    it("400s for an unknown or inactive crop id", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      const unknown = await authed(app, token)
        .post("/api/lots")
        .send({
          farmId,
          cropId: "00000000-0000-0000-0000-000000000000",
          quantity: 10,
          unit: "QTL",
          availabilityDate: AVAILABILITY_DATE,
        });
      expect(unknown.status).toEqual(400);

      const inactive = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: INACTIVE_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      expect(inactive.status).toEqual(400);
    });

    it("400s when the crop is not associated with the selected farm", async () => {
      const { app } = buildTestApp();
      // setupFarmerWithCrop only associates ONION_CROP_ID when passed —
      // here we deliberately don't associate SOYBEAN_CROP_ID with the farm.
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      const res = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: SOYBEAN_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });

      expect(res.status).toEqual(400);
      expect(res.body.error.fields?.cropId).toBeTruthy();
    });
  });

  describe("quantity validation (build spec section 83)", () => {
    it("rejects negative, zero and non-finite quantities", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      for (const quantity of [-5, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
        const res = await authed(app, token)
          .post("/api/lots")
          .send({ farmId, cropId: ONION_CROP_ID, quantity, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
        expect(res.status).toEqual(400);
      }
    });

    it("converts units to KG correctly (build spec section 83)", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      const tonneRes = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: ONION_CROP_ID, quantity: 1, unit: "TONNE", availabilityDate: AVAILABILITY_DATE });
      expect(tonneRes.body.data.lot.quantity.quantityKg).toEqual(1000);

      const kgRes = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: ONION_CROP_ID, quantity: 500, unit: "KG", availabilityDate: AVAILABILITY_DATE });
      expect(kgRes.body.data.lot.quantity.quantityKg).toEqual(500);
      // Round-trip: 500 KG displayed back in QTL should read 5.
      const asQtl = await authed(app, token).get(`/api/lots/${kgRes.body.data.lot.publicId}?unit=QTL`);
      expect(asQtl.body.data.lot.quantity).toEqual({ value: 5, unit: "QTL", quantityKg: 500 });
    });
  });

  describe("state transitions (build spec section 82)", () => {
    async function createDraftLot(app: import("express").Express, token: string, farmId: string) {
      const res = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      return res.body.data.lot as { publicId: string };
    }

    it("allows DRAFT -> AVAILABLE and AVAILABLE -> CANCELLED", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createDraftLot(app, token, farmId);

      const published = await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();
      expect(published.status).toEqual(200);

      const cancelled = await authed(app, token).post(`/api/lots/${lot.publicId}/cancel`).send();
      expect(cancelled.status).toEqual(200);
    });

    it("rejects publishing a lot that is not DRAFT and rejects double-cancel", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createDraftLot(app, token, farmId);

      await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();
      // AVAILABLE -> publish again should fail.
      const republish = await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();
      expect(republish.status).toEqual(409);

      await authed(app, token).post(`/api/lots/${lot.publicId}/cancel`).send();
      // CANCELLED -> cancel again should fail (build spec: CANCELLED -> AVAILABLE etc. all illegal).
      const recancel = await authed(app, token).post(`/api/lots/${lot.publicId}/cancel`).send();
      expect(recancel.status).toEqual(409);
    });

    it("only allows deleting or updating a lot while it is still DRAFT", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createDraftLot(app, token, farmId);

      await authed(app, token).post(`/api/lots/${lot.publicId}/publish`).send();

      const updateRes = await authed(app, token).patch(`/api/lots/${lot.publicId}`).send({ variety: "Hybrid" });
      expect(updateRes.status).toEqual(409);

      const deleteRes = await authed(app, token).delete(`/api/lots/${lot.publicId}`);
      expect(deleteRes.status).toEqual(409);
    });

    it("allows editing and deleting a lot that is still DRAFT", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const lot = await createDraftLot(app, token, farmId);

      const updateRes = await authed(app, token)
        .patch(`/api/lots/${lot.publicId}`)
        .send({ quantity: 20, unit: "QTL", variety: "Hybrid" });
      expect(updateRes.status).toEqual(200);
      expect(updateRes.body.data.lot.quantity).toEqual({ value: 20, unit: "QTL", quantityKg: 2000 });
      expect(updateRes.body.data.lot.availableQuantity).toEqual({ value: 20, unit: "QTL" });
      expect(updateRes.body.data.lot.variety).toEqual("Hybrid");

      const deleteRes = await authed(app, token).delete(`/api/lots/${lot.publicId}`);
      expect(deleteRes.status).toEqual(200);

      const getRes = await authed(app, token).get(`/api/lots/${lot.publicId}`);
      expect(getRes.status).toEqual(404);
    });
  });

  describe("security (build spec section 81)", () => {
    it("a farmer cannot see or modify another farmer's lot", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });
      const createRes = await authed(app, token)
        .post("/api/lots")
        .send({ farmId, cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      const lot = createRes.body.data.lot;

      const { token: otherToken } = await registerAndLoginFarmer(app);

      const getRes = await authed(app, otherToken).get(`/api/lots/${lot.publicId}`);
      expect(getRes.status).toEqual(404);

      const patchRes = await authed(app, otherToken).patch(`/api/lots/${lot.publicId}`).send({ variety: "Hijacked" });
      expect(patchRes.status).toEqual(404);

      const publishRes = await authed(app, otherToken).post(`/api/lots/${lot.publicId}/publish`).send();
      expect(publishRes.status).toEqual(404);

      const listRes = await authed(app, otherToken).get("/api/lots");
      expect(listRes.body.data.total).toEqual(0);
    });

    it("a farmer cannot create a lot for another farmer's crop/farm pairing by guessing ids", async () => {
      const { app } = buildTestApp();
      const { token } = await registerAndLoginFarmer(app);

      const res = await authed(app, token)
        .post("/api/lots")
        .send({
          farmId: "11111111-1111-1111-1111-111111111199",
          cropId: ONION_CROP_ID,
          quantity: 10,
          unit: "QTL",
          availabilityDate: AVAILABILITY_DATE,
        });
      expect(res.status).toEqual(404);
    });
  });

  describe("FPO-owned lots (build spec section 14/23/50)", () => {
    it("lets an FPO admin create and list a lot for their own FPO", async () => {
      const { app, authRepository } = buildTestApp();
      const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

      const createRes = await authed(app, adminToken)
        .post("/api/lots")
        .send({ fpoId, cropId: ONION_CROP_ID, quantity: 200, unit: "QTL", availabilityDate: AVAILABILITY_DATE });

      expect(createRes.status).toEqual(201);
      expect(createRes.body.data.lot.ownerType).toEqual("FPO");
      expect(createRes.body.data.lot.sourceType).toEqual("FPO_AGGREGATED");
      expect(createRes.body.data.lot.fpo.publicId).toEqual(fpoId);
      expect(createRes.body.data.lot.farm).toBeNull();

      const listRes = await authed(app, adminToken).get(`/api/fpos/${fpoId}/lots`);
      expect(listRes.status).toEqual(200);
      expect(listRes.body.data.total).toEqual(1);
    });

    it("403s an FPO admin trying to create a lot for an FPO they don't administer", async () => {
      const { app, authRepository } = buildTestApp();
      const { fpoId } = await createFpoAsAdmin(app, authRepository);
      const { token: otherAdminToken } = await createFpoAsAdmin(app, authRepository, { name: "Other FPO" });

      const res = await authed(app, otherAdminToken)
        .post("/api/lots")
        .send({ fpoId, cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });

      expect(res.status).toEqual(403);
    });

    it("403s an FPO admin listing a different FPO's lots", async () => {
      const { app, authRepository } = buildTestApp();
      const { fpoId } = await createFpoAsAdmin(app, authRepository);
      const { token: otherAdminToken } = await createFpoAsAdmin(app, authRepository, { name: "Other FPO" });

      const res = await authed(app, otherAdminToken).get(`/api/fpos/${fpoId}/lots`);
      expect(res.status).toEqual(403);
    });

    it("rejects a farmer trying to create an FPO-owned lot", async () => {
      const { app, authRepository } = buildTestApp();
      const { fpoId } = await createFpoAsAdmin(app, authRepository);
      const { token: farmerToken } = await registerAndLoginFarmer(app);

      const res = await authed(app, farmerToken)
        .post("/api/lots")
        .send({ fpoId, cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });

      expect(res.status).toEqual(403);
    });
  });

  describe("request shape validation", () => {
    it("rejects a create request with neither farmId nor fpoId, and with both", async () => {
      const { app } = buildTestApp();
      const { token } = await registerAndLoginFarmer(app);

      const neither = await authed(app, token)
        .post("/api/lots")
        .send({ cropId: ONION_CROP_ID, quantity: 10, unit: "QTL", availabilityDate: AVAILABILITY_DATE });
      expect(neither.status).toEqual(400);

      const both = await authed(app, token)
        .post("/api/lots")
        .send({
          farmId: "11111111-1111-1111-1111-111111111199",
          fpoId: "11111111-1111-1111-1111-111111111198",
          cropId: ONION_CROP_ID,
          quantity: 10,
          unit: "QTL",
          availabilityDate: AVAILABILITY_DATE,
        });
      expect(both.status).toEqual(400);
    });

    it("rejects a harvest date after the availability date", async () => {
      const { app } = buildTestApp();
      const { token, farmId } = await setupFarmerWithCrop(app, { cropId: ONION_CROP_ID });

      const res = await authed(app, token)
        .post("/api/lots")
        .send({
          farmId,
          cropId: ONION_CROP_ID,
          quantity: 10,
          unit: "QTL",
          harvestDate: "2026-09-20",
          availabilityDate: AVAILABILITY_DATE, // 2026-09-15, before the harvest date
        });
      expect(res.status).toEqual(400);
    });

    it("requires authentication", async () => {
      const { app } = buildTestApp();
      const res = await request(app).get("/api/lots");
      expect(res.status).toEqual(401);
    });
  });
});
