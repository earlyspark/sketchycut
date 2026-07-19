import { expect, test, type Page } from "@playwright/test";

const BASIC_SOURCE_HASH = "efdb0e7cea532e7a5046a20d4729f4450420c9f7c4ae58b6dc7dbcae3fff7739";
const BASIC_GEOMETRY_HASH = "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5";
const BASIC_ARTIFACT_SET_HASH = "67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c";
const HINGED_SOURCE_HASH = "c9b87f1f4269887aae80385e16087cea9adbae2469c7bfccd4b59cff0952401f";
const HINGED_GEOMETRY_HASH = "cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664";
const HINGED_ARTIFACT_SET_HASH = "20ef165699cb85cc5690111f3fb29dd426c650e9d7e3e4ff77ba23c8f2978545";
const SLIDING_SOURCE_HASH = "e8e96c155d908586c8d0ff3d5784b5352d26254f2473cf66ab3df0f99c16b735";
const SLIDING_GEOMETRY_HASH = "3d689633d37df8aeff952b1ef9411242f015accc70005b782df27a5313863085";
const SLIDING_ARTIFACT_SET_HASH = "f9f0e71f61860e840d259b728b120c9b58b95c7268ed3522e2fe65811888f89e";
const FIT_TEST_ARTIFACT_SET_HASH = "770d918dfb4b1f193c04ee27e5c12601daeb6ed3c65eec01c4034c061d385a10";

type ExampleExpectation = {
  id: string;
  structuralKind: "orthogonal-panel" | "retained-pin" | "captured-slide";
  sourceHash?: string;
  geometryHash?: string;
};

async function waitForProduct(page: Page, expected: ExampleExpectation): Promise<string> {
  const compiled = page.getByTestId("compiled-product");
  await expect(compiled).toHaveAttribute("data-active-example-id", expected.id);
  await expect(compiled).toHaveAttribute("data-active-structural-kind", expected.structuralKind);
  await expect(compiled).toHaveAttribute("data-compile-status", "ready", { timeout: 15_000 });
  if (expected.sourceHash !== undefined) {
    await expect(compiled).toHaveAttribute("data-source-document-hash", expected.sourceHash);
  }
  if (expected.geometryHash !== undefined) {
    await expect(compiled).toHaveAttribute("data-geometry-hash", expected.geometryHash);
  }
  const requestId = await compiled.getAttribute("data-product-request-id");
  expect(requestId).toMatch(/^product-\d+$/);
  await expect(compiled).toHaveAttribute("data-compile-status", "ready");
  return requestId!;
}

function exampleButton(page: Page, label: string) {
  return page.locator(".example-selector").getByRole("button", { name: label, exact: true });
}

function workspaceSection(page: Page, name: "preview" | "design" | "build" | "fabricate") {
  return page.locator(`#workspace-panel-${name}`);
}

function handoffGroup(page: Page, group: "product" | "optional-cut-width-fit-test") {
  return workspaceSection(page, "fabricate").locator(`[data-artifact-group="${group}"]`);
}

