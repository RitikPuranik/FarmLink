import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { DEMO_FPO_ID, MAHARASHTRA_STATE_ID, NASHIK_DISTRICT_ID, NIPHAD_TALUKA_ID, ONION_CROP_ID, SOYBEAN_CROP_ID } from "../testUtils/referenceDataFixtures";

/**
 * Mirrors build spec section 70 end-to-end, entirely through the HTTP API
 * (register -> login -> open dashboard aggregate -> select location ->
 * create farm -> select irrigation -> add crops -> make one primary ->
 * select FPO -> set liquidity/storage preferences -> profile reaches
 * 100% -> dashboard aggregate reflects everything) — without touching the
 * database directly, exactly as section 70 requires.
 */
describe("E2E acceptance flow (build spec section 70)", () => {
  it("completes the full farmer onboarding flow and reaches 100% profile completion", async () => {
    const { app } = buildTestApp();

    // REGISTER FARMER -> LOGIN
    const { token } = await registerAndLoginFarmer(app, { fullName: "Ramesh Patil" });

    // OPEN DASHBOARD (aggregate view right after registration)
    const initial = await request(app).get("/api/farmers/me").set("Authorization", `Bearer ${token}`);
    expect(initial.status).toEqual(200);
    expect(initial.body.data.completion.percentage).toEqual(20);

    // SELECT Maharashtra -> Nashik -> Niphad -> Demo village, CREATE FARM,
    // SELECT IRRIGATION (Drip)
    const farmRes = await request(app)
      .post("/api/farms")
      .set("Authorization", `Bearer ${token}`)
      .send({
        village: "Demo village",
        stateId: MAHARASHTRA_STATE_ID,
        districtId: NASHIK_DISTRICT_ID,
        talukaId: NIPHAD_TALUKA_ID,
        area: 4.5,
        areaUnit: "ACRE",
        irrigationType: "DRIP",
      });
    expect(farmRes.status).toEqual(201);
    const farmId = farmRes.body.data.farm.id;

    // ADD CROPS: Onion, Soybean
    const onionRes = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: ONION_CROP_ID, area: 3, areaUnit: "ACRE" });
    expect(onionRes.status).toEqual(201);

    const soybeanRes = await request(app)
      .post("/api/farmers/me/crops")
      .set("Authorization", `Bearer ${token}`)
      .send({ farmId, cropId: SOYBEAN_CROP_ID, area: 1.5, areaUnit: "ACRE" });
    expect(soybeanRes.status).toEqual(201);

    // MAKE ONION PRIMARY
    const primaryRes = await request(app)
      .patch(`/api/farmers/me/crops/${onionRes.body.data.crop.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isPrimary: true });
    expect(primaryRes.status).toEqual(200);
    expect(primaryRes.body.data.crop.isPrimary).toBe(true);

    // SELECT FPO, SET liquidity = "Can wait up to 2 weeks", willing to
    // store = YES
    const preferencesRes = await request(app)
      .patch("/api/farmers/me/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        fpoMembershipStatus: "MEMBER",
        fpoId: DEMO_FPO_ID,
        liquidityPreference: "CAN_WAIT_2_WEEKS",
        willingToStore: true,
      });
    expect(preferencesRes.status).toEqual(200);

    // PROFILE = 100%
    expect(preferencesRes.body.data.completion.percentage).toEqual(100);
    expect(preferencesRes.body.data.completion.missing).toEqual([]);

    // RETURN TO DASHBOARD — profile information is visible
    const dashboard = await request(app).get("/api/farmers/me").set("Authorization", `Bearer ${token}`);
    expect(dashboard.status).toEqual(200);
    expect(dashboard.body.data.completion.percentage).toEqual(100);
    expect(dashboard.body.data.farms).toHaveLength(1);
    expect(dashboard.body.data.farms[0].district.name).toEqual("Nashik");
    expect(dashboard.body.data.crops).toHaveLength(2);
    expect(dashboard.body.data.crops.find((c: { isPrimary: boolean }) => c.isPrimary)?.crop.name).toEqual("Onion");
    expect(dashboard.body.data.profile.fpo.name).toEqual("Nashik Farmers Producer Organization");
    expect(dashboard.body.data.profile.liquidityPreference).toEqual("CAN_WAIT_2_WEEKS");
    expect(dashboard.body.data.profile.willingToStore).toBe(true);
  });
});
