import request from "supertest";
import type { Express } from "express";

let mobileCounter = 9_800_000_000;

/** Registers a fresh farmer (unique mobile each call) and returns their access token + mobile. */
export async function registerAndLoginFarmer(
  app: Express,
  overrides: Partial<{ fullName: string; mobile: string; password: string }> = {},
) {
  const mobile = overrides.mobile ?? String(mobileCounter++);
  const password = overrides.password ?? "SecurePassword123";
  const fullName = overrides.fullName ?? "Ramesh Patil";

  await request(app).post("/api/auth/register").send({
    fullName,
    mobile,
    password,
    preferredLanguage: "en",
  });

  const loginRes = await request(app).post("/api/auth/login").send({ mobile, password });

  return { token: loginRes.body.data.accessToken as string, mobile };
}
