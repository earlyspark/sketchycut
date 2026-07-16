import { expect, test } from "@playwright/test";

test("links worker-compiled 2D, 3D, legend, and instruction state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A box you can inspect before you cut" })).toBeVisible();
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("scene-viewer").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("sheet-view").locator("path[data-part-id]")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Exploded" }).click();
  await expect(page.getByRole("button", { name: "Exploded" })).toHaveClass(/active/);

  await page.getByRole("cell", { name: "Rear panel" }).click();
  await expect(page.getByText("rear-panel", { exact: true })).toBeVisible();
  await expect(page.locator('path[data-part-id="rear-panel"].selected')).not.toHaveCount(0);

  const originalHash = await page.locator(".hero-proof strong").textContent();
  await page.getByLabel("Measured stock thickness").fill("3.3");
  await expect(page.locator(".hero-proof strong")).not.toHaveText(originalHash ?? "", { timeout: 15_000 });
  await expect(page.getByText("Deterministic checks passed")).toBeVisible();
});

test("exposes deterministic multi-sheet identity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Force multi-sheet proof").check();
  const sheetSelect = page.getByLabel("Active fabrication sheet");
  await expect(sheetSelect.locator("option")).toHaveCount(5, { timeout: 15_000 });
  await expect(page.getByText("5", { exact: true }).first()).toBeVisible();
  await sheetSelect.selectOption("sheet-3");
  await expect(sheetSelect).toHaveValue("sheet-3");
  await expect(page.getByRole("cell", { name: "sheet-3" })).toBeVisible();
});
