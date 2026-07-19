import { expect, test, type Page } from "@playwright/test";

const ACCESS_CODE = "sketchycut-fixture-access";
const NAVIGATION = [
  { label: "Home", href: "/" },
  { label: "Pre-made example", href: "/examples" },
  { label: "About", href: "/about" }
] as const;

async function expectPublicShell(page: Page, active: (typeof NAVIGATION)[number]["label"]): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const item of NAVIGATION) {
    const link = navigation.getByRole("link", { name: item.label, exact: true });
    await expect(link).toHaveAttribute("href", item.href);
    if (item.label === active) await expect(link).toHaveAttribute("aria-current", "page");
    else await expect(link).not.toHaveAttribute("aria-current", "page");
  }
  const footer = page.locator(".site-footer");
  await expect(footer.locator("p").first()).toHaveText(
    "SketchyCut by @earlyspark on github for OpenAI Build Week 2026",
  );
  await expect(footer.getByRole("link", { name: "github" })).toHaveAttribute(
    "href", "https://github.com/earlyspark/sketchycut",
  );
  await expect(footer.getByRole("link", { name: "OpenAI Build Week 2026" })).toHaveAttribute(
    "href", "https://openai.com/build-week/",
  );
  for (const link of await footer.getByRole("link").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  const judge = footer.locator("details");
  await expect(judge).not.toHaveAttribute("open", "");
  await expect(judge.getByText("Judge Access", { exact: true })).toBeVisible();
  await judge.getByText("Judge Access", { exact: true }).click();
  const accessCode = judge.locator(".masked-access-code");
  await expect(accessCode).toBeVisible();
  await expect(accessCode).toHaveAttribute("autocomplete", "off");
  await expect(accessCode).toHaveAttribute("data-lpignore", "true");
  await expect(accessCode).toHaveAttribute("data-1p-ignore", "true");
  await expect(accessCode).toHaveAttribute("data-bwignore", "true");
  await expect(accessCode).toHaveAttribute("data-form-type", "other");
  await expect(judge.getByRole("button", { name: "Submit" })).toBeVisible();
  await expect(judge.locator("form")).toHaveAttribute("action", "/api/session");
  await expect(judge.locator("form")).toHaveAttribute("method", "post");
  await expect(judge.locator("form")).toHaveAttribute("data-lpignore", "true");
}

test("shares exact header and footer states across public routes", async ({ page }) => {
  for (const [path, active] of [["/", "Home"], ["/examples", "Pre-made example"], ["/about", "About"]] as const) {
    await page.goto(path);
    await expectPublicShell(page, active);
  }
});

test("hydrates before password-manager mutation and keeps Judge Access layout-stable", async ({ page }) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const form = document.querySelector<HTMLFormElement>('.judge-access form');
      if (form?.querySelector('[data-lastpass-icon-root]') !== null) return;
      const injected = document.createElement("div");
      injected.dataset.lastpassIconRoot = "";
      form.append(injected);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const hydrationErrors: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Hydration failed")) hydrationErrors.push(message.text());
  });
  await page.goto("/");
  const judge = page.locator(".judge-access");
  const before = await judge.boundingBox();
  await judge.getByText("Judge Access", { exact: true }).click();
  await expect(judge.locator(".masked-access-code")).toBeVisible();
  await expect(judge.locator("[data-lastpass-icon-root]")).toHaveCount(1);
  const after = await judge.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(hydrationErrors).toEqual([]);
});

test("renders exact homepage copy, an SSR fallback, one lazy canvas, and linked selection", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  expect(html).toContain("From idea to laser-cut 3D construction");
  expect(html).toContain("/landing/basic-demo-assembled.svg");
  expect(html).toContain("/landing/basic-demo-sheet.svg");
  expect(html).not.toContain("fabrication candidate · physical verification required");
  expect(html).not.toContain("One source, linked views");

  const protectedRequests: string[] = [];
  page.on("request", (requestEvent) => {
    if (requestEvent.url().includes("/api/create/") || requestEvent.url().includes("api.openai.com")) {
      protectedRequests.push(requestEvent.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "From idea to laser-cut 3D construction" })).toBeVisible();
  await expect(page.getByText(
    "Describe your 3-dimensional idea and provide 1–3 images to SketchyCut. For supported constructions, it will provide an SVG pattern that you can inspect and prepare for laser cutting, then piece together into a 3D structure; unsupported ideas remain concept-only.",
    { exact: true },
  )).toBeVisible();
  await expect(page.getByRole("link", { name: "See the example" })).toHaveAttribute("href", "/examples");
  await expect(page.getByText(
    "You have the vision but you don't know how to draw the vectors. SketchyCut provides the part in the middle: the joint math, the cut file, and the assembly instructions. Now you can just... build things.",
    { exact: true },
  )).toBeVisible();
  const demo = page.locator(".landing-demo");
  await expect(demo.locator(".landing-demo-controls").getByRole("button")).toHaveCount(2);
  await expect(demo.getByRole("button", { name: "Assembled" })).toBeVisible();
  await expect(demo.getByRole("button", { name: "Exploded" })).toBeVisible();
  await expect(demo.locator("canvas")).toHaveCount(1);
  await expect(demo.getByRole("group", { name: "Canonical 3D assembly view" })).toBeVisible();
  await expect(demo.locator(".sheet-svg")).toHaveCount(1);
  const nextMark = demo.locator(".sheet-mark").nth(1);
  const selectedPartId = await nextMark.getAttribute("data-part-id");
  await nextMark.click();
  await expect(demo.locator(".landing-scene")).toHaveAttribute(
    "data-selected-part-id", selectedPartId ?? "",
  );
  await expect(demo.locator(`.sheet-path[data-part-id="${selectedPartId ?? ""}"]`).first()).toHaveClass(/selected/);
  await demo.getByRole("button", { name: "Exploded" }).click();
  await expect(demo.getByRole("button", { name: "Exploded" })).toHaveAttribute("aria-pressed", "true");
  const canvas = demo.locator("canvas");
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null) {
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42, { steps: 8 });
    await page.mouse.up();
    await canvas.hover();
    await page.mouse.wheel(0, -260);
  }
  const after = await canvas.screenshot();
  expect(after.equals(before)).toBe(false);
  expect(protectedRequests).toEqual([]);
});

