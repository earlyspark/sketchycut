import { mkdir } from "node:fs/promises";

import { chromium } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m02/renders/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3101";

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1500, height: 1050 },
  deviceScaleFactor: 1
});
await page.goto(baseUrl);
await page.getByText("Deterministic checks passed").waitFor({ timeout: 15_000 });
await page.getByTestId("scene-viewer").locator("canvas").waitFor();
await page.waitForTimeout(800);
await page.screenshot({
  path: new URL("app-overview.png", outputDirectory).pathname,
  fullPage: true
});
await page.locator(".viewer-canvas").screenshot({
  path: new URL("assembled.png", outputDirectory).pathname
});
await page.getByRole("button", { name: "Exploded" }).click();
await page.waitForTimeout(800);
await page.locator(".viewer-canvas").screenshot({
  path: new URL("exploded.png", outputDirectory).pathname
});
await browser.close();

process.stdout.write(`Captured M2 application and scene evidence from ${baseUrl}.\n`);
