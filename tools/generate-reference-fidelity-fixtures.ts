import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const repositoryRoot = process.cwd();
const referenceRoot = path.join(
  repositoryRoot,
  "tests",
  "fixtures",
  "reference-fidelity",
  "references",
);

async function main(): Promise<void> {
  const sources = (await readdir(referenceRoot)).filter((name) => name.endsWith(".svg")).sort();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    for (const source of sources) {
      await page.goto(pathToFileURL(path.join(referenceRoot, source)).href, { waitUntil: "load" });
      await page.screenshot({
        path: path.join(referenceRoot, source.replace(/\.svg$/u, ".png")),
        type: "png",
        animations: "disabled",
        caret: "hide",
        scale: "css"
      });
    }
  } finally {
    await browser.close();
  }
}

await main();