test("compiles the default example into four linked continuous sections", async ({ page }) => {
  await page.goto("/examples");
  await expect(page.getByRole("heading", { name: '"Make me a box"' })).toBeVisible();
  await expect(page.getByText('Add 1–3 reference images and hit "Generate project"', { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(page.locator(".workspace-section > h2")).toHaveText([
    "Design", "Preview", "Build", "Fabricate"
  ]);

  await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel",
    sourceHash: BASIC_SOURCE_HASH,
    geometryHash: BASIC_GEOMETRY_HASH
  });
  await expect(exampleButton(page, "Basic box")).toHaveAttribute("aria-pressed", "true");

  const design = workspaceSection(page, "design");
  await expect(design.getByRole("group", { name: "Material on hand" })).toBeVisible();
  await expect(design.getByRole("radio", { name: /3 mm laser-grade basswood plywood — Recommended/ })).toBeChecked();
  await expect(design.getByText("How do you want to set up fit?", { exact: true })).toHaveCount(0);
  await expect(design.getByRole("heading", { name: "Ready with beginner estimates" })).toBeVisible();
  await expect(design.getByRole("group", { name: "Hinge pin on hand" })).toHaveCount(0);

  const preview = workspaceSection(page, "preview");
  await expect(preview.getByRole("button", { name: "Assembled", exact: true })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Exploded", exact: true })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await expect(preview.locator('input[type="range"]')).toHaveCount(0);
  await expect(preview.locator(".sheet-stock-summary")).toContainText("Stock sheet 12 × 12 in");
  await expect(preview.locator(".sheet-stock-summary")).toContainText("304.80 × 304.80 mm available");
  await expect(preview.locator(".sheet-mark-label")).toHaveCount(5);
  await expect(preview.locator('.sheet-mark[data-marking-code="p1"]')).toBeVisible();

  const build = workspaceSection(page, "build");
  await expect(build.locator(".instructions small").first()).toContainText(/Marks? p\d/);

  await expect(workspaceSection(page, "preview").getByText("No moving joint · rigid assembly")).toBeVisible();
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Download product sheet-1" })).toBeEnabled();
  const fabricate = workspaceSection(page, "fabricate");
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-source-document-hash", BASIC_SOURCE_HASH);
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-artifact-set-hash", BASIC_ARTIFACT_SET_HASH);
  await expect(handoffGroup(page, "optional-cut-width-fit-test")).toHaveAttribute(
    "data-artifact-set-hash", FIT_TEST_ARTIFACT_SET_HASH,
  );
  await expect(fabricate.getByText(/xTool Studio-targeted; import verification required/)).toBeVisible();

  const targetHeights = await page.locator(
    ".example-selector button, .fabrication-setup button, .fabrication-setup .stock-choice, .fabrication-setup .check-control",
  ).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(targetHeights.every((height) => height >= 44)).toBe(true);
});

test("switches among all structural examples with coherent motion and handoff projections", async ({ page }) => {
  await page.goto("/examples");
  const initialRequest = await waitForProduct(page, {
    id: "basic-box", structuralKind: "orthogonal-panel", sourceHash: BASIC_SOURCE_HASH
  });

  await exampleButton(page, "Hinged-lid box").click();
  const hingedRequest = await waitForProduct(page, {
    id: "hinged-lid-box",
    structuralKind: "retained-pin",
    sourceHash: HINGED_SOURCE_HASH,
    geometryHash: HINGED_GEOMETRY_HASH
  });
  expect(hingedRequest).not.toBe(initialRequest);
  await expect(exampleButton(page, "Hinged-lid box")).toHaveAttribute("aria-pressed", "true");
  await expect(workspaceSection(page, "design").getByRole("group", { name: "Hinge pin on hand" })).toBeVisible();
  await expect(page.getByText(/Sold as a 3 mm straight wooden dowel or bamboo skewer/)).toBeVisible();
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Open", exact: true })).toBeVisible();
  await expect(page.getByLabel("Retained pin motion angle")).toHaveAttribute("max", "105");
  await expect(workspaceSection(page, "preview").getByText("One rotating joint · 0–105°")).toBeVisible();
  await expect(workspaceSection(page, "build").getByText("Not in SVG", { exact: true })).toBeVisible();
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-source-document-hash", HINGED_SOURCE_HASH);
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-artifact-set-hash", HINGED_ARTIFACT_SET_HASH);
  await workspaceSection(page, "preview").getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".selection-strip code")).toHaveText("open-stop-brace");
  await expect(page.locator(".selection-strip strong")).toHaveText("Lid-open stop");

  await exampleButton(page, "Sliding-lid box").click();
  await waitForProduct(page, {
    id: "sliding-lid-box",
    structuralKind: "captured-slide",
    sourceHash: SLIDING_SOURCE_HASH,
    geometryHash: SLIDING_GEOMETRY_HASH
  });
  await expect(workspaceSection(page, "design").getByRole("group", { name: "Hinge pin on hand" })).toHaveCount(0);
  await expect(page.getByLabel("Captured lid travel distance")).toHaveAttribute("max", "60");
  await expect(workspaceSection(page, "preview").getByText("One sliding joint · 0–60 mm")).toBeVisible();
  await workspaceSection(page, "preview").getByRole("button", { name: "Fully open", exact: true }).click();
  await expect(page.locator(".selection-strip code")).toHaveText("travel-stop-key");
  await expect(page.locator(".selection-strip strong")).toHaveText("Removable travel stop");
  await page.getByLabel("Captured lid travel distance").fill("37");
  await expect(page.getByLabel("Captured lid travel distance")).toHaveAttribute(
    "aria-valuetext", /37\.0 millimetres, captured by both guide caps/,
  );
  await workspaceSection(page, "preview").getByRole("button", { name: "Removal", exact: true }).click();
  await expect(page.getByText(/Removal is a disassembly state/)).toBeVisible();
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-source-document-hash", SLIDING_SOURCE_HASH);
  await expect(handoffGroup(page, "product")).toHaveAttribute("data-artifact-set-hash", SLIDING_ARTIFACT_SET_HASH);

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector("#workspace-panel-fabricate .workspace-section-body")!.getBoundingClientRect();
    const handoff = document.querySelector(".handoff-section")!.getBoundingClientRect();
    return {
      widthDelta: Math.abs(handoff.width - workspace.width),
      handoffColumns: getComputedStyle(document.querySelector(".handoff-groups")!).gridTemplateColumns.split(" ").length,
      operationColumns: getComputedStyle(document.querySelector(".operation-assignment-list")!).gridTemplateColumns.split(" ").length
    };
  });
  expect(layout).toEqual({ widthDelta: 0, handoffColumns: 2, operationColumns: 3 });

  await exampleButton(page, "Basic box").click();
  const finalRequest = await waitForProduct(page, {
    id: "basic-box", structuralKind: "orthogonal-panel", sourceHash: BASIC_SOURCE_HASH
  });
  expect(finalRequest).not.toBe(hingedRequest);
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
});

