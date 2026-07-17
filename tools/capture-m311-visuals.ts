import { mkdir, readFile } from "node:fs/promises";

import { chromium, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m03-1-1/renders/", import.meta.url);
const artifactDirectory = new URL("../artifacts/m3.1.1/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3101";

async function waitReady(page: Page): Promise<void> {
  await page.getByText("Deterministic checks passed").waitFor({ timeout: 15_000 });
  await page.getByRole("heading", { name: "xTool Studio setup checklist" }).waitFor({ timeout: 15_000 });
}

async function screenshot(page: Page, name: string, selector: string): Promise<void> {
  await page.waitForTimeout(200);
  await page.locator(selector).screenshot({ path: new URL(name, outputDirectory).pathname });
}

async function captureSvg(page: Page, source: URL, name: string): Promise<void> {
  const svg = await readFile(source, "utf8");
  await page.setContent(`<style>
    html,body{margin:0;background:#0b1116;display:grid;place-items:center;min-height:100%;}
    svg{width:min(96vw,1480px);height:auto;}
    #operation-cut path{stroke:#ff8c42!important;stroke-width:.35!important;}
    #operation-score path{stroke:#52d0c8!important;stroke-width:.3!important;}
  </style>${svg}`);
  await page.screenshot({ path: new URL(name, outputDirectory).pathname, fullPage: true });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 1 });
await desktop.goto(baseUrl);
await waitReady(desktop);
await screenshot(desktop, "desktop-applied-setup.png", ".fabrication-setup");
await screenshot(desktop, "desktop-applied-handoff.png", ".handoff-panel");
await screenshot(desktop, "desktop-assembled.png", ".viewer-panel");

await desktop.getByLabel("I measured this pin").check();
await desktop.getByLabel("Actual pin diameter").fill("2.97");
await screenshot(desktop, "desktop-valid-pin-stale.png", ".fabrication-setup");
await screenshot(desktop, "desktop-last-applied-handoff.png", ".handoff-panel");
await desktop.getByLabel("Actual pin diameter").fill("");
await screenshot(desktop, "desktop-invalid-pin.png", ".fabrication-setup");
await desktop.getByRole("button", { name: "Discard changes" }).click();

await desktop.getByRole("button", { name: "Open", exact: true }).click();
await screenshot(desktop, "desktop-open.png", ".viewer-panel");
await desktop.getByRole("button", { name: "Exploded" }).click();
await screenshot(desktop, "desktop-exploded.png", ".viewer-panel");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(baseUrl);
await waitReady(mobile);
await screenshot(mobile, "mobile-applied-setup.png", ".fabrication-setup");
await screenshot(mobile, "mobile-applied-handoff.png", ".handoff-panel");

const svgPage = await browser.newPage({ viewport: { width: 1500, height: 700 }, deviceScaleFactor: 1 });
await captureSvg(svgPage, new URL("product/sheet-1.svg", artifactDirectory), "product-sheet-1.png");
await captureSvg(svgPage, new URL("optional-cut-width-fit-test/sheet-1.svg", artifactDirectory), "optional-fit-test-sheet-1.png");
await browser.close();

process.stdout.write(
  `Captured M3.1.1 applied/stale setup and handoff, mobile reflow, assembled/open/exploded scene, and both final SVG groups from ${baseUrl}.\n`,
);
