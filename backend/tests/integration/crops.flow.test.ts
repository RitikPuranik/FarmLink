import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import {
  COTTON_CROP_ID,
  INACTIVE_CROP_ID,
  MAHARASHTRA_STATE_ID,
  NASHIK_DISTRICT_ID,
  NIPHAD_TALUKA_ID,
  ONION_CROP_ID,
  SOYBEAN_CROP_ID,
} from "../testUtils/referenceDataFixtures";

const VALID_FARM = {
  name: "Main Farm",
  village: "Pimpalgaon",
  stateId: MAHARASHTRA_STATE_ID,
  districtId: NASHIK_DISTRICT_ID,
  talukaId: NIPHAD_TALUKA_ID,
  area: 4.5,
  areaUnit: "ACRE",
};

async function setupFarmerWithFarm(app: import("express").Express) {
  const { token } = await registerAndLoginFarmer(app);
  const farm = await request(app).post("/api/farms").set("Authorization", `Bearer ${token}`).send(VALID_FARM);
  return { token, farmId: farm.body.data.farm.id as string };
}

describe("Farmer crops", () => {
  it("adds a crop to an owned farm", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const res = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE" });

    expect(res.status).toEqual(201);
    expect(res.body.data.crop.crop.name).toEqual("Onion");
    expect(res.body.data.crop.crop.translations.hi).toBeTruthy();
    expect(res.body.data.crop.isPrimary).toBe(false);
  });

  it("rejects an unknown/inactive crop id", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const unknown = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: "00000000-0000-0000-0000-000000000000", area: 1, areaUnit: "ACRE" });
    expect(unknown.status).toEqual(400);

    const inactive = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: INACTIVE_CROP_ID, area: 1, areaUnit: "ACRE" });
    expect(inactive.status).toEqual(400);
  });

  it("403s when adding a crop to a farm owned by a different farmer", async () => {
    const { app } = buildTestApp();
    const { farmId } = await setupFarmerWithFarm(app);
    const { token: otherToken } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 1, areaUnit: "ACRE" });

    expect(res.status).toEqual(403);
  });

  it("404s when the farmId does not exist at all", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId: "00000000-0000-0000-0000-000000000000", cropId: ONION_CROP_ID, area: 1, areaUnit: "ACRE" });

    expect(res.status).toEqual(404);
  });

  it("409s on adding the same crop to the same farm twice", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE" });

    const dup = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 1, areaUnit: "ACRE" });

    expect(dup.status).toEqual(409);
  });

  it("setting a crop as primary atomically unsets the previous primary — a farm never has two primaries", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const onion = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE", isPrimary: true });
    expect(onion.body.data.crop.isPrimary).toBe(true);

    const soybean = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: SOYBEAN_CROP_ID, area: 1.5, areaUnit: "ACRE", isPrimary: true });
    expect(soybean.body.data.crop.isPrimary).toBe(true);

    const list = await request(app).get("/api/farmers/me/crops").set("Authorization", `Bearer ${token}`);
    const primaries = list.body.data.crops.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].crop.name).toEqual("Soybean");
  });

  it("PATCH isPrimary=true on an existing crop also enforces single-primary-per-farm", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const onion = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE", isPrimary: true });
    const cotton = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: COTTON_CROP_ID, area: 3, areaUnit: "ACRE" });

    const patch = await request(app)
      .patch(`/api/farmers/me/crops/${cotton.body.data.crop.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isPrimary: true });
    expect(patch.status).toEqual(200);
    expect(patch.body.data.crop.isPrimary).toBe(true);

    const list = await request(app).get("/api/farmers/me/crops").set("Authorization", `Bearer ${token}`);
    const primaries = list.body.data.crops.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toEqual(cotton.body.data.crop.id);
    void onion;
  });

  it("removes a crop", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const added = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE" });

    const del = await request(app)
      .delete(`/api/farmers/me/crops/${added.body.data.crop.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toEqual(200);

    const list = await request(app).get("/api/farmers/me/crops").set("Authorization", `Bearer ${token}`);
    expect(list.body.data.crops).toEqual([]);
  });

  describe("ownership: Farmer A cannot touch Farmer B's crop records", () => {
    it("PATCH returns 404", async () => {
      const { app } = buildTestApp();
      const farmerA = await setupFarmerWithFarm(app);
      const farmerB = await registerAndLoginFarmer(app);
      const added = await request(app)
        .post("/api/farmers/me/crops")
        .set("Authorization", `Bearer ${farmerA.token}`)
        .send({ farmId: farmerA.farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE" });

      const res = await request(app)
        .patch(`/api/farmers/me/crops/${added.body.data.crop.id}`)
        .set("Authorization", `Bearer ${farmerB.token}`)
        .send({ area: 10 });
      expect(res.status).toEqual(404);
    });

    it("DELETE returns 404", async () => {
      const { app } = buildTestApp();
      const farmerA = await setupFarmerWithFarm(app);
      const farmerB = await registerAndLoginFarmer(app);
      const added = await request(app)
        .post("/api/farmers/me/crops")
        .set("Authorization", `Bearer ${farmerA.token}`)
        .send({ farmId: farmerA.farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE" });

      const res = await request(app)
        .delete(`/api/farmers/me/crops/${added.body.data.crop.id}`)
        .set("Authorization", `Bearer ${farmerB.token}`);
      expect(res.status).toEqual(404);
    });
  });

  it("rejects a negative or zero typical yield", async () => {
    const { app } = buildTestApp();
    const { token, farmId } = await setupFarmerWithFarm(app);

    const res = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 2, areaUnit: "ACRE", typicalYield: -5 });

    expect(res.status).toEqual(400);
  });
});
