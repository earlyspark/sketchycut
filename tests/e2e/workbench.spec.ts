import { expect, test } from "@playwright/test";

const BASIC_SOURCE_HASH = "e98e63d17724b892ce1b5373f803614288b1aff82dcae140861432c5b2950b25";
const BASIC_GEOMETRY_HASH = "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5";
const BASIC_ARTIFACT_SET_HASH = "67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c";
const HINGED_SOURCE_HASH = "0ace01e333ed4f712364d356cbd1cd82a63edfc17af2de205824d90ce08f2a5f";
const HINGED_GEOMETRY_HASH = "cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664";
const HINGED_ARTIFACT_SET_HASH = "20ef165699cb85cc5690111f3fb29dd426c650e9d7e3e4ff77ba23c8f2978545";
const SLIDING_SOURCE_HASH = "7f8da7ff69aad348df3472bb2f0ebde7bd24c5ada8c476651c487a2c831e6712";
const SLIDING_GEOMETRY_HASH = "3d689633d37df8aeff952b1ef9411242f015accc70005b782df27a5313863085";
const SLIDING_ARTIFACT_SET_HASH = "f9f0e71f61860e840d259b728b120c9b58b95c7268ed3522e2fe65811888f89e";
const FIT_TEST_ARTIFACT_SET_HASH = "770d918dfb4b1f193c04ee27e5c12601daeb6ed3c65eec01c4034c061d385a10";

type ExampleExpectation = {
  id: string;
  structuralKind: "orthogonal-panel" | "retained-pin" | "captured-slide";
  sourceHash?: string;
  geometryHash?: string;
};

async function waitForProduct(
  page: import("@playwright/test").Page,
  expected: ExampleExpectation,
): Promise<string> {
  const compiled = page.getByTestId("compiled-product");
  await expect(compiled).toHaveAttribute("data-active-example-id", expected.id);
  await expect(compiled).toHaveAttribute(
    "data-active-structural-kind",
    expected.structuralKind,
  );
  await expect(compiled).toHaveAttribute("data-compile-status", "ready", {
    timeout: 15_000
  });
  if (expected.sourceHash !== undefined) {
    await expect(compiled).toHaveAttribute("data-source-document-hash", expected.sourceHash);
  }
  if (expected.geometryHash !== undefined) {
    await expect(compiled).toHaveAttribute("data-geometry-hash", expected.geometryHash);
  }
  const requestId = await compiled.getAttribute("data-product-request-id");
  expect(requestId).toMatch(/^product-\d+$/);
  await expect(page.getByText("Deterministic checks passed")).toBeVisible();
  return requestId!;
}

function progressionButton(
  page: import("@playwright/test").Page,
  label: string,
) {
  return page.locator(".progression-rail button").filter({ hasText: label });
}

function handoffGroup(
  page: import("@playwright/test").Page,
  group: "product" | "optional-cut-width-fit-test",
) {
  return page.locator(`[data-artifact-group="${group}"]`);
}

