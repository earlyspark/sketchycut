import { mkdir } from "node:fs/promises";

import { chromium, type Locator, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m06/renders/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://localhost:3102";
const accessCode = process.env.SKETCHYCUT_VISUAL_ACCESS_CODE ?? "m6-e2e-access";
const brief = "Make a small rigid container using the reference for structure.";

async function capture(locator: Locator, name: string): Promise<void> {
  await locator.screenshot({ path: new URL(name, outputDirectory).pathname });
}

async function enterAndGenerate(page: Page): Promise<void> {
  await page.goto(baseUrl);
  await page.getByText("Judge workspace", { exact: true }).click();
  await page.getByLabel("Access code").fill(accessCode);
  await Promise.all([
    page.waitForURL("**/create"),
    page.getByRole("button", { name: "Continue" }).click()
  ]);
  await page.getByLabel(/Maker brief/).fill(brief);
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await page.getByTestId("compiled-product").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("scene-viewer").locator("canvas").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();

const publicPage = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await publicPage.goto(baseUrl);
await capture(publicPage.locator(".judge-entry"), "desktop-public-judge-entry.png");
await publicPage.close();

const desktop = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await enterAndGenerate(desktop);
await capture(desktop.locator(".generation-composer"), "desktop-generated-input.png");
await capture(desktop.locator(".workspace"), "desktop-generated-assembled-workspace.png");
await desktop.getByRole("button", { name: "Exploded", exact: true }).click();
await desktop.waitForTimeout(400);
await capture(desktop.locator(".viewer-panel"), "desktop-generated-exploded.png");
await desktop.getByRole("tab", { name: "Build" }).click();
await capture(desktop.locator(".build-linked-data"), "desktop-generated-build.png");
await desktop.getByRole("tab", { name: "Fabricate" }).click();
await capture(desktop.locator(".fabricate-layout"), "desktop-generated-fabricate.png");
await capture(desktop.locator(".handoff-section"), "desktop-generated-handoff.png");

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await enterAndGenerate(mobile);
await capture(mobile.locator(".generation-composer"), "mobile-generated-input.png");
await capture(mobile.locator(".workspace"), "mobile-generated-assembled-workspace.png");
await mobile.getByRole("tab", { name: "Fabricate" }).click();
await capture(mobile.locator(".fabricate-layout"), "mobile-generated-fabricate.png");
await capture(mobile.locator(".handoff-section"), "mobile-generated-handoff.png");

await browser.close();
process.stdout.write(
  `Captured M6 public access, protected replay generation, assembled/exploded, build, fabrication, and handoff views at desktop and 390 px from ${baseUrl}.\n`,
);
