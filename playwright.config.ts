import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — runs E2E in real Chromium against the live URL.
 * BASE_URL defaults to the production deploy; override for local runs:
 *   BASE_URL=http://localhost:3000 npx playwright test
 */
const BASE_URL = process.env.BASE_URL ?? "https://grimoire-vault.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
