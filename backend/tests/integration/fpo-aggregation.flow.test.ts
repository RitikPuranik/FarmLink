import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, createFpoWithActiveMember, seedAndLoginGovernmentViewer } from "../testUtils/fpoTestHelpers";
import { ONION_CROP_ID, SOYBEAN_CROP_ID } from "../testUtils/referenceDataFixtures";

const VALID_FARM = {
  name: "Main Farm",
  village: "Pimpalgaon",
  stateId: "11111111-1111-1111-1111-111111111111",
  districtId: "22222222-2222-2222-2222-222222222221",
  talukaId: "33333333-3333-3333-3333-333333333331",
  area: 100,
  areaUnit: "ACRE",
};

/** Joins a fresh farmer to fpoId as an ACTIVE member with one crop row. */
async function addActiveMemberWithCrop(
  app: Express,
  adminToken: string,
  fpoId: string,
  crop: { cropId: string; area: number; areaUnit?: string; typicalYield?: number; yieldUnit?: string },
) {
  const { token } = await registerAndLoginFarmer(app);
  const farmRes = await request(app).post("/api/farms").set("Authorization", `Bearer ${token}`).send(VALID_FARM);
  const farmId = farmRes.body.data.farm.id as string;

  await request(app)
    .post("/api/farmers/me/crops")
    .set("Authorization", `Bearer ${token}`)
    .send({
      farmId,
      cropId: crop.cropId,
      area: crop.area,
      areaUnit: crop.areaUnit ?? "ACRE",
      typicalYield: crop.typicalYield,
      yieldUnit: crop.yieldUnit,
    });

  const reqRes = await request(app)
    .post(`/api/fpos/${fpoId}/membership-requests`)
    .set("Authorization", `Bearer ${token}`)
    .send();
  const membershipId = reqRes.body.data.membership.publicId;
  await request(app)
    .post(`/api/fpo-memberships/${membershipId}/approve`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send();

  return { token };
}

describe("FPO crop aggregation", () => {
  it("matches the worked example: 3 farmers growing onion sum to the right total (build spec demo data)", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

    // 20 + 30 + 50 = 100 QTL estimated, 3 farmers (build spec section 89).
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 2, typicalYield: 10, yieldUnit: "QTL/ACRE" });
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 3, typicalYield: 10, yieldUnit: "QTL/ACRE" });
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 5, typicalYield: 10, yieldUnit: "QTL/ACRE" });

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toEqual(200);
    const onionRow = res.body.data.find((r: { cropId: string }) => r.cropId === ONION_CROP_ID);
    expect(onionRow.farmerCount).toEqual(3);
    expect(onionRow.estimatedQuantity).toEqual(100);
    expect(onionRow.quantityUnit).toEqual("QTL");
    expect(onionRow.totalArea).toEqual(10);
    expect(onionRow.calculatedAt).toBeTruthy();
  });

  it("never invents a quantity for missing yield data, but still counts the farmer", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: SOYBEAN_CROP_ID, area: 4 }); // no yield data at all

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: { cropId: string }) => r.cropId === SOYBEAN_CROP_ID);
    expect(row.farmerCount).toEqual(1);
    expect(row.estimatedQuantity).toBeNull();
    expect(row.estimateCoverage).toEqual({ farmersWithEstimate: 0, totalFarmers: 1 });
  });

  it("partial coverage: sums only farmers with usable yield data and reports coverage honestly", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: SOYBEAN_CROP_ID, area: 2, typicalYield: 5, yieldUnit: "QTL/ACRE" });
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: SOYBEAN_CROP_ID, area: 3 }); // missing yield

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: { cropId: string }) => r.cropId === SOYBEAN_CROP_ID);
    expect(row.farmerCount).toEqual(2);
    expect(row.estimatedQuantity).toEqual(10); // only the 2-acre/5-QTL-per-acre farmer counted
    expect(row.estimateCoverage).toEqual({ farmersWithEstimate: 1, totalFarmers: 2 });
  });

  it("normalizes mixed yield units (KG, QTL, TONNE) into one consistent QTL total", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

    // 1 TONNE/ACRE * 1 acre = 1000 KG = 10 QTL
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: SOYBEAN_CROP_ID, area: 1, typicalYield: 1, yieldUnit: "TONNE/ACRE" });
    // 2 QTL/ACRE * 5 acres = 10 QTL
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: SOYBEAN_CROP_ID, area: 5, typicalYield: 2, yieldUnit: "QTL/ACRE" });

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: { cropId: string }) => r.cropId === SOYBEAN_CROP_ID);
    // Naively summing the raw numbers (1 + 2 = 3) would be wrong — this
    // proves real unit conversion happened, not string/number concatenation.
    expect(row.estimatedQuantity).toEqual(20);
  });

  it("an unrecognized yield unit is treated exactly like missing yield data (never guessed)", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);

    await addActiveMemberWithCrop(app, adminToken, fpoId, {
      cropId: SOYBEAN_CROP_ID,
      area: 4,
      typicalYield: 25,
      yieldUnit: "bags per season", // not a recognized unit
    });

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: { cropId: string }) => r.cropId === SOYBEAN_CROP_ID);
    expect(row.estimatedQuantity).toBeNull();
  });

  it("only FPO_ADMIN(own)/ADMIN/GOVERNMENT_VIEWER may view crop-aggregation, not an unrelated farmer", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoWithActiveMember(app, authRepository);
    const { token: strangerToken } = await registerAndLoginFarmer(app);

    const res = await request(app).get(`/api/fpos/${fpoId}/crop-aggregation`).set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toEqual(403);
  });

  it("per-farmer breakdown for one crop is admin-only and lists each contributing farmer", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 2, typicalYield: 10, yieldUnit: "QTL/ACRE" });

    const res = await request(app)
      .get(`/api/fpos/${fpoId}/crop-aggregation/${ONION_CROP_ID}/members`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.length).toEqual(1);
    expect(res.body.data[0].estimatedQuantity).toEqual(20);
    expect(res.body.data[0].farmerPublicId).toBeTruthy();
  });
});

