import { defineConfig, devices } from "@playwright/test";

// Deployed live-dispatch probe. Every run performs exactly one paid model
// call, so this config demands explicit authorization plus live mode and
// never retries.
const baseURL = process.env.SKETCHYCUT_DEPLOYMENT_URL;
const accessCode = process.env.SKETCHYCUT_E2E_ACCESS_CODE;
const expectedMode = process.env.SKETCHYCUT_DEPLOYMENT_EXPECTED_MODE;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const authorized = process.env.SKETCHYCUT_LIVE_DISPATCH_AUTHORIZED;

if (!baseURL?.startsWith("https://")) {
  throw new Error("SKETCHYCUT_DEPLOYMENT_URL_HTTPS_REQUIRED");
}
if (accessCode === undefined || accessCode.length < 20) {
  throw new Error("SKETCHYCUT_E2E_ACCESS_CODE_REQUIRED");
}
if (expectedMode !== "live") {
  throw new Error("SKETCHYCUT_LIVE_MODE_REQUIRED");
}
if (protectionBypass === undefined || protectionBypass.length < 20) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET_REQUIRED");
}
if (authorized !== "1") {
  throw new Error("SKETCHYCUT_LIVE_DISPATCH_AUTHORIZATION_REQUIRED");
}

export default defineConfig({
  testDir: "./tests/live-probe",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true"
    },
    screenshot: "only-on-failure",
    trace: "off"
  },
  projects: [{
    name: "live-dispatch-chromium",
    use: { ...devices["Desktop Chrome"] }
  }]
});
