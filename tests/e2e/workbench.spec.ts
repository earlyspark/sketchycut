import { expect, test, type Page } from "@playwright/test";

type ExampleExpectation = {
  id: string;
  structuralKind: "orthogonal-panel" | "retained-pin" | "captured-slide";
};

// Exact artifact bytes belong to the unit-level golden suite. The browser
// verifies that the current identities are complete and linked correctly.
type ProductIdentity = {
  requestId: string;
  sourceHash: string;
  geometryHash: string;
};

async function waitForProduct(page: Page, expected: ExampleExpectation): Promise<ProductIdentity> {
  const compiled = page.getByTestId("compiled-product");
  await expect(compiled).toHaveAttribute("data-active-example-id", expected.id);
  await expect(compiled).toHaveAttribute("data-active-structural-kind", expected.structuralKind);
  await expect(compiled).toHaveAttribute("data-compile-status", "ready", { timeout: 15_000 });
  await expect(compiled).toHaveAttribute("data-product-request-id", /^product-\d+$/);
  await expect(compiled).toHaveAttribute("data-source-document-hash", /^[0-9a-f]{64}$/);
  await expect(compiled).toHaveAttribute("data-geometry-hash", /^[0-9a-f]{64}$/);
  const [requestId, sourceHash, geometryHash] = await Promise.all([
    compiled.getAttribute("data-product-request-id"),
    compiled.getAttribute("data-source-document-hash"),
    compiled.getAttribute("data-geometry-hash")
  ]);
  if (requestId === null || sourceHash === null || geometryHash === null) {
    throw new Error("Expected complete compiled-product identity.");
  }
  await expect(compiled).toHaveAttribute("data-compile-status", "ready");
  return { requestId, sourceHash, geometryHash };
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

  const basicIdentity = await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel"
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
  const productHandoff = handoffGroup(page, "product");
  const fitTestHandoff = handoffGroup(page, "optional-cut-width-fit-test");
  await expect(productHandoff).toHaveAttribute("data-source-document-hash", basicIdentity.sourceHash);
  await expect(productHandoff).toHaveAttribute("data-artifact-set-hash", /^[0-9a-f]{64}$/);
  await expect(fitTestHandoff).toHaveAttribute("data-artifact-set-hash", /^[0-9a-f]{64}$/);
  expect(await productHandoff.getAttribute("data-artifact-set-hash")).not.toBe(
    await fitTestHandoff.getAttribute("data-artifact-set-hash"),
  );
  await expect(fabricate.getByText(/xTool Studio-targeted; import verification required/)).toBeVisible();

  const targetHeights = await page.locator(
    ".example-selector button, .fabrication-setup button, .fabrication-setup .stock-choice, .fabrication-setup .check-control",
  ).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(targetHeights.every((height) => height >= 44)).toBe(true);
});

test("switches among all structural examples with coherent motion and handoff projections", async ({ page }) => {
  await page.goto("/examples");
  const initialIdentity = await waitForProduct(page, {
    id: "basic-box", structuralKind: "orthogonal-panel"
  });

  await exampleButton(page, "Hinged-lid box").click();
  const hingedIdentity = await waitForProduct(page, {
    id: "hinged-lid-box",
    structuralKind: "retained-pin"
  });
  expect(hingedIdentity.requestId).not.toBe(initialIdentity.requestId);
  expect(hingedIdentity.sourceHash).not.toBe(initialIdentity.sourceHash);
  expect(hingedIdentity.geometryHash).not.toBe(initialIdentity.geometryHash);
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
  const slidingIdentity = await waitForProduct(page, {
    id: "sliding-lid-box",
    structuralKind: "captured-slide"
  });
  expect(slidingIdentity.sourceHash).not.toBe(initialIdentity.sourceHash);
  expect(slidingIdentity.sourceHash).not.toBe(hingedIdentity.sourceHash);
  expect(slidingIdentity.geometryHash).not.toBe(initialIdentity.geometryHash);
  expect(slidingIdentity.geometryHash).not.toBe(hingedIdentity.geometryHash);
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
  const finalIdentity = await waitForProduct(page, {
    id: "basic-box", structuralKind: "orthogonal-panel"
  });
  expect(finalIdentity.requestId).not.toBe(initialIdentity.requestId);
  expect(finalIdentity.requestId).not.toBe(hingedIdentity.requestId);
  expect(finalIdentity.sourceHash).toBe(initialIdentity.sourceHash);
  expect(finalIdentity.geometryHash).toBe(initialIdentity.geometryHash);
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
