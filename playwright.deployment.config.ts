import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SKETCHYCUT_DEPLOYMENT_URL;
const accessCode = process.env.SKETCHYCUT_E2E_ACCESS_CODE;
const expectedMode = process.env.SKETCHYCUT_DEPLOYMENT_EXPECTED_MODE;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!baseURL?.startsWith("https://")) throw new Error("SKETCHYCUT_DEPLOYMENT_URL_HTTPS_REQUIRED");
if (accessCode === undefined || accessCode.length < 20) throw new Error("SKETCHYCUT_E2E_ACCESS_CODE_REQUIRED");
if (expectedMode !== "fixture") throw new Error("SKETCHYCUT_DEPLOYMENT_FIXTURE_MODE_REQUIRED");
if (protectionBypass === undefined || protectionBypass.length < 20) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET_REQUIRED");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true"
    },
    screenshot: "only-on-failure",
    trace: "off"
  },
  projects: [{ name: "deployment-chromium", use: { ...devices["Desktop Chrome"] } }]
});
