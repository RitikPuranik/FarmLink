import request from "supertest";
import { buildTestApp } from "../testUtils/buildTestApp";

const VALID_REGISTRATION = {
  fullName: "Ramesh Patil",
  mobile: "9876543210",
  email: "ramesh@example.com",
  password: "SecurePassword123",
  preferredLanguage: "mr",
};

describe("POST /api/auth/register", () => {
  it("registers a farmer and never returns the password hash", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/register").send(VALID_REGISTRATION);

    expect(res.status).toEqual(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toEqual("FARMER");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(res.body.data.user).not.toHaveProperty("password");
  });

  it("rejects a duplicate mobile number with 409", async () => {
    const { app } = buildTestApp();
    await request(app).post("/api/auth/register").send(VALID_REGISTRATION);
    const res = await request(app).post("/api/auth/register").send(VALID_REGISTRATION);

    expect(res.status).toEqual(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toEqual("CONFLICT");
  });

  it("rejects malformed input with 400 and field-level errors", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...VALID_REGISTRATION, mobile: "123" });

    expect(res.status).toEqual(400);
    expect(res.body.error.code).toEqual("VALIDATION_ERROR");
    expect(res.body.error.fields).toHaveProperty("mobile");
  });

  it("SECURITY: rejects an attempt to register as ADMIN — client can never choose its own role", async () => {
    const { app, authRepository } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...VALID_REGISTRATION, role: "ADMIN" });

    expect(res.status).toEqual(400);
    expect(authRepository.users).toHaveLength(0);
  });

  it("SECURITY: rejects role=FARMER too — role is simply not an accepted field", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...VALID_REGISTRATION, role: "FARMER" });

    expect(res.status).toEqual(400);
  });
});

describe("POST /api/auth/login", () => {
  async function registerFarmer(app: import("express").Express) {
    return request(app).post("/api/auth/register").send(VALID_REGISTRATION);
  }

  it("logs in with correct credentials and sets a refresh cookie", async () => {
    const { app } = buildTestApp();
    await registerFarmer(app);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });

    expect(res.status).toEqual(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.headers["set-cookie"]?.[0]).toMatch(/farmlink_refresh=/);
    expect(res.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/);
  });

  it("SECURITY: rejects an unknown mobile number with a generic message", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/login")
      .send({ mobile: "9999999999", password: "Whatever123" });

    expect(res.status).toEqual(401);
    expect(res.body.error.message).toEqual("Invalid mobile number or password.");
  });

  it("SECURITY: rejects a wrong password with the same generic message as an unknown account", async () => {
    const { app } = buildTestApp();
    await registerFarmer(app);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: "WrongPassword1" });

    expect(res.status).toEqual(401);
    expect(res.body.error.message).toEqual("Invalid mobile number or password.");
  });

  it("SECURITY: blocks login for a SUSPENDED account", async () => {
    const { app, authRepository } = buildTestApp();
    await registerFarmer(app);
    const user = authRepository.users[0];
    await authRepository.updateAccountStatus(user.id, "SUSPENDED");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });

    expect(res.status).toEqual(401);
  });

  it("SECURITY: blocks login for a DEACTIVATED account", async () => {
    const { app, authRepository } = buildTestApp();
    await registerFarmer(app);
    const user = authRepository.users[0];
    await authRepository.updateAccountStatus(user.id, "DEACTIVATED");

    const res = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });

    expect(res.status).toEqual(401);
  });
});

async function registerAndLogin(app: import("express").Express) {
  await request(app).post("/api/auth/register").send(VALID_REGISTRATION);
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });
  const cookie = loginRes.headers["set-cookie"];
  return { accessToken: loginRes.body.data.accessToken as string, cookie };
}

describe("GET /api/auth/me", () => {
  it("SECURITY: rejects an unauthenticated request", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toEqual(401);
  });

  it("returns the current user for a valid access token, without sensitive fields", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerAndLogin(app);

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toEqual(200);
    expect(res.body.data.mobile).toEqual(VALID_REGISTRATION.mobile);
    expect(res.body.data.role).toEqual("FARMER");
    expect(res.body.data).not.toHaveProperty("passwordHash");
  });

  it("SECURITY: rejects a token from a since-expired/garbage string", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer garbage.token.here");
    expect(res.status).toEqual(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and logout is idempotent", async () => {
    const { app } = buildTestApp();
    const { cookie } = await registerAndLogin(app);

    const first = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(first.status).toEqual(200);

    // Calling logout again with the same (already revoked) cookie must not error.
    const second = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(second.status).toEqual(200);
  });

  it("calling logout with no session at all is also a no-op success", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toEqual(200);
  });
});

