import { mkdir } from "node:fs/promises";

import { chromium, type Locator, type Page } from "@playwright/test";

const outputDirectory = new URL("../docs/evidence/m03-2/renders/", import.meta.url);
const baseUrl = process.env.SKETCHYCUT_VISUAL_URL ?? "http://127.0.0.1:3100";

async function waitForExample(
  page: Page,
  id: string,
  sourceDocumentHash: string,
): Promise<void> {
  const compiled = page.getByTestId("compiled-product");
  await compiled.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    ([expectedId, expectedHash]) => {
      const node = document.querySelector('[data-testid="compiled-product"]');
      return node?.getAttribute("data-compile-status") === "ready" &&
        node.getAttribute("data-active-example-id") === expectedId &&
        node.getAttribute("data-source-document-hash") === expectedHash;
    },
    [id, sourceDocumentHash],
    { timeout: 15_000 },
  );
}

async function capture(locator: Locator, name: string): Promise<void> {
  await locator.screenshot({ path: new URL(name, outputDirectory).pathname });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch();
const desktop = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await desktop.goto(baseUrl);
await waitForExample(
  desktop,
  "basic-box",
  "17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad",
);
await capture(desktop.locator(".build-progression"), "desktop-basic-progression.png");
await capture(desktop.locator(".workspace"), "desktop-basic-workspace.png");

await desktop.locator(".progression-rail button").filter({ hasText: "Hinged-lid box" }).click();
await waitForExample(
  desktop,
  "hinged-lid-box",
  "0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381",
);
await capture(desktop.locator(".build-progression"), "desktop-hinged-progression.png");
await capture(desktop.locator(".pin-stock-panel"), "desktop-hinged-pin-input.png");
await capture(desktop.locator(".workspace"), "desktop-hinged-closed-workspace.png");
await desktop.getByRole("button", { name: "Open", exact: true }).click();
await capture(desktop.locator(".viewer-panel"), "desktop-hinged-open.png");
await desktop.getByRole("button", { name: "Exploded", exact: true }).click();
await capture(desktop.locator(".viewer-panel"), "desktop-hinged-exploded.png");

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce"
});
await mobile.goto(baseUrl);
await waitForExample(
  mobile,
  "basic-box",
  "17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad",
);
await capture(mobile.locator(".build-progression"), "mobile-basic-progression.png");
await mobile.locator(".progression-rail button").filter({ hasText: "Hinged-lid box" }).click();
await waitForExample(
  mobile,
  "hinged-lid-box",
  "0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381",
);
await capture(mobile.locator(".build-progression"), "mobile-hinged-progression.png");
await capture(mobile.locator(".pin-stock-panel"), "mobile-hinged-pin-input.png");
await mobile.getByRole("button", { name: "Open", exact: true }).click();
await capture(mobile.locator(".viewer-panel"), "mobile-hinged-open.png");

await browser.close();
process.stdout.write(
  `Captured M3.2 desktop/mobile Basic and Hinged progression, capability input, and geometry states from ${baseUrl}.\n`,
);
