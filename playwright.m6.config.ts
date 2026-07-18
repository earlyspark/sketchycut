import { defineConfig, devices } from "@playwright/test";

const port = 3102;
const baseURL = `http://localhost:${String(port)}`;

export default defineConfig({
  testDir: "./tests/m6-e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node --import tsx tools/m61-fixture-start.ts -p ${String(port)}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 45_000
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"] }
  }]
});
