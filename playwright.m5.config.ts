import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/m5-e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node --import tsx tools/m5-sidecar.ts --mode replay --port 3100 --next-port 3101 --next-mode start",
    url: "http://127.0.0.1:3100/create",
    reuseExistingServer: true,
    timeout: 45_000
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"] }
  }]
});
