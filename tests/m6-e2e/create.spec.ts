import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ACCESS_CODE = process.env.SKETCHYCUT_E2E_ACCESS_CODE ?? "m6-fixture-access";
const RIGID_BRIEF = "Make a small rigid container using the reference for structure.";
const CONCEPT_BRIEF = "Make a required compound-motion automaton with two independently moving panels.";
const INVALID_BRIEF = "Replay an intentionally invalid structured interpretation.";

async function enterWorkspace(page: Page): Promise<void> {
  const landing = await page.goto("/");
  expect(landing?.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
  await page.getByText("Judge workspace", { exact: true }).click();
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await Promise.all([
    page.waitForURL("**/create"),
    page.getByRole("button", { name: "Continue" }).click()
  ]);
}

async function generateRigid(page: Page): Promise<void> {
  await page.getByLabel("Replay scenario").selectOption(RIGID_BRIEF);
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByTestId("compiled-product")).toBeVisible();
  await expect(page.getByText("Deterministic checks passed")).toHaveCount(1);
}

async function sessionCookie(context: BrowserContext) {
  const cookies = await context.cookies();
  const cookie = cookies.find((candidate) => candidate.name === "__Host-sketchycut-evaluation");
  expect(cookie).toBeDefined();
  return cookie!;
}

test("keeps public routes zero-call and issues a bounded server session", async ({ page, context }) => {
  const protectedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/create/") || request.url().includes("api.openai.com")) {
      protectedRequests.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "See the build before you cut." })).toBeVisible();
  await page.goto("/examples");
  await expect(page.getByRole("heading", { name: "A box you can inspect before you cut" })).toBeVisible();
  expect(protectedRequests).toEqual([]);

  const unavailable = await page.goto("/create");
  expect(unavailable?.status()).toBe(404);
  await enterWorkspace(page);
  await expect(page.getByRole("heading", { name: "Describe what you want to make" })).toBeVisible();
  const cookie = await sessionCookie(context);
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.secure).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  expect(cookie.expires - Date.now() / 1_000).toBeGreaterThan(3_500);
  expect(cookie.expires - Date.now() / 1_000).toBeLessThanOrEqual(3_600);
});

test("completes generation, zero-call edits, persistence restore, and the full package", async ({ page, context }) => {
  await enterWorkspace(page);
  let generationRequests = 0;
  let projectUpdates = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/create/generate")) generationRequests += 1;
    if (request.url().endsWith("/api/create/project") && request.method() === "POST") {
      projectUpdates += 1;
    }
  });
  await generateRigid(page);
  const workspace = page.getByTestId("compiled-product");
  const firstGeometryHash = await workspace.getAttribute("data-geometry-hash");
  const firstDocumentHash = await workspace.getAttribute("data-source-document-hash");
  expect(generationRequests).toBe(1);

  await page.getByRole("tab", { name: "Design" }).click();
  const design = page.getByRole("tabpanel", { name: "Design" });
  await design.getByRole("spinbutton", { name: "width (mm)", exact: true }).fill("130");
  await design.getByRole("spinbutton", { name: "Stock width (mm)", exact: true }).fill("200");
  await design.getByRole("spinbutton", { name: "Stock height (mm)", exact: true }).fill("180");
  await expect(page.getByText("Draft changes not applied")).toBeVisible();
  await design.getByRole("button", { name: "Apply design changes" }).click();
  await expect(workspace).not.toHaveAttribute("data-geometry-hash", firstGeometryHash ?? "");
  await expect(workspace).not.toHaveAttribute("data-source-document-hash", firstDocumentHash ?? "");
  await expect(page.getByText("Applied to canonical output")).toBeVisible();
  expect(generationRequests).toBe(1);
  expect(projectUpdates).toBe(1);

  await page.getByRole("tab", { name: "Fabricate" }).click();
  const fabricate = page.getByRole("tabpanel", { name: "Fabricate" });
  const sheetSelector = fabricate.getByLabel("Active fabrication sheet");
  const productSheetCount = await sheetSelector.locator("option").count();
  expect(productSheetCount).toBeGreaterThan(1);
  await sheetSelector.selectOption("sheet-2");
  await expect(sheetSelector).toHaveValue("sheet-2");
  await expect(fabricate.getByRole("button", { name: /^Download product sheet-/ })).toHaveCount(
    productSheetCount,
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download complete fabrication package" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const archive = unzipSync(await import("node:fs/promises").then(({ readFile }) => readFile(downloadPath)));
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]!)) as {
    artifactGroups: { id: string; sheets: { path: string; partIds: string[] }[] }[];
    files: { path: string; bytes: number; sha256: string }[];
    requiredStudioKerfOffset: string;
  };
  expect(manifest.artifactGroups.map((group) => group.id)).toEqual([
    "product",
    "material-fit-coupon",
    "optional-cut-width-fit-test"
  ]);
  expect(manifest.requiredStudioKerfOffset).toBe("off / 0.00 mm");
  expect(manifest.artifactGroups[0]!.sheets).toHaveLength(productSheetCount);
  for (const file of manifest.files) {
    expect(archive[file.path]?.byteLength).toBe(file.bytes);
    expect(createHash("sha256").update(archive[file.path]!).digest("hex")).toBe(file.sha256);
  }
  const productParts = manifest.artifactGroups[0]!.sheets.flatMap((sheet) => sheet.partIds);
  expect(new Set(productParts).size).toBe(productParts.length);

  const restoredPage = await context.newPage();
  await restoredPage.goto("/create");
  await expect(restoredPage.getByTestId("compiled-product")).toBeVisible();
  await expect(restoredPage.getByTestId("compiled-product")).toHaveAttribute(
    "data-geometry-hash",
    await workspace.getAttribute("data-geometry-hash") ?? "",
  );
  await restoredPage.getByRole("tab", { name: "Design" }).click();
  await expect(restoredPage.getByRole("spinbutton", { name: "width (mm)", exact: true })).toHaveValue("130");
  await restoredPage.close();
});