test("keeps the canonical homepage demo meaningful with JavaScript disabled", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3102",
    javaScriptEnabled: false
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "From idea to laser-cut 3D construction" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Assembled canonical Basic construction" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Matching canonical Basic fabrication sheet" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await context.close();
});

test("keeps the exact Examples selector minimal and compiles all three continuous workspaces", async ({ page }) => {
  const protectedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/create/") || request.url().includes("api.openai.com")) {
      protectedRequests.push(request.url());
    }
  });
  await page.goto("/examples");
  await expect(page.getByText("Sample demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: '"Make me a box"' })).toBeVisible();
  await expect(page.getByText('Add 1–3 reference images and hit "Generate project"', { exact: true })).toBeVisible();
  const selector = page.locator(".example-selector");
  await expect(selector).toHaveText("ExamplesBasic boxHinged-lid boxSliding-lid box");
  await expect(selector.getByRole("button")).toHaveCount(3);
  const workspace = page.getByTestId("compiled-product");
  for (const item of [
    { label: "Basic box", id: "basic-box" },
    { label: "Hinged-lid box", id: "hinged-lid-box" },
    { label: "Sliding-lid box", id: "sliding-lid-box" }
  ]) {
    await selector.getByRole("button", { name: item.label, exact: true }).click();
    await expect(workspace).toHaveAttribute("data-active-example-id", item.id);
    await expect(workspace).toHaveAttribute("data-compile-status", "ready");
  }
  const headings = page.locator(".workspace-section > h2");
  await expect(headings).toHaveText(["Design", "Preview", "Build", "Fabricate"]);
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByRole("tabpanel")).toHaveCount(0);
  await expect(page.getByTestId("sheet-view")).toHaveCount(1);
  const sheetPanel = page.locator(".sheet-panel");
  await expect(sheetPanel.getByText("Fabrication files", { exact: true })).toBeVisible();
  await expect(sheetPanel.getByRole("button", { name: "Download product sheet-1" })).toBeVisible();
  await expect(page.locator("#workspace-panel-fabricate").getByRole("heading", { name: "Downloads" })).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(1);
  const sectionSnapshot = await page.locator(".canonical-workspace").ariaSnapshot();
  for (const heading of ["Preview", "Design", "Build", "Fabricate"]) {
    expect(sectionSnapshot).toContain(`heading "${heading}"`);
  }
  expect(sectionSnapshot).toContain('heading "Parts and sheets"');
  expect(sectionSnapshot).toContain('heading "Assembly instructions"');
  expect(sectionSnapshot).not.toContain('heading "Validation state"');
  await expect(page.getByTestId("scene-viewer")).toHaveAttribute(
    "aria-label", "assembled interactive canonical assembly scene",
  );

  const sheetMark = page.getByTestId("sheet-view").getByRole("button", { name: /Select part/ }).nth(1);
  const keyboardSelectedPartId = await sheetMark.getAttribute("data-part-id");
  await sheetMark.focus();
  await sheetMark.press("Enter");
  await expect(page.locator(`.sheet-path[data-part-id="${keyboardSelectedPartId ?? ""}"]`).first()).toHaveClass(/selected/);
  const legendRow = page.locator('tr[aria-label^="Select part"]').nth(2);
  const legendLabel = await legendRow.getAttribute("aria-label");
  await legendRow.focus();
  await legendRow.press(" ");
  await expect(legendRow).toHaveClass(/selected-row/);
  expect(legendLabel).toContain("Select part");
  expect(protectedRequests).toEqual([]);
});

test("keeps the public shell within 390 px with keyboard-visible navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/examples", "/about"]) {
    await page.goto(path);
    const first = page.getByRole("link", { name: "Home", exact: true });
    await first.focus();
    await expect(first).toBeFocused();
    const focusStyle = await first.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test("renders the four evidence-qualified About paragraphs and route metadata", async ({ page }) => {
  await page.goto("/about");
  await expect(page).toHaveTitle("About · SketchyCut");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /semantic interpretation/i);
  const paragraphs = page.locator("main p");
  await expect(paragraphs).toHaveCount(4);
  await expect(paragraphs.nth(0)).toContainText("1–3 reference images");
  await expect(paragraphs.nth(1)).toContainText("Deterministic SketchyCut code owns dimensions");
  await expect(paragraphs.nth(2)).toContainText("missing middle");
  await expect(paragraphs.nth(3)).toContainText("Software-only fabrication results");
});

test("authenticates with a body-only access code and has no active public nav item on create", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Judge Access", { exact: true }).click();
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await Promise.all([
    page.waitForURL("**/create"),
    page.getByRole("button", { name: "Submit" }).click()
  ]);
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const demo = navigation.getByRole("link", { name: "Demo", exact: true });
  await expect(demo).toHaveAttribute("href", "/create");
  await expect(demo).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Judge Access Unlocked" })).toHaveAttribute("href", "/create");
  await expect(page.locator(".site-footer").getByLabel("Access code")).toBeHidden();
  await page.goto("/examples");
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole(
    "link",
    { name: "Demo", exact: true },
  )).toHaveAttribute("href", "/create");
  await expect(page.getByRole("link", { name: "Judge Access Unlocked" })).toHaveAttribute("href", "/create");
});
