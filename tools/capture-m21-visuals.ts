import { mkdir, readFile } from "node:fs/promises";

import { chromium, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m02-1/renders/", import.meta.url);
const artifactDirectory = new URL("../artifacts/m2.1/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3101";

async function captureSvg(
  page: Page,
  sourceUrl: URL,
  outputName: string,
  crop?: { widthPx: number; heightPx: number; viewBox: string },
): Promise<void> {
  const source = await readFile(sourceUrl, "utf8");
  const svg = crop === undefined
    ? source
    : source.replace(
        /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>/,
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(crop.widthPx)}px" height="${String(crop.heightPx)}px" viewBox="${crop.viewBox}">`,
      );
  await page.setContent(
    `<style>
      html,body{margin:0;background:#0b1116;display:grid;place-items:center;min-height:100%;}
      svg{max-width:96vw;max-height:96vh;}
      #operation-cut path{stroke:#ff8c42!important;stroke-width:.35!important;}
      #operation-score path{stroke:#52d0c8!important;stroke-width:.3!important;}
    </style>${svg}`,
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
  path: new URL("assembled.png", outputDirectory).pathname
});
await page.getByRole("button", { name: "Exploded" }).click();
await page.waitForTimeout(800);
await page.locator(".viewer-canvas").screenshot({
  path: new URL("exploded.png", outputDirectory).pathname
});
await page.getByLabel("Measured full kerf X").fill("0.30");
await page.getByLabel("Measured full kerf Y").fill("0.30");
await page.getByText("Deterministic checks passed").waitFor({ timeout: 15_000 });
await page.locator(".controls").screenshot({
  path: new URL("measured-input-controls.png", outputDirectory).pathname
});
await captureSvg(
  page,
  new URL("gauge/sheet-1.svg", artifactDirectory),
  "accumulated-kerf-sheet.png",
  { widthPx: 1480, heightPx: 200, viewBox: "0 300 148 20" },
);
await captureSvg(
  page,
  new URL("gauge/assembled.svg", artifactDirectory),
  "accumulated-kerf-assembled.png",
);
await captureSvg(
  page,
  new URL("gauge/exploded.svg", artifactDirectory),
  "accumulated-kerf-exploded.png",
);
await browser.close();

process.stdout.write(`Captured M2.1 UI, assembled/exploded scenes, and kerf fixture from ${baseUrl}.\n`);