test("first-load Basic tells the progression truth and exposes only rigid capabilities", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A box you can inspect before you cut" })).toBeVisible();
  await expect(page.getByText("Nominal geometry", { exact: true })).toHaveCount(0);
  await expect(page.locator(".hero-proof")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Build progression" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Build progression" })).toBeVisible();
  const basic = progressionButton(page, "Basic box");
  const hinged = progressionButton(page, "Hinged-lid box");
  const sliding = progressionButton(page, "Sliding-lid box");
  await expect(basic).toHaveAttribute("aria-current", "step");
  await expect(basic).toContainText("Explore now");
  await expect(hinged).toContainText("Explore now");
  await expect(sliding).toContainText("Explore now");
  await expect(sliding).toBeEnabled();
  await expect(page.getByText("Fabrication candidate · physical verification required")).toBeVisible();

  await expect(page.getByRole("group", { name: "Material on hand" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /3 mm laser-grade basswood plywood — Recommended/ })).toBeChecked();
  await expect(page.getByText("How do you want to set up fit?", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ready with beginner estimates" })).toBeVisible();
  await expect(page.locator(".capability-input-slot")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Hinge pin on hand" })).toHaveCount(0);
  await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel",
    sourceHash: BASIC_SOURCE_HASH,
    geometryHash: BASIC_GEOMETRY_HASH
  });
  await expect(page.getByRole("button", { name: "Assembled", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exploded", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
  await expect(page.getByText("No moving joint · rigid assembly")).toBeVisible();
  await expect(page.getByText("Not in SVG", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sheet-stock-summary")).toContainText("Stock sheet 12 × 12 in");
  await expect(page.locator(".sheet-stock-summary")).toContainText("304.80 × 304.80 mm available");
  await expect(page.locator(".sheet-mark-label")).toHaveCount(5);
  await expect(page.locator('.sheet-mark[data-marking-code="p1"]')).toBeVisible();
  await expect(page.locator(".instructions small").first()).toContainText(/Marks? p\d/);
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Download optional cut-width fit test" })).toBeEnabled();
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-source-document-hash",
    BASIC_SOURCE_HASH,
  );
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-artifact-set-hash",
    BASIC_ARTIFACT_SET_HASH,
  );
  await expect(handoffGroup(page, "optional-cut-width-fit-test")).toHaveAttribute(
    "data-artifact-set-hash",
    FIT_TEST_ARTIFACT_SET_HASH,
  );
  await expect(page.getByText(/xTool Studio-targeted; import verification required/)).toBeVisible();
  const publicTargets = await page.locator(
    ".build-progression button, .fabrication-setup button, .fabrication-setup .stock-choice, .fabrication-setup .check-control",
  ).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  expect(publicTargets.every((height) => height >= 44)).toBe(true);
});

test("switches Basic to Hinged to Basic with coherent projections and stable fit-test handoff", async ({ page }) => {
  await page.goto("/");
  const initialRequest = await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel",
    sourceHash: BASIC_SOURCE_HASH,
    geometryHash: BASIC_GEOMETRY_HASH
  });
  await page.getByRole("button", { name: "Next: Hinged-lid box" }).click();
  const hingedRequest = await waitForProduct(page, {
    id: "hinged-lid-box",
    structuralKind: "retained-pin",
    sourceHash: HINGED_SOURCE_HASH,
    geometryHash: HINGED_GEOMETRY_HASH
  });
  expect(hingedRequest).not.toBe(initialRequest);
  await expect(progressionButton(page, "Hinged-lid box")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("group", { name: "Hinge pin on hand" })).toBeVisible();
  await expect(page.getByText(/Sold as a 3 mm straight wooden dowel or bamboo skewer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Closed", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();
  await expect(page.getByLabel("Retained pin motion angle")).toHaveAttribute("max", "105");
  await expect(page.getByText("One rotating joint · 0–105°")).toBeVisible();
  await expect(page.getByText("Not in SVG", { exact: true })).toBeVisible();
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-source-document-hash",
    HINGED_SOURCE_HASH,
  );
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-artifact-set-hash",
    HINGED_ARTIFACT_SET_HASH,
  );
  await expect(handoffGroup(page, "optional-cut-width-fit-test")).toHaveAttribute(
    "data-artifact-set-hash",
    FIT_TEST_ARTIFACT_SET_HASH,
  );
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".selection-strip code")).toHaveText("open-stop-brace");
  await expect(page.locator(".selection-strip strong")).toHaveText("Lid-open stop");

  await page.getByRole("button", { name: "Previous: Basic box" }).click();
  const replayRequest = await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel",
    sourceHash: BASIC_SOURCE_HASH,
    geometryHash: BASIC_GEOMETRY_HASH
  });
  expect(replayRequest).not.toBe(hingedRequest);
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await expect(page.locator(".capability-input-slot")).toHaveCount(0);
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-artifact-set-hash",
    BASIC_ARTIFACT_SET_HASH,
  );
  await expect(handoffGroup(page, "optional-cut-width-fit-test")).toHaveAttribute(
    "data-artifact-set-hash",
    FIT_TEST_ARTIFACT_SET_HASH,
  );
});

test("promotes captured travel through the same progression and structural dispatch", async ({ page }) => {
  await page.goto("/");
  await waitForProduct(page, {
    id: "basic-box",
    structuralKind: "orthogonal-panel",
    sourceHash: BASIC_SOURCE_HASH
  });
  await page.getByRole("button", { name: "Next: Hinged-lid box" }).click();
  await waitForProduct(page, {
    id: "hinged-lid-box",
    structuralKind: "retained-pin",
    sourceHash: HINGED_SOURCE_HASH
  });
  await page.getByRole("button", { name: "Next: Sliding-lid box" }).click();
  await waitForProduct(page, {
    id: "sliding-lid-box",
    structuralKind: "captured-slide",
    sourceHash: SLIDING_SOURCE_HASH,
    geometryHash: SLIDING_GEOMETRY_HASH
  });
  await expect(progressionButton(page, "Sliding-lid box")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("group", { name: "Hinge pin on hand" })).toHaveCount(0);
  await expect(page.locator(".capability-input-slot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Closed", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fully open", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Removal", exact: true })).toBeVisible();
  await expect(page.getByLabel("Captured lid travel distance")).toHaveAttribute("max", "60");
  await expect(page.getByText("One sliding joint · 0–60 mm")).toBeVisible();
  await page.getByRole("button", { name: "Fully open", exact: true }).click();
  await expect(page.locator(".selection-strip code")).toHaveText("travel-stop-key");
  await expect(page.locator(".selection-strip strong")).toHaveText("Removable travel stop");
  await page.getByLabel("Captured lid travel distance").fill("37");
  await expect(page.getByLabel("Captured lid travel distance")).toHaveAttribute(
    "aria-valuetext",
    /37\.0 millimetres, captured by both guide caps/,
  );
  await page.getByRole("button", { name: "Removal", exact: true }).click();
  await expect(page.getByText(/Removal is a disassembly state/)).toBeVisible();
  await expect(page.locator(".handoff-section .handoff-panel")).toBeVisible();
  const handoffLayout = await page.evaluate(() => {
    const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
    const handoff = document.querySelector(".handoff-section")!.getBoundingClientRect();
    const groupGrid = getComputedStyle(document.querySelector(".handoff-groups")!);
    const operationGrid = getComputedStyle(document.querySelector(".operation-assignment-list")!);
    return {
      followsWorkspace: handoff.top >= workspace.bottom,
      widthDelta: Math.abs(handoff.width - workspace.width),
      groupColumns: groupGrid.gridTemplateColumns.split(" ").length,
      operationColumns: operationGrid.gridTemplateColumns.split(" ").length
    };
  });
  expect(handoffLayout).toEqual({
    followsWorkspace: true,
    widthDelta: 0,
    groupColumns: 2,
    operationColumns: 3
  });
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-source-document-hash",
    SLIDING_SOURCE_HASH,
  );
  await expect(handoffGroup(page, "product")).toHaveAttribute(
    "data-artifact-set-hash",
    SLIDING_ARTIFACT_SET_HASH,
  );
  await expect(handoffGroup(page, "optional-cut-width-fit-test")).toHaveAttribute(
    "data-artifact-set-hash",
    FIT_TEST_ARTIFACT_SET_HASH,
  );
  await expect(page.getByRole("button", { name: "Next available example unavailable" })).toBeDisabled();
});