test("keeps invalid capability drafts isolated and preserves applied output", async ({ page }) => {
  await page.goto("/examples");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await exampleButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await page.getByLabel("I measured this pin").check();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply settings" })).toBeDisabled();
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Download product sheet-1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download optional cut-width fit test" })).toBeEnabled();

  await exampleButton(page, "Basic box").click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await expect(page.getByText("Preview matches the applied setup.")).toBeVisible();
  await page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ }).check();
  await page.getByRole("button", { name: "Apply pending settings" }).click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await expect(page.getByText(/3 mm laser-grade birch plywood/).last()).toBeVisible();

  await exampleButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await expect(page.getByLabel("I measured this pin")).toBeChecked();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
  await expect(workspaceSection(page, "fabricate").getByText("Last-applied output · draft not included")).toBeVisible();

  await exampleButton(page, "Basic box").click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await page.getByRole("radio", { name: /3 mm laser-grade basswood plywood/ }).check();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ })).toBeChecked();
});

test("supports keyboard operation and remains overflow-free at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/examples");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  const hinged = exampleButton(page, "Hinged-lid box");
  await hinged.focus();
  await page.keyboard.press("Enter");
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
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
  await page.getByRole("button", { name: "Apply pending settings" }).click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await workspaceSection(page, "preview").getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("Retained pin motion angle").fill("47");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  await exampleButton(page, "Sliding-lid box").click();
  await waitForProduct(page, { id: "sliding-lid-box", structuralKind: "captured-slide" });
  await workspaceSection(page, "preview").getByRole("button", { name: "Removal", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("preserves deterministic multi-sheet identity in the continuous workspace", async ({ page }) => {
  await page.goto("/examples");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await page.getByLabel("Force multi-sheet proof").check();
  const sheetSelect = workspaceSection(page, "preview").getByLabel("Active fabrication sheet");
  await expect.poll(() => sheetSelect.locator("option").count(), { timeout: 15_000 }).toBeGreaterThan(1);
  const lastValue = await sheetSelect.locator("option").last().getAttribute("value");
  if (lastValue === null) throw new Error("Expected a generated sheet option value.");
  await sheetSelect.selectOption(lastValue);
  await expect(sheetSelect).toHaveValue(lastValue);
  await expect(workspaceSection(page, "build").getByRole("cell", { name: lastValue }).first()).toBeVisible();
});
