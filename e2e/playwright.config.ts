import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // This suite expects the backend (port 4000) and frontend (port 3000) to
  // already be running against a real Postgres — it's an end-to-end check,
  // not something the unit/integration suites' in-memory fakes can cover.
  // `npm run dev` in both backend/ and frontend/ before running this.
});