describe("FPO aggregation targets", () => {
  it("creates a target and computes gapQuantity against the live estimate", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 2, typicalYield: 10, yieldUnit: "QTL/ACRE" }); // 20 QTL

    const createRes = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cropId: ONION_CROP_ID, targetQuantity: 100, unit: "QTL" });

    expect(createRes.status).toEqual(201);
    const group = createRes.body.data.aggregationGroup;
    expect(group.status).toEqual("OPEN");
    expect(group.estimatedQuantity).toEqual(20);
    expect(group.gapQuantity).toEqual(80);
    expect(group.targetQuantity).toEqual(100);
  });

  it("cannot create a target for an unknown/inactive crop", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const res = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cropId: "00000000-0000-0000-0000-000000000000", targetQuantity: 10, unit: "QTL" });
    expect(res.status).toEqual(400);
  });

  it("update accepts targetQuantity/targetDate/status but rejects changing cropId", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const createRes = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cropId: ONION_CROP_ID, targetQuantity: 100, unit: "QTL" });
    const aggregationId = createRes.body.data.aggregationGroup.publicId;

    const updateRes = await request(app)
      .patch(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ targetQuantity: 150 });
    expect(updateRes.status).toEqual(200);
    expect(updateRes.body.data.aggregationGroup.targetQuantity).toEqual(150);

    const rejectedRes = await request(app)
      .patch(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cropId: SOYBEAN_CROP_ID });
    expect(rejectedRes.status).toEqual(400); // strict schema rejects the unknown field
  });

  it("cancel moves OPEN -> CANCELLED and never deletes the row, and can't be cancelled twice", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    const createRes = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cropId: ONION_CROP_ID, targetQuantity: 100, unit: "QTL" });
    const aggregationId = createRes.body.data.aggregationGroup.publicId;

    const cancelRes = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(cancelRes.status).toEqual(200);
    expect(cancelRes.body.data.aggregationGroup.status).toEqual("CANCELLED");

    const secondCancel = await request(app)
      .post(`/api/fpos/${fpoId}/aggregation-groups/${aggregationId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send();
    expect(secondCancel.status).toEqual(409);

    const list = await request(app)
      .get(`/api/fpos/${fpoId}/aggregation-groups`)
      .query({ status: "CANCELLED" })
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.length).toEqual(1);
  });
});

describe("FPO analytics overview", () => {
  it("summarizes member counts, pending requests, and top crops", async () => {
    const { app, authRepository } = buildTestApp();
    const { token: adminToken, fpoId } = await createFpoAsAdmin(app, authRepository);
    await addActiveMemberWithCrop(app, adminToken, fpoId, { cropId: ONION_CROP_ID, area: 2, typicalYield: 10, yieldUnit: "QTL/ACRE" });

    // One more farmer who only requests (stays PENDING).
    const { token: pendingFarmerToken } = await registerAndLoginFarmer(app);
    await request(app).post(`/api/fpos/${fpoId}/membership-requests`).set("Authorization", `Bearer ${pendingFarmerToken}`).send();

    const res = await request(app).get(`/api/fpos/${fpoId}/analytics/overview`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.activeMemberCount).toEqual(1);
    expect(res.body.data.pendingMemberships).toEqual(1);
    expect(res.body.data.estimatedTotalSupply.value).toEqual(20);
    expect(res.body.data.estimatedTotalSupply.unit).toEqual("QTL");
    expect(res.body.data.topCrops[0].crop).toEqual("Onion");
  });

  it("a GOVERNMENT_VIEWER cannot see the private analytics overview", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoWithActiveMember(app, authRepository);
    const { token: govToken } = await seedAndLoginGovernmentViewer(app, authRepository);

    const res = await request(app).get(`/api/fpos/${fpoId}/analytics/overview`).set("Authorization", `Bearer ${govToken}`);
    expect(res.status).toEqual(403);
  });
});
