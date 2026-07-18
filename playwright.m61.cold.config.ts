import { defineConfig, devices } from "@playwright/test";

const port = 3103;
const baseURL = `http://localhost:${String(port)}`;

export default defineConfig({
  testDir: "./tests/m61-e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `npm run dev:fixtures -- --port ${String(port)}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 90_000
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"] }
  }]
});
