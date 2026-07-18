import { expect, test } from "@playwright/test";

const RIGID_BRIEF = "Make a small rigid container using the reference for structure.";
const MOTIF_BRIEF = "Make a rigid container with one balanced radial diamond focal treatment.";
const SIMPLIFIED_BRIEF = "Make a rigid container; a sculpted oval silhouette is preferred but not essential.";
const CONCEPT_BRIEF = "Make a required compound-motion automaton with two independently moving panels.";
const INVALID_BRIEF = "Replay an intentionally invalid structured interpretation.";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & {
      __m5ObjectUrls?: { created: string[]; revoked: string[] };
    };
    state.__m5ObjectUrls = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = create(object);
      state.__m5ObjectUrls!.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      state.__m5ObjectUrls!.revoked.push(url);
      revoke(url);
    };
  });
  await page.goto("/create");
  const publicCopy = (await page.locator("body").innerText()).toLowerCase();
  expect(publicCopy).not.toMatch(/password|protected|unlock|judge|access required/);
});

test("validates files, labels thumbnails, removes references, and revokes object URLs", async ({ page }) => {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "unsupported.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image")
  });
  await expect(page.getByRole("alert")).toContainText("must be a JPEG, PNG, or WebP");

  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await expect(page.getByAltText("Reference 1 preview")).toBeVisible();
  await expect(page.getByRole("group", { name: "Suggested role" })).toBeVisible();
  await page.getByRole("button", { name: "Remove reference 1" }).click();
  await expect(page.getByAltText("Reference 1 preview")).toHaveCount(0);
  const urls = await page.evaluate(() => (
    window as Window & { __m5ObjectUrls?: { created: string[]; revoked: string[] } }
  ).__m5ObjectUrls!);
  expect(urls.created.length).toBeGreaterThan(0);
  expect(urls.revoked).toContain(urls.created[0]);
});

test("renders supported output through the shared workspace and constrains edited roles on regenerate", async ({ page }) => {
  let generationRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/__sketchycut/generate")) generationRequests += 1;
  });
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByTestId("compiled-product")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Preview" }).getByText("Stock sheet 12 × 12 in")).toBeVisible();
  await expect(page.locator("details.generation-editor")).not.toHaveAttribute("open", "");
  expect(generationRequests).toBe(1);

  const preview = page.getByRole("tab", { name: "Preview" });
  await preview.focus();
  await preview.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Preview" }).click();

  await page.locator("details.generation-editor > summary").click();
  await page.getByRole("checkbox", { name: "Surface treatment" }).check();
  await expect(page.getByRole("button", { name: "Regenerate with these roles" })).toBeVisible();
  const roleResponse = page.waitForResponse((response) =>
    response.url().endsWith("/__sketchycut/generate"),
  );
  await page.getByRole("button", { name: "Regenerate with these roles" }).click();
  await roleResponse;
  const editor = page.locator("details.generation-editor");
  await expect(editor).not.toHaveAttribute("open", "");
  await editor.locator(":scope > summary").click();
  await expect(editor).toHaveAttribute("open", "");
  await expect(page.getByRole("group", { name: "Suggested role" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Surface treatment" })).toBeChecked();
  expect(generationRequests).toBe(2);
});

test("recompiles dimensions, material, fit, nesting, and motif placement locally with zero interpretation calls", async ({ page }) => {
  let generationRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/__sketchycut/generate")) generationRequests += 1;
  });
  await page.getByLabel("Replay scenario").selectOption(MOTIF_BRIEF);
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  const motifResponse = page.waitForResponse((response) =>
    response.url().endsWith("/__sketchycut/generate"),
  );
  await page.getByRole("button", { name: "Generate project" }).click();
  await motifResponse;
  const workspace = page.getByTestId("compiled-product");
  await expect(workspace).toBeVisible();
  const initialHash = await workspace.getAttribute("data-geometry-hash");
  await page.getByRole("tab", { name: "Design" }).click();
  const design = page.getByRole("tabpanel", { name: "Design" });
  await design.getByRole("spinbutton", { name: "width (mm)", exact: true }).fill("130");
  await design.getByRole("spinbutton", { name: "Stock width (mm)" }).fill("300");
  await design.getByRole("spinbutton", { name: "Scale (%)" }).fill("85");
  await design.getByRole("spinbutton", { name: "Horizontal offset (%)" }).fill("10");
  await design.getByRole("combobox", { name: "Surface" }).selectOption("back");
  const editor = page.locator("details.generation-editor");
  await editor.locator(":scope > summary").click();
  await expect(editor).toHaveAttribute("open", "");
  await page.getByText("Optional size and fabrication details", { exact: true }).click();
  await page.getByRole("combobox", { name: "Stock material" }).selectOption("stock-3mm-birch-laser-plywood");
  await page.getByRole("combobox", { name: "Fit bias", exact: true }).selectOption("0.05");
  await editor.locator(":scope > summary").click();
  await design.getByRole("button", { name: "Apply design changes" }).click();
  await expect(workspace).not.toHaveAttribute("data-geometry-hash", initialHash ?? "");
  await expect(page.getByText("Applied to canonical output")).toBeVisible();
  expect(generationRequests).toBe(1);
});

test("presents simplified, concept-only, and typed failure outcomes without partial fabrication", async ({ page }) => {
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByLabel("Replay scenario").selectOption(SIMPLIFIED_BRIEF);
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByRole("heading", { name: "Supported with disclosed simplification" })).toBeVisible();

  await page.locator("details.generation-editor > summary").click();
  await page.getByLabel("Replay scenario").selectOption(CONCEPT_BRIEF);
  await page.getByRole("button", { name: "Regenerate project" }).click();
  await expect(page.getByText("Concept only · fabrication export withheld")).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveCount(0);

  await page.locator("details.generation-editor > summary").click();
  await page.getByLabel("Replay scenario").selectOption(INVALID_BRIEF);
  await page.getByRole("button", { name: "Regenerate project" }).click();
  await expect(page.getByRole("alert")).toContainText("Generation stopped at structured interpretation");
  await expect(page.getByAltText("Reference 1 preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request once" })).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveCount(0);
  let retries = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/__sketchycut/generate")) retries += 1;
  });
  await page.getByRole("button", { name: "Retry the same request once" }).click();
  await expect(page.getByRole("alert")).toContainText("Generation stopped at structured interpretation");
  await expect(page.getByAltText("Reference 1 preview")).toBeVisible();
  expect(retries).toBe(1);
});

test("has no page-level horizontal overflow at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByLabel("Replay scenario").selectOption(RIGID_BRIEF);
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByTestId("compiled-product")).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