test("preserves inputs on typed failure and withholds concept-only exports", async ({ page }) => {
  await enterWorkspace(page);
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByLabel("Replay scenario").selectOption(INVALID_BRIEF);
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.locator('.field-error[role="alert"]')).toContainText(
    "Generation stopped at structured interpretation",
  );
  await expect(page.getByLabel(/Maker brief/)).toHaveValue(INVALID_BRIEF);
  await expect(page.getByAltText("Reference 1 preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry the same request once" })).toBeVisible();
  await expect(page.getByTestId("compiled-product")).toHaveCount(0);

  await page.getByLabel("Replay scenario").selectOption(CONCEPT_BRIEF);
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByText("Concept only · fabrication export withheld")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download complete fabrication package" })).toHaveCount(0);
  await expect(page.getByTestId("compiled-product")).toHaveCount(0);
});

test("rejects route bypasses and rate-limits each protected route independently", async ({ request, page }) => {
  for (const [route, method] of [
    ["/api/create/upload", "post"],
    ["/api/create/generate", "post"],
    ["/api/create/project", "get"],
    ["/api/create/export", "post"]
  ] as const) {
    const response = method === "get"
      ? await request.get(route)
      : await request.post(route, { data: {} });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: "REQUEST_UNAVAILABLE" });
  }

  await enterWorkspace(page);
  for (let index = 0; index < 8; index += 1) {
    const status = await page.evaluate(async () => (
      await fetch("/api/create/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      })
    ).status);
    expect(status).toBe(400);
  }
  const limited = await page.evaluate(async () => {
    const response = await fetch("/api/create/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    return { status: response.status, body: await response.json() as unknown };
  });
  expect(limited.status).toBe(404);
  expect(limited.body).toMatchObject({ error: "REQUEST_UNAVAILABLE" });
});

test("supports keyboard tabs and has no horizontal overflow at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterWorkspace(page);
  await generateRigid(page);
  const preview = page.getByRole("tab", { name: "Preview" });
  await preview.focus();
  await preview.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Design" })).toHaveAttribute("aria-selected", "true");
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.getByRole("tab", { name: "Fabricate" }).click();
  await expect(page.getByText("Engrave filled areas")).toBeVisible();
  await expect(page.getByText("Score centerlines")).toBeVisible();
  await expect(page.getByText("Cut contours")).toBeVisible();
});
