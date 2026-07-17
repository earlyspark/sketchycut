import { expect, test } from "@playwright/test";

async function waitForReady(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByText("Deterministic checks passed")).toBeVisible({ timeout: 15_000 });
}

test("begins with registered material and honest starter provenance", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A box you can inspect before you cut" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Material on hand" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /3 mm laser-grade basswood plywood — Recommended/ })).toBeChecked();
  await expect(page.getByText("How do you want to set up fit?", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Use starter profile|Measure this sheet|Calibrate my laser/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready with beginner estimates" })).toBeVisible();
  await expect(page.getByText("3.00 mm sheet thickness · 0.15 mm laser cut width")).toBeVisible();
  await expect(page.getByText("Starter estimate · physical fit not verified")).toBeVisible();
  await expect(page.getByText(/Sample 1|Median|spread|Measured full kerf/i)).toHaveCount(0);
  await expect(page.locator('input[type="number"]')).toHaveCount(0);
  await waitForReady(page);
  await expect(page.getByText(/Fabrication candidate generated from starter estimates/)).toBeVisible();
  await expect(page.getByText(/uses the registered nominal-3 mm thickness estimate/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download cut-width fixture" })).toBeEnabled();
  await expect(page.getByText(/Sold as a 3 mm straight wooden dowel or bamboo skewer/)).toBeVisible();
});

test("keeps stock and pin drafts separate from applied preview, download, apply, and discard", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  const initialHash = await page.locator(".hero-proof strong").textContent();
  await page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ }).check();
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await expect(page.getByText(/preview still uses the settings shown below; product downloads are paused/i)).toBeVisible();
  await expect(page.locator(".hero-proof strong")).toHaveText(initialHash ?? "");
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download cut-width fixture" })).toBeEnabled();

  await page.getByRole("button", { name: "Apply settings" }).click();
  await waitForReady(page);
  await expect(page.getByText(/3 mm laser-grade birch plywood/).last()).toBeVisible();
  await expect(page.getByText(/registered starter thickness/)).toBeVisible();
  const appliedHash = await page.locator(".hero-proof strong").textContent();

  await page.getByLabel("I measured this pin").check();
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply settings" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("I measured this pin")).not.toBeChecked();
  await expect(page.getByText("Preview matches the applied setup.")).toBeVisible();
  await expect(page.locator(".hero-proof strong")).toHaveText(appliedHash ?? "");
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeEnabled();
});

test("downloads the independent fixture while hidden calibration controls and an invalid pin draft stay isolated", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  await page.getByLabel("I measured this pin").check();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
  await expect(page.getByText("Enter the actual diameter reported by your caliper.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeDisabled();
  await expect(page.getByLabel("Packed row width")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Advanced: enter full cut width manually" })).toHaveCount(0);
  const fixtureButton = page.getByRole("button", { name: "Download cut-width fixture" });
  await expect(fixtureButton).toBeEnabled();
  const [fixtureDownload] = await Promise.all([
    page.waitForEvent("download"),
    fixtureButton.click()
  ]);
  expect(fixtureDownload.suggestedFilename()).toBe("sketchycut-cut-width-sheet-1.svg");
});

test("supports keyboard-only public stock, pin, and action operation", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  const basswood = page.getByRole("radio", { name: /3 mm laser-grade basswood plywood/ });
  await basswood.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ })).toBeChecked();
  const measuredPin = page.getByLabel("I measured this pin");
  await measuredPin.focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Actual pin diameter")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Actual pin diameter")).toHaveCount(0);
  const apply = page.getByRole("button", { name: "Apply settings" });
  await apply.focus();
  await page.keyboard.press("Enter");
  await waitForReady(page);
  await expect(page.getByText(/3 mm laser-grade birch plywood/).last()).toBeVisible();
});

test("keeps the generic motion viewer free of product-specific stop overlays on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForReady(page);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(horizontalOverflow).toBe(false);

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("lid-open-stop-contact")).toHaveCount(0);
  await expect(page.getByText(/Lid-open stop · contact at 105°/)).toHaveCount(0);
  await expect(page.getByText(/Deterministic endpoint proof certifies canonical contact/)).toBeVisible();
  await expect(page.getByText(/animation only explains the pose/)).toBeVisible();
  await expect(page.getByText(/Physical contact and motion remain unverified/)).toBeVisible();
  await expect(page.getByText("open-stop-brace", { exact: true })).toBeVisible();
  await expect(page.getByText("Lid-open stop", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Retained pin motion angle").fill("47");
  await expect(page.getByTestId("lid-open-stop-gap")).toHaveCount(0);
  await expect(page.getByText(/Lid-open stop · gap expected/)).toHaveCount(0);
  const overflowAfterMotion = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowAfterMotion).toBe(false);
});

test("preserves deterministic multi-sheet identity", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);
  await page.getByLabel("Force multi-sheet proof").check();
  const sheetSelect = page.getByLabel("Active fabrication sheet");
  await expect(sheetSelect.locator("option")).toHaveCount(6, { timeout: 15_000 });
  await sheetSelect.selectOption("sheet-3");
  await expect(sheetSelect).toHaveValue("sheet-3");
  await expect(page.getByRole("cell", { name: "sheet-3" }).first()).toBeVisible();
});
