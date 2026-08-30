import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";
import { registerAndLoginFarmer } from "../testUtils/farmerAuthHelpers";
import { createFpoAsAdmin, seedAndLoginAdmin, seedAndLoginFpoAdmin, VALID_FPO_INPUT } from "../testUtils/fpoTestHelpers";
import { NASHIK_DISTRICT_ID, PUNE_DISTRICT_ID } from "../testUtils/referenceDataFixtures";

describe("FPO registration & directory", () => {
  it("lets an FPO_ADMIN register a new FPO and auto-assigns them as PRIMARY_ADMIN", async () => {
    const { app, authRepository } = buildTestApp();
    const { token, fpoId } = await createFpoAsAdmin(app, authRepository);
    expect(fpoId).toBeTruthy();

    // The creator can immediately manage it (proves the auto-admin
    // assignment happened) — e.g. see the private admin view.
    const details = await request(app).get(`/api/fpos/${fpoId}`).set("Authorization", `Bearer ${token}`);
    expect(details.status).toEqual(200);
    expect(details.body.data.fpo.accountStatus).toEqual("ACTIVE");
    expect(details.body.data.fpo.verificationStatus).toEqual("PENDING");
  });

  it("rejects FPO creation from a plain FARMER", async () => {
    const { app } = buildTestApp();
    const { token } = await registerAndLoginFarmer(app);
    const res = await request(app).post("/api/fpos").set("Authorization", `Bearer ${token}`).send(VALID_FPO_INPUT);
    expect(res.status).toEqual(403);
  });

  it("validates the state/district/taluka chain on creation", async () => {
    const { app, authRepository } = buildTestApp();
    const { token } = await seedAndLoginFpoAdmin(app, authRepository);
    const res = await request(app)
      .post("/api/fpos")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...VALID_FPO_INPUT, districtId: PUNE_DISTRICT_ID }); // taluka belongs to Nashik, not Pune
    expect(res.status).toEqual(400);
  });

  it("public search returns only public-safe fields and supports district filtering", async () => {
    const { app, authRepository } = buildTestApp();
    await createFpoAsAdmin(app, authRepository, { name: "Nashik Growers" });
    const { token: otherFarmerToken } = await registerAndLoginFarmer(app);

    const res = await request(app)
      .get("/api/fpos")
      .query({ district: "Nashik" })
      .set("Authorization", `Bearer ${otherFarmerToken}`);

    expect(res.status).toEqual(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20 });
    const fpo = res.body.data.items[0];
    expect(fpo.publicId).toBeTruthy();
    expect(fpo.memberCount).toEqual(0);
    // Public-safe: never the internal registration number or precise coords.
    expect(fpo.registrationNumber).toBeUndefined();
    expect(fpo.latitude).toBeUndefined();
  });

  it("search filters out FPOs from a different district", async () => {
    const { app, authRepository } = buildTestApp();
    await createFpoAsAdmin(app, authRepository, { districtId: NASHIK_DISTRICT_ID, talukaId: undefined });
    const { token } = await registerAndLoginFarmer(app);

    const res = await request(app).get("/api/fpos").query({ district: "Pune" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.items.length).toEqual(0);
  });

  it("enforces the pagination ceiling (limit <= 100)", async () => {
    const { app, authRepository } = buildTestApp();
    const { token } = await seedAndLoginAdmin(app, authRepository);
    const res = await request(app).get("/api/fpos").query({ limit: 500 }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(400);
  });

  it("a random authenticated user sees the public view, not the admin view, of someone else's FPO", async () => {
    const { app, authRepository } = buildTestApp();
    const { fpoId } = await createFpoAsAdmin(app, authRepository);
    const { token: strangerToken } = await registerAndLoginFarmer(app);

    const res = await request(app).get(`/api/fpos/${fpoId}`).set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toEqual(200);
    expect(res.body.data.fpo.accountStatus).toBeUndefined();
    expect(res.body.data.fpo.registrationNumber).toBeUndefined();
  });

  it("404s for an unknown FPO publicId", async () => {
    const { app, authRepository } = buildTestApp();
    const { token } = await seedAndLoginAdmin(app, authRepository);
    const res = await request(app)
      .get("/api/fpos/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toEqual(404);
  });
});
