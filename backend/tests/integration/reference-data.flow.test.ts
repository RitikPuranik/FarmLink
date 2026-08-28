import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import {
  DINDORI_TALUKA_ID,
  HAVELI_TALUKA_ID,
  MAHARASHTRA_STATE_ID,
  NASHIK_DISTRICT_ID,
  NIPHAD_TALUKA_ID,
  PUNE_DISTRICT_ID,
} from "../testUtils/referenceDataFixtures";

describe("Reference data endpoints", () => {
  it("requires authentication", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/reference/states");
    expect(res.status).toEqual(401);
  });

  it("lists languages and irrigation types without any DB dependency", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const languages = await request(app).get("/api/reference/languages").set("Authorization", `Bearer ${token}`);
    expect(languages.status).toEqual(200);
    expect(languages.body.data.languages.map((l: { code: string }) => l.code)).toEqual(
      expect.arrayContaining(["en", "hi", "mr"]),
    );

    const irrigation = await request(app)
      .get("/api/reference/irrigation-types")
      .set("Authorization", `Bearer ${token}`);
    expect(irrigation.status).toEqual(200);
    expect(irrigation.body.data.irrigationTypes.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(["RAINFED", "DRIP", "NOT_SPECIFIED"]),
    );
  });

  it("lists Maharashtra as a seeded state", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/reference/states").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.states).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: MAHARASHTRA_STATE_ID, name: "Maharashtra" })]),
    );
  });

  it("cascades state -> district -> taluka correctly", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const districts = await request(app)
      .get(`/api/reference/districts?stateId=${MAHARASHTRA_STATE_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(districts.status).toEqual(200);
    expect(districts.body.data.districts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: NASHIK_DISTRICT_ID, name: "Nashik" })]),
    );

    const talukas = await request(app)
      .get(`/api/reference/talukas?districtId=${NASHIK_DISTRICT_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(talukas.status).toEqual(200);
    const talukaIds = talukas.body.data.talukas.map((t: { id: string }) => t.id);
    expect(talukaIds).toEqual(expect.arrayContaining([NIPHAD_TALUKA_ID, DINDORI_TALUKA_ID]));
    expect(talukaIds).not.toContain(HAVELI_TALUKA_ID); // Haveli belongs to Pune, not Nashik
  });

  it("400s on a missing required query param", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/reference/districts").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(400);
  });

  it("404s on an unknown state id", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .get("/api/reference/districts?stateId=00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(404);
  });

  it("lists the seeded crop catalog with Hindi/Marathi translations", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/reference/crops").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    const onion = res.body.data.crops.find((c: { name: string }) => c.name === "Onion");
    expect(onion).toBeDefined();
    expect(onion.translations.hi).toBeTruthy();
    expect(onion.translations.mr).toBeTruthy();
    // The fixture's inactive crop must never appear in the public catalog.
    expect(res.body.data.crops.some((c: { name: string }) => c.name === "Discontinued Crop")).toBe(false);
  });

  it("filters FPOs by district and excludes inactive ones", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .get(`/api/reference/fpos?districtId=${NASHIK_DISTRICT_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.fpos.length).toBeGreaterThan(0);
    expect(res.body.data.fpos.every((f: { name: string }) => f.name !== "Retired FPO")).toBe(true);

    const puneRes = await request(app)
      .get(`/api/reference/fpos?districtId=${PUNE_DISTRICT_ID}`)
      .set("Authorization", `Bearer ${token}`);
    expect(puneRes.status).toEqual(200);
    expect(puneRes.body.data.fpos).toEqual([]);
  });
});
