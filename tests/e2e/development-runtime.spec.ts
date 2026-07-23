import { expect, test, type Page } from "@playwright/test";

const ACCESS_CODE = "sketchycut-fixture-access";
const INVALID_BRIEF = "Interpret an intentionally invalid current structured fixture.";

function observeNetwork(page: Page): {
  external: string[];
  protectedRoutes: Set<string>;
} {
  const external: string[] = [];
  const protectedRoutes = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname) &&
        !["data:", "blob:"].includes(url.protocol)) {
      external.push(request.url());
    }
    if (url.pathname.startsWith("/api/create/")) protectedRoutes.add(url.pathname);
  });
  return { external, protectedRoutes };
}

async function coldLogin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("Judge Access", { exact: true }).click();
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await Promise.all([
    page.waitForURL("**/create"),
    page.getByRole("button", { name: "Submit" }).click()
  ]);
}

test("cold fixture runtime keeps the first session and all protected-route state", async ({ page }) => {
  const observed = observeNetwork(page);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await coldLogin(page);
  await expect(page.getByRole("heading", { name: "Describe what you want to make" })).toBeVisible();
  await expect(page.getByLabel("Fixture scenario")).toBeVisible();
  await expect(page.getByLabel("Prompt")).toHaveAttribute("readonly", "");

  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByTestId("compiled-product")).toBeVisible();
  const realization = page.locator(".interpretation-realization");
  await expect(realization.getByRole("heading", {
    name: "Commitments versus deterministic realization"
  })).toBeVisible();
  await expect(realization.locator("dt")).toHaveText([
    "Realized", "Simplified", "Unsupported", "Conflict resolved", "Uncertain"
  ]);
  await expect(realization).toContainText(
    "Open semantic meaning is retained for disclosure. Only the closed typed projection reaches deterministic construction and fabrication validation.",
  );
  const geometryHash = await page.getByTestId("compiled-product").getAttribute("data-geometry-hash");
  expect(geometryHash).toMatch(/^[0-9a-f]{64}$/);

  await page.reload();
  await expect(page.getByTestId("compiled-product")).toHaveAttribute(
    "data-geometry-hash",
    geometryHash ?? "",
  );
  await page.locator("#workspace-panel-fabricate").scrollIntoViewIfNeeded();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete fabrication package" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.zip$/);

  expect([...observed.protectedRoutes]).toEqual(expect.arrayContaining([
    "/api/create/upload",
    "/api/create/generate",
    "/api/create/project",
    "/api/create/export"
  ]));
  expect(observed.external).toEqual([]);
  expect(browserErrors.filter((message) => /content security policy|worker/i.test(message))).toEqual([]);
});

test("production CSP keeps unsafe evaluation disabled and examples compile without prewarming create", async ({ page }) => {
  const observed = observeNetwork(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/examples");
  expect(response?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  await expect(page.getByRole("heading", { name: '"Make me a box"' })).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveAttribute("data-compile-status", "ready");
  expect(observed.external).toEqual([]);
  expect(errors.filter((message) => /content security policy|worker/i.test(message))).toEqual([]);
});

test("invalid fixture preserves its exact brief, reference, and maker-set roles", async ({ page }) => {
  const observed = observeNetwork(page);
  await coldLogin(page);
  await page.getByLabel("Fixture scenario").selectOption({ label: "Invalid output (failure-preservation fixture)" });
  await expect(page.getByLabel("Prompt")).toHaveValue(INVALID_BRIEF);
  await expect(page.getByLabel("Prompt")).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  const reference = page.getByRole("list", { name: "Selected references" }).getByRole("listitem");
  await expect(reference.getByRole("checkbox", { name: "Structure" })).toBeChecked();
  await expect(reference.getByRole("checkbox", { name: "Surface treatment" })).toBeChecked();
  await expect(reference.getByText("Auto", { exact: true })).toHaveCount(0);
  await reference.getByRole("checkbox", { name: "Structure" }).uncheck();
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.locator('.field-error[role="alert"]')).toContainText(
    "Generation stopped at structured interpretation",
  );
  await expect(page.getByLabel("Prompt")).toHaveValue(INVALID_BRIEF);
  await expect(page.getByAltText("Reference 1 preview")).toBeVisible();
  await expect(reference.getByRole("checkbox", { name: "Surface treatment" })).toBeChecked();
  await expect(reference.getByRole("checkbox", { name: "Structure" })).not.toBeChecked();
  await expect(page.getByTestId("compiled-product")).toHaveCount(0);
  expect(observed.external).toEqual([]);
});
