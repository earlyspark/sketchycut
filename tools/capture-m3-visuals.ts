import { mkdir, readFile } from "node:fs/promises";

import { chromium, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m03/renders/", import.meta.url);
const artifactDirectory = new URL("../artifacts/m3/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3101";

async function captureSvg(page: Page, sourcePath: string, outputName: string): Promise<void> {
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
  path: new URL("named-closed.png", outputDirectory).pathname
});
await page.getByLabel("Retained pin motion angle").fill("52");
await page.waitForTimeout(500);
await page.locator(".viewer-canvas").screenshot({
  path: new URL("named-mid-travel.png", outputDirectory).pathname
});
await page.getByRole("button", { name: "Open", exact: true }).click();
await page.waitForTimeout(500);
await page.locator(".viewer-canvas").screenshot({
  path: new URL("named-open.png", outputDirectory).pathname
});
await page.getByRole("button", { name: "Exploded" }).click();
await page.waitForTimeout(500);
await page.locator(".viewer-canvas").screenshot({
  path: new URL("named-exploded.png", outputDirectory).pathname
});
await page.locator(".sheet-stage").screenshot({
  path: new URL("named-sheet.png", outputDirectory).pathname
});

await captureSvg(page, "off-family/assembled.svg", "off-family-assembled.png");
await captureSvg(page, "off-family/open.svg", "off-family-open.png");
await captureSvg(page, "off-family/exploded.svg", "off-family-exploded.png");
await captureSvg(page, "off-family/sheet-1.svg", "off-family-sheet.png");
await browser.close();

process.stdout.write(
  `Captured M3 closed/mid/open/exploded application states and off-family projection evidence from ${baseUrl}.\n`,
);
