import { test, expect } from "@playwright/test";

// Spec section 55's flow: register -> login -> view dashboard -> logout ->
// login again -> change password -> logout. Plus the unauthenticated
// protected-route redirect check.
//
// Requires the real stack running (backend on :4000 with a live Postgres,
// frontend on :3000) — see playwright.config.ts. Each run uses a fresh
// random mobile number so it's safe to re-run against a persistent dev DB.

function randomMobile() {
  const rest = Math.floor(100000000 + Math.random() * 899999999).toString();
  return `9${rest}`.slice(0, 10);
}

test("full farmer registration → login → dashboard → logout → login → change password → logout", async ({
  page,
}) => {
  const mobile = randomMobile();
  const password = "SecurePassword123";
  const newPassword = "AnotherSecurePass456";

  await page.goto("/register");
  await page.getByLabel("Full name").fill("Test Farmer");
  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Farmer dashboard")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Mobile number").fill(mobile);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/profile");
  await page.getByLabel("Current password").fill(password);
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password changed successfully.")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user hitting a protected route is redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("unauthenticated user hitting the profile page is redirected to login", async ({ page }) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login/);
});
