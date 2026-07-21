import { expect, test, type Page } from "@playwright/test";

const BASIC_SOURCE_HASH = "91994ae0c0dee049acd1c13d65e5871b1c168e405caa7fa1e8039622f25b0b4b";
const BASIC_GEOMETRY_HASH = "bb208dff111a676247a9a75de409671af782ab10f1d5241d59546875e7cae1a2";
const BASIC_ARTIFACT_SET_HASH = "43d92bd8bea8a9b54feb14b345fd8113c872c27edfe2e2b9a677e1d52dc96dfa";
const HINGED_SOURCE_HASH = "62c703843ee171f767c357c8f2b6a880225738a07e48d3362690e176f4088a4c";
const HINGED_GEOMETRY_HASH = "0ee46844154a57ad44c2c1e5efb5385a115afc1fb5c9fca7466dac2928b6be7e";
const SLIDING_SOURCE_HASH = "9e33bc0b12065669d015ae04cf2f23bffd20972d09207d7af6a10ea3ab47b8ea";
const SLIDING_GEOMETRY_HASH = "78f8adcdd5b1b278e9cef9d70ca1d5a8e23822a1925a934ac3948acdd9973bf0";
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
  await expect(page.getByText('Enter a brief, optionally add up to 3 reference images, and hit "Generate project"', { exact: true })).toBeVisible();
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
  await expect(page.getByTestId("compiled-product")).toHaveAttribute("data-fabrication-export", "withheld");
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Download product sheet-1" })).toHaveCount(0);
  await expect(workspaceSection(page, "fabricate").getByRole("heading", { name: "Fabrication export withheld" })).toBeVisible();
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
    "aria-valuetext", /37\.0 millimetres, carried by two lower rails and retained by two upper rails/,
  );
  await workspaceSection(page, "preview").getByRole("button", { name: "Removal", exact: true }).click();
  await expect(page.getByText(/Removal is a disassembly state/)).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveAttribute("data-fabrication-export", "withheld");
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Download product sheet-1" })).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector("#workspace-panel-fabricate .workspace-section-body")!.getBoundingClientRect();
    const handoff = document.querySelector(".handoff-section")!.getBoundingClientRect();
    return {
      widthDelta: Math.abs(handoff.width - workspace.width),
      handoffGroups: document.querySelectorAll(".handoff-groups").length,
      operationLists: document.querySelectorAll(".operation-assignment-list").length
    };
  });
  expect(layout).toEqual({ widthDelta: 0, handoffGroups: 0, operationLists: 0 });

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
  await expect(workspaceSection(page, "preview").getByRole("button", { name: "Download product sheet-1" })).toHaveCount(0);
  await expect(workspaceSection(page, "preview").getByTestId("fabrication-export-withheld")).toBeVisible();
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
  await expect(page.getByText(/Sold as a 3 mm straight wooden dowel or bamboo skewer/)).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveAttribute(
    "data-fabrication-export",
    "withheld",
  );

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
