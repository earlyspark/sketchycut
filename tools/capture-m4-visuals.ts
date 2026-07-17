import { mkdir, readFile } from "node:fs/promises";

import { chromium, type Locator, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m04/renders/", import.meta.url);
const artifactDirectory = new URL("../artifacts/m4/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3100";
const sourceDocumentHash =
  "7f8da7ff69aad348df3472bb2f0ebde7bd24c5ada8c476651c487a2c831e6712";

async function waitForSliding(page: Page): Promise<void> {
  const compiled = page.getByTestId("compiled-product");
  await compiled.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    (expectedHash) => {
      const node = document.querySelector('[data-testid="compiled-product"]');
      return node?.getAttribute("data-compile-status") === "ready" &&
        node.getAttribute("data-active-example-id") === "sliding-lid-box" &&
        node.getAttribute("data-active-structural-kind") === "captured-slide" &&
        node.getAttribute("data-source-document-hash") === expectedHash;
    },
    sourceDocumentHash,
    { timeout: 15_000 },
  );
  await page.getByTestId("scene-viewer").locator("canvas").waitFor();
  await page.waitForTimeout(500);
}

async function selectSliding(page: Page): Promise<void> {
  await page.locator(".progression-rail button").filter({ hasText: "Sliding-lid box" }).click();
  await waitForSliding(page);
}

async function capture(locator: Locator, name: string): Promise<void> {
  await locator.screenshot({ path: new URL(name, outputDirectory).pathname });
}

async function captureSvg(
  page: Page,
  sourcePath: string,
  outputName: string,
): Promise<void> {
  const source = await readFile(new URL(sourcePath, artifactDirectory), "utf8");
  await page.setContent(
    `<style>
      html,body{margin:0;background:#0b1116;display:grid;place-items:center;min-height:100%;}
      svg{width:min(96vw,1400px);height:auto;max-height:96vh;}
      #operation-cut path{stroke:#ff8c42!important;stroke-width:.35!important;}
      #operation-score path{stroke:#52d0c8!important;stroke-width:.3!important;}
    </style>${source}`,
  );
  await page.screenshot({
    path: new URL(outputName, outputDirectory).pathname,
    fullPage: true
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
const desktop = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await desktop.goto(baseUrl);
await desktop.getByTestId("compiled-product").waitFor({ state: "visible", timeout: 15_000 });
await capture(desktop.locator(".build-progression"), "desktop-basic-progression-before-promotion.png");
await selectSliding(desktop);
await capture(desktop.locator(".build-progression"), "desktop-sliding-progression.png");
await capture(desktop.locator(".fabrication-setup"), "desktop-sliding-setup.png");
await capture(desktop.locator(".workspace"), "desktop-sliding-closed-workspace.png");
await capture(desktop.locator(".viewer-panel"), "desktop-sliding-closed.png");

await desktop.getByLabel("Captured lid travel distance").fill("31");
await desktop.waitForTimeout(300);
await capture(desktop.locator(".viewer-panel"), "desktop-sliding-mid-travel.png");
await desktop.getByRole("button", { name: "Fully open", exact: true }).click();
await desktop.waitForTimeout(300);
await capture(desktop.locator(".viewer-panel"), "desktop-sliding-fully-open.png");
await desktop.getByRole("button", { name: "Removal", exact: true }).click();
await desktop.waitForTimeout(300);
await capture(desktop.locator(".viewer-panel"), "desktop-sliding-removal.png");
await capture(desktop.locator(".linked-data"), "desktop-sliding-linked-data.png");
await desktop.getByRole("button", { name: "Exploded", exact: true }).click();
await desktop.waitForTimeout(300);
await capture(desktop.locator(".viewer-panel"), "desktop-sliding-exploded.png");
await capture(desktop.locator(".sheet-panel"), "desktop-sliding-fabrication-sheet.png");
await capture(desktop.locator(".handoff-section"), "desktop-sliding-handoff.png");

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await mobile.goto(baseUrl);
await mobile.getByTestId("compiled-product").waitFor({ state: "visible", timeout: 15_000 });
await selectSliding(mobile);
await capture(mobile.locator(".build-progression"), "mobile-sliding-progression.png");
await capture(mobile.locator(".fabrication-setup"), "mobile-sliding-setup.png");
await capture(mobile.locator(".handoff-section"), "mobile-sliding-handoff.png");
await mobile.getByRole("button", { name: "Fully open", exact: true }).click();
await mobile.waitForTimeout(300);
await capture(mobile.locator(".viewer-panel"), "mobile-sliding-fully-open.png");
await mobile.getByRole("button", { name: "Removal", exact: true }).click();
await mobile.waitForTimeout(300);
await capture(mobile.locator(".viewer-panel"), "mobile-sliding-removal.png");

const projection = await browser.newPage({
  viewport: { width: 1500, height: 1050 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
for (const state of ["assembled", "closed", "open", "removal", "exploded"] as const) {
  await captureSvg(projection, `named/${state}.svg`, `named-${state}.png`);
  await captureSvg(projection, `off-family/${state}.svg`, `off-family-${state}.png`);
}
await captureSvg(projection, "named/sheet-1.svg", "named-sheet.png");
await captureSvg(projection, "off-family/sheet-1.svg", "off-family-sheet.png");

await browser.close();
process.stdout.write(
  `Captured M4 desktop/mobile progression, setup, handoff layout, linked projections, every named/off-family motion state, and fabrication sheets from ${baseUrl}.\n`,
);