describe("POST /api/auth/logout-all", () => {
  it("revokes every session for the user", async () => {
    const { app, authRepository } = buildTestApp();
    const { accessToken } = await registerAndLogin(app);
    // A second login creates a second concurrent session (e.g. another device).
    await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });

    expect(authRepository.sessions.filter((s) => !s.revokedAt)).toHaveLength(2);

    const res = await request(app)
      .post("/api/auth/logout-all")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toEqual(200);
    expect(authRepository.sessions.filter((s) => !s.revokedAt)).toHaveLength(0);
  });
});

describe("POST /api/auth/change-password", () => {
  it("SECURITY: rejects the wrong current password", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerAndLogin(app);

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "WrongOne123", newPassword: "BrandNewPass123" });

    expect(res.status).toEqual(400);
    expect(res.body.error.fields.currentPassword).toBeTruthy();
  });

  it("changes the password and the old password can no longer log in", async () => {
    const { app } = buildTestApp();
    const { accessToken } = await registerAndLogin(app);

    const changeRes = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: VALID_REGISTRATION.password, newPassword: "BrandNewPass123" });
    expect(changeRes.status).toEqual(200);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });
    expect(oldLogin.status).toEqual(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: "BrandNewPass123" });
    expect(newLogin.status).toEqual(200);
  });

  it("SECURITY: rejects an unauthenticated change-password request", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "a", newPassword: "BrandNewPass123" });
    expect(res.status).toEqual(401);
  });
});

describe("forgot-password / reset-password flow", () => {
  it("returns the same generic message whether or not the account exists", async () => {
    const { app } = buildTestApp();
    await request(app).post("/api/auth/register").send(VALID_REGISTRATION);

    const knownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ mobile: VALID_REGISTRATION.mobile });
    const unknownRes = await request(app)
      .post("/api/auth/forgot-password")
      .send({ mobile: "9111111111" });

    expect(knownRes.status).toEqual(200);
    expect(unknownRes.status).toEqual(200);
    expect(knownRes.body.message).toEqual(unknownRes.body.message);
  });

  it("completes a full reset round-trip and revokes existing sessions", async () => {
    const { app, authRepository } = buildTestApp();
    await request(app).post("/api/auth/register").send(VALID_REGISTRATION);
    await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });
    expect(authRepository.sessions.filter((s) => !s.revokedAt)).toHaveLength(1);

    // Mocked delivery (spec section 19) logs the raw token instead of
    // sending a real SMS/email — capture it the way a test harness for the
    // real delivery channel eventually would.
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    await request(app).post("/api/auth/forgot-password").send({ mobile: VALID_REGISTRATION.mobile });
    const logged = logSpy.mock.calls.map((args) => args.join(" ")).find((line) => line.includes("token"));
    logSpy.mockRestore();
    const rawToken = logged?.split(": ").pop()?.trim();
    expect(rawToken).toBeTruthy();

    expect(authRepository.resetTokens).toHaveLength(1);
    expect(authRepository.resetTokens[0].usedAt).toBeNull();

    const resetRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "AnotherPass123" });
    expect(resetRes.status).toEqual(200);
    expect(authRepository.resetTokens[0].usedAt).not.toBeNull();

    // Resetting the password must force every existing session to log out.
    expect(authRepository.sessions.filter((s) => !s.revokedAt)).toHaveLength(0);

    // The token is single-use.
    const replay = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, newPassword: "YetAnotherPass123" });
    expect(replay.status).toEqual(400);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: VALID_REGISTRATION.password });
    expect(oldLogin.status).toEqual(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ mobile: VALID_REGISTRATION.mobile, password: "AnotherPass123" });
    expect(newLogin.status).toEqual(200);
  });

  it("rejects an invalid or already-used reset token", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "totally-made-up", newPassword: "AnotherPass123" });

    expect(res.status).toEqual(400);
    expect(res.body.error.fields.token).toBeTruthy();
  });
});
