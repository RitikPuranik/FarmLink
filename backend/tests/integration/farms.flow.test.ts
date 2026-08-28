import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import {
  HAVELI_TALUKA_ID,
  MAHARASHTRA_STATE_ID,
  NASHIK_DISTRICT_ID,
  NIPHAD_TALUKA_ID,
} from "../testUtils/referenceDataFixtures";

const VALID_FARM = {
  name: "Main Farm",
  village: "Pimpalgaon",
  pincode: "422209",
  stateId: MAHARASHTRA_STATE_ID,
  districtId: NASHIK_DISTRICT_ID,
  talukaId: NIPHAD_TALUKA_ID,
  area: 4.5,
  areaUnit: "ACRE",
  irrigationType: "DRIP",
};

async function createFarm(app: import("express").Express, token: string, overrides = {}) {
  return request(app)
    .post("/api/farms")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...VALID_FARM, ...overrides });
}

describe("Farms", () => {
  it("creates a farm with a valid structured location", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await createFarm(app, token);

    expect(res.status).toEqual(201);
    expect(res.body.data.farm.village).toEqual("Pimpalgaon");
    expect(res.body.data.farm.state.name).toEqual("Maharashtra");
    expect(res.body.data.farm.district.name).toEqual("Nashik");
    expect(res.body.data.farm.taluka.name).toEqual("Niphad");
    expect(res.body.data.farm.area).toEqual(4.5);
  });

  it("a farmer can have more than one farm", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    await createFarm(app, token, { name: "Farm A" });
    await createFarm(app, token, { name: "Farm B" });

    const res = await request(app).get("/api/farms").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.farms).toHaveLength(2);
  });

  it.each([
    ["negative area", { area: -1 }],
    ["zero area", { area: 0 }],
    ["non-numeric area", { area: "lots" }],
    ["absurdly large area", { area: 999_999_999 }],
  ])("rejects %s", async (_label, overrides) => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await createFarm(app, token, overrides);
    expect(res.status).toEqual(400);
  });

  it("rejects an inconsistent state/district/taluka chain (taluka from a different district)", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    // Haveli belongs to Pune, not Nashik — same state, wrong district.
    const res = await createFarm(app, token, { talukaId: HAVELI_TALUKA_ID });
    expect(res.status).toEqual(400);
  });

  it("rejects an unknown irrigation type instead of accepting free text", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await createFarm(app, token, { irrigationType: "SOLAR_POWERED_MAGIC" });
    expect(res.status).toEqual(400);
  });

  it("defaults irrigationType to NOT_SPECIFIED when omitted", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);
    const { irrigationType, ...withoutIrrigation } = VALID_FARM;
    void irrigationType;

    const res = await request(app)
      .post("/api/farms")
      .set("Authorization", `Bearer ${token}`)
      .send(withoutIrrigation);

    expect(res.status).toEqual(201);
    expect(res.body.data.farm.irrigationType).toEqual("NOT_SPECIFIED");
  });

  it("PATCHes a farm the farmer owns", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);
    const created = await createFarm(app, token);

    const res = await request(app)
      .patch(`/api/farms/${created.body.data.farm.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ area: 5, irrigationType: "CANAL" });

    expect(res.status).toEqual(200);
    expect(res.body.data.farm.area).toEqual(5);
    expect(res.body.data.farm.irrigationType).toEqual("CANAL");
  });

  it("DELETEs a farm the farmer owns", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);
    const created = await createFarm(app, token);

    const del = await request(app)
      .delete(`/api/farms/${created.body.data.farm.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toEqual(200);

    const list = await request(app).get("/api/farms").set("Authorization", `Bearer ${token}`);
    expect(list.body.data.farms).toEqual([]);
  });

  it("404s on a malformed (non-uuid) farm id instead of a raw database error", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/farms/not-a-uuid").set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(400);
    expect(res.status).not.toEqual(500);
  });

  describe("ownership: Farmer A cannot touch Farmer B's farm", () => {
    it("GET returns 404, not another farmer's data", async () => {
      const { app } = buildTestApp();
      const farmerA = await registerAndLoginFarmer(app);
      const farmerB = await registerAndLoginFarmer(app);
      const farm = await createFarm(app, farmerA.token);

      const res = await request(app)
        .get(`/api/farms/${farm.body.data.farm.id}`)
        .set("Authorization", `Bearer ${farmerB.token}`);
      expect(res.status).toEqual(404);
    });

    it("PATCH returns 404 and does not modify Farmer A's farm", async () => {
      const { app } = buildTestApp();
      const farmerA = await registerAndLoginFarmer(app);
      const farmerB = await registerAndLoginFarmer(app);
      const farm = await createFarm(app, farmerA.token);

      const res = await request(app)
        .patch(`/api/farms/${farm.body.data.farm.id}`)
        .set("Authorization", `Bearer ${farmerB.token}`)
        .send({ area: 999 });
      expect(res.status).toEqual(404);

      const check = await request(app)
        .get(`/api/farms/${farm.body.data.farm.id}`)
        .set("Authorization", `Bearer ${farmerA.token}`);
      expect(check.body.data.farm.area).toEqual(4.5);
    });

    it("DELETE returns 404 and does not remove Farmer A's farm", async () => {
      const { app } = buildTestApp();
      const farmerA = await registerAndLoginFarmer(app);
      const farmerB = await registerAndLoginFarmer(app);
      const farm = await createFarm(app, farmerA.token);

      const res = await request(app)
        .delete(`/api/farms/${farm.body.data.farm.id}`)
        .set("Authorization", `Bearer ${farmerB.token}`);
      expect(res.status).toEqual(404);

      const list = await request(app).get("/api/farms").set("Authorization", `Bearer ${farmerA.token}`);
      expect(list.body.data.farms).toHaveLength(1);
    });
  });

  it("never trusts a client-supplied farmerId in the body for authorization", async () => {
    const { app, authRepository } = buildTestApp();
    const farmerA = await registerAndLoginFarmer(app);
    const farmerB = await registerAndLoginFarmer(app);
    const farmerBUser = authRepository.users.find((u) => u.mobile === farmerB.mobile)!;

    const res = await request(app)
      .post("/api/farms")
      .set("Authorization", `Bearer ${farmerA.token}`)
      .send({ ...VALID_FARM, farmerId: farmerBUser.id, userId: farmerBUser.id });

    // Either the farm is created (ignoring the smuggled id, owned by A) or
    // the strict schema rejects the unknown field outright — either way it
    // must never end up attributed to Farmer B.
    if (res.status === 201) {
      const list = await request(app).get("/api/farms").set("Authorization", `Bearer ${farmerB.token}`);
      expect(list.body.data.farms).toEqual([]);
    } else {
      expect(res.status).toEqual(400);
    }
  });
});
