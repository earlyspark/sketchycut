import { mkdir, readFile } from "node:fs/promises";

import { chromium, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m03-1/renders/", import.meta.url);
const artifactDirectory = new URL("../artifacts/m3.1/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3101";

async function waitReady(page: Page): Promise<void> {
  await page.getByText("Deterministic checks passed").waitFor({ timeout: 15_000 });
}

async function screenshot(
  page: Page,
  name: string,
  selector?: string,
): Promise<void> {
  await page.waitForTimeout(250);
  const path = new URL(name, outputDirectory).pathname;
  if (selector === undefined) await page.screenshot({ path, fullPage: true });
  else await page.locator(selector).screenshot({ path });
}

async function captureFixtureSvg(page: Page): Promise<void> {
  const svg = await readFile(new URL("fixture/sheet-1.svg", artifactDirectory), "utf8");
  await page.setContent(`<style>
    html,body{margin:0;background:#0b1116;display:grid;place-items:center;min-height:100%;}
    svg{width:min(96vw,1480px);height:auto;}
    #operation-cut path{stroke:#ff8c42!important;stroke-width:.35!important;}
    #operation-score path{stroke:#52d0c8!important;stroke-width:.3!important;}
  </style>${svg}`);
  await page.locator("svg").evaluate((element) => {
    const drawing = element.querySelector<SVGGElement>("#operation-cut");
    if (drawing === null) return;
    const bounds = drawing.getBBox();
    const padding = 5;
    element.setAttribute(
      "viewBox",
      `${String(bounds.x - padding)} ${String(bounds.y - padding)} ${String(bounds.width + padding * 2)} ${String(bounds.height + padding * 2)}`,
    );
  });
  await page.screenshot({
    path: new URL("fixture-sheet-simplified.png", outputDirectory).pathname,
    fullPage: true
  });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 1 });
await desktop.goto(baseUrl);
await waitReady(desktop);
await screenshot(desktop, "desktop-simplified-starter.png", ".fabrication-setup");
await screenshot(desktop, "desktop-simplified-assembled.png", ".viewer-panel");

await desktop.getByRole("radio", { name: /3 mm laser-grade birch plywood/ }).check();
await screenshot(desktop, "desktop-simplified-stock-stale.png", ".fabrication-setup");
await desktop.getByRole("button", { name: "Discard changes" }).click();
await desktop.getByLabel("I measured this pin").check();
await screenshot(desktop, "desktop-simplified-invalid-pin.png", ".pin-and-fixture-utility");

await desktop.reload();
await waitReady(desktop);
await desktop.getByRole("button", { name: "Open", exact: true }).click();
await screenshot(desktop, "desktop-simplified-open.png", ".viewer-panel");
await desktop.getByLabel("Retained pin motion angle").fill("47");
await screenshot(desktop, "desktop-simplified-mid-travel.png", ".viewer-panel");
await desktop.getByRole("button", { name: "Exploded" }).click();
await screenshot(desktop, "desktop-simplified-exploded.png", ".viewer-panel");

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto(baseUrl);
await waitReady(mobile);
await screenshot(mobile, "mobile-simplified-starter.png", ".fabrication-setup");
await mobile.getByRole("button", { name: "Open", exact: true }).click();
await screenshot(mobile, "mobile-simplified-open.png", ".viewer-panel");

const svgPage = await browser.newPage({ viewport: { width: 1500, height: 420 }, deviceScaleFactor: 1 });
await captureFixtureSvg(svgPage);
await browser.close();

process.stdout.write(
  `Captured M3.1 simplified starter, draft isolation, independent fixture, assembled/exploded, and generic motion evidence from ${baseUrl}.\n`,
);