test("keeps dormant invalid pin input isolated through Basic apply and discard", async ({ page }) => {
  await page.goto("/");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await progressionButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await page.getByLabel("I measured this pin").check();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download optional cut-width fit test" })).toBeEnabled();

  await progressionButton(page, "Basic box").click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await expect(page.getByText("Preview matches the applied setup.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeEnabled();
  await page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ }).check();
  await expect(page.getByText("Pending settings are valid and ready to apply.")).toBeVisible();
  await page.getByRole("button", { name: "Apply pending settings" }).click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await expect(page.getByText(/3 mm laser-grade birch plywood/).last()).toBeVisible();

  await progressionButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await expect(page.getByLabel("I measured this pin")).toBeChecked();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download product sheet-1" })).toBeDisabled();
  await expect(page.getByText("Last-applied output · draft not included")).toBeVisible();

  await progressionButton(page, "Basic box").click();
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await page.getByRole("radio", { name: /3 mm laser-grade basswood plywood/ }).check();
  await expect(page.getByText("Changes are not applied.")).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("radio", { name: /3 mm laser-grade birch plywood/ })).toBeChecked();
  await expect(page.getByText("Preview matches the applied setup.")).toBeVisible();
  await progressionButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await expect(page.getByLabel("I measured this pin")).toBeChecked();
  await expect(page.getByLabel("Actual pin diameter")).toHaveValue("");
});

test("supports keyboard-only progression, stock, capability, and action operation", async ({ page }) => {
  await page.goto("/");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  const next = page.getByRole("button", { name: "Next: Hinged-lid box" });
  await next.focus();
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
  const apply = page.getByRole("button", { name: "Apply pending settings" });
  await apply.focus();
  await page.keyboard.press("Enter");
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  await expect(page.getByText(/3 mm laser-grade birch plywood/).last()).toBeVisible();
});

test("keeps capability-driven motion and progression free of mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
  await progressionButton(page, "Hinged-lid box").click();
  await waitForProduct(page, { id: "hinged-lid-box", structuralKind: "retained-pin" });
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBe(false);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("lid-open-stop-contact")).toHaveCount(0);
  await expect(page.getByText(/Deterministic endpoint proof certifies canonical contact/)).toBeVisible();
  await expect(page.getByText(/Physical contact and motion remain unverified/)).toBeVisible();
  await page.getByLabel("Retained pin motion angle").fill("47");
  await expect(page.getByTestId("lid-open-stop-gap")).toHaveCount(0);
  const overflowAfterMotion = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowAfterMotion).toBe(false);
  await progressionButton(page, "Sliding-lid box").click();
  await waitForProduct(page, { id: "sliding-lid-box", structuralKind: "captured-slide" });
  await page.getByRole("button", { name: "Fully open", exact: true }).click();
  await page.getByLabel("Captured lid travel distance").fill("31");
  await page.getByRole("button", { name: "Removal", exact: true }).click();
  const overflowAfterSlide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflowAfterSlide).toBe(false);
});

test("preserves deterministic multi-sheet identity after active-example compilation", async ({ page }) => {
  await page.goto("/");
  await waitForProduct(page, { id: "basic-box", structuralKind: "orthogonal-panel" });
  await page.getByLabel("Force multi-sheet proof").check();
  const sheetSelect = page.getByLabel("Active fabrication sheet");
  await expect.poll(() => sheetSelect.locator("option").count(), { timeout: 15_000 }).toBeGreaterThan(1);
  const lastValue = await sheetSelect.locator("option").last().getAttribute("value");
  if (lastValue === null) throw new Error("Expected a generated sheet option value.");
  await sheetSelect.selectOption(lastValue);
  await expect(sheetSelect).toHaveValue(lastValue);
  await expect(page.getByRole("cell", { name: lastValue }).first()).toBeVisible();
});
