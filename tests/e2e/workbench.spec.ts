import { expect, test } from "@playwright/test";

test("links worker-compiled retained-pin 2D, moving 3D, stock, legend, and instructions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A box you can inspect before you cut" })).toBeVisible();
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("scene-viewer").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("sheet-view").locator("path[data-part-id]")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Retained pin motion angle")).toHaveValue("105");
  await page.getByLabel("Retained pin motion angle").fill("47");
  await expect(page.getByText("Open / close · 47°")).toBeVisible();

  await page.getByRole("button", { name: "Exploded" }).click();
  await expect(page.getByRole("button", { name: "Exploded" })).toHaveClass(/active/);

  await page.getByRole("cell", { name: "Rear panel" }).click();
  await expect(page.getByText("rear-panel", { exact: true })).toBeVisible();
  await expect(page.locator('path[data-part-id="rear-panel"].selected')).not.toHaveCount(0);

  const originalHash = await page.locator(".hero-proof strong").textContent();
  for (const index of [1, 2, 3]) {
    await page.getByLabel(`Measured stock thickness sample ${String(index)}`).fill("3.30");
  }
  await expect(page.locator(".hero-proof strong")).not.toHaveText(originalHash ?? "", { timeout: 15_000 });
  await expect(page.getByText("Deterministic checks passed")).toBeVisible();
  await expect(page.getByText("Median 3.30 mm · spread 0.00 mm")).toBeVisible();
  await expect(page.getByText(/per-side offset, enter twice that value/)).toBeVisible();
  await expect(page.getByText(/coupon lines are process demonstrations/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download fixture sheet-1" })).toBeVisible();

  await expect(page.getByRole("cell", { name: /Measured hinge pin/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Not in SVG" })).toBeVisible();
  await page.getByRole("cell", { name: /Measured hinge pin/ }).click();
  await expect(page.getByText("Selected external stock")).toBeVisible();
  await expect(page.getByText(/retained-pin-construction-search@1.0.0/)).toBeVisible();
});

test("exposes deterministic multi-sheet identity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Force multi-sheet proof").check();
  const sheetSelect = page.getByLabel("Active fabrication sheet");
  await expect(sheetSelect.locator("option")).toHaveCount(6, { timeout: 15_000 });
  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
  await sheetSelect.selectOption("sheet-3");
  await expect(sheetSelect).toHaveValue("sheet-3");
  await expect(page.getByRole("cell", { name: "sheet-3" }).first()).toBeVisible();
});

test("preserves measured values while applying typed hard bounds and provisional advisories", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });

  const thickness = page.getByLabel("Measured stock thickness sample 1");
  await thickness.fill("2.49");
  await expect(thickness).toHaveValue("2.49");
  await expect(page.getByText(/STOCK MEASUREMENT OUT OF SUPPORTED ENVELOPE/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Export withheld" })).toBeVisible();

  await thickness.fill("3.00");
  await page.getByLabel("Measured full kerf X").fill("0.30");
  await page.getByLabel("Measured full kerf Y").fill("0.30");
  await expect(
    page.locator(".policy-findings p").filter({
      hasText: "KERF OUTSIDE PROVISIONAL BAND"
    }),
  ).toHaveCount(1);
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });

  const firstGeometryHash = await page.locator(".hero-proof strong").textContent();
  const pinDiameter = page.getByLabel("Measured wooden pin diameter");
  await pinDiameter.fill("3.10");
  await expect(pinDiameter).toHaveValue("3.10");
  await expect(page.locator(".hero-proof strong")).not.toHaveText(firstGeometryHash ?? "", {
    timeout: 15_000
  });
});
