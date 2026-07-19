import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Locator, type Page } from "@playwright/test";

import { buildDevelopmentEnvironment, GENERATION_FIXTURE_ACCESS_CODE } from "./development.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceRoot = path.join(repositoryRoot, "docs/evidence/m06-2");
const captureRoot = path.join(evidenceRoot, "captures");
const reportRoot = path.join(evidenceRoot, "reports");
const baseUrl = "http://localhost:3103";

type CaptureRecord = {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  viewport: { width: number; height: number };
};

type ContrastRecord = {
  name: string;
  foreground: string;
  background: string;
  ratio: number;
  minimum: number;
  passes: boolean;
};

type LayoutShiftRecord = {
  name: string;
  cumulativeLayoutShift: number;
  maximum: number;
  entryCount: number;
  passes: boolean;
};

type IntrinsicSizeRecord = {
  name: string;
  viewport: { width: number; height: number };
  contentVisibility: string;
  containIntrinsicSize: string;
  configuredFallbackPx: number;
  measuredHeightPx: number;
  relativeDelta: number;
  maximumRelativeDelta: number;
  passes: boolean;
};

type LayoutShiftState = {
  entries: number[];
};

const desktopViewport = { width: 1440, height: 1100 } as const;
const mobileViewport = { width: 390, height: 844 } as const;
const maximumLayoutShift = 0.1;
const maximumIntrinsicSizeDelta = 0.5;
const manualReviewConfirmed = process.argv.includes("--manual-review-confirmed");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The loopback server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("CURRENT_EVIDENCE_SERVER_TIMEOUT");
}

async function capture(
  page: Page,
  records: CaptureRecord[],
  name: string,
  viewport: { width: number; height: number },
  target?: Locator,
  fullPage = true,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);
  const destination = path.join(captureRoot, `${name}.png`);
  const bytes = target === undefined
    ? await page.screenshot({ path: destination, fullPage, animations: "disabled" })
    : await target.screenshot({ path: destination, animations: "disabled" });
  records.push({
    name,
    path: path.relative(repositoryRoot, destination),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
    viewport
  });
}

async function enterCreate(page: Page): Promise<void> {
  const response = await page.context().request.post(`${baseUrl}/api/session`, {
    form: { accessCode: GENERATION_FIXTURE_ACCESS_CODE },
    headers: { origin: baseUrl },
    maxRedirects: 0
  });
  if (response.status() !== 303) throw new Error(`CURRENT_EVIDENCE_SESSION:${String(response.status())}`);
  await page.goto(`${baseUrl}/create`);
  await page.getByRole("heading", { name: "Describe what you want to make" }).waitFor();
}

async function waitForWorkspace(page: Page): Promise<void> {
  const workspace = page.getByTestId("compiled-product");
  await workspace.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="compiled-product"]')
    ?.getAttribute("data-compile-status") === "ready");
  await page.locator("canvas").first().waitFor({ state: "visible" });
  await page.waitForTimeout(250);
}

async function waitForExample(page: Page, exampleId: string): Promise<void> {
  await page.waitForFunction((id) => document.querySelector('[data-testid="compiled-product"]')
    ?.getAttribute("data-active-example-id") === id, exampleId);
  await waitForWorkspace(page);
}

function parseRgb(value: string): [number, number, number] {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (match === null) throw new Error(`CURRENT_EVIDENCE_COLOR_UNSUPPORTED:${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

async function contrast(name: string, locator: Locator, minimum = 4.5): Promise<ContrastRecord> {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    let background = style.backgroundColor;
    let ancestor = element.parentElement;
    while ((background === "rgba(0, 0, 0, 0)" || background === "transparent") && ancestor !== null) {
      background = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    return { foreground: style.color, background };
  });
  const foreground = luminance(parseRgb(colors.foreground));
  const background = luminance(parseRgb(colors.background));
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  return {
    name,
    ...colors,
    ratio: Number(ratio.toFixed(2)),
    minimum,
    passes: ratio >= minimum
  };
}

async function resetLayoutShift(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (globalThis as typeof globalThis & {
      __sketchycutLayoutShift?: LayoutShiftState;
    }).__sketchycutLayoutShift;
    if (state !== undefined) state.entries.length = 0;
  });
}

async function measureLayoutShift(page: Page, name: string): Promise<LayoutShiftRecord> {
  await page.waitForTimeout(150);
  const entries = await page.evaluate(() => (
    (globalThis as typeof globalThis & {
      __sketchycutLayoutShift?: LayoutShiftState;
    }).__sketchycutLayoutShift?.entries ?? []
  ));
  const cumulativeLayoutShift = entries.reduce((sum, value) => sum + value, 0);
  return {
    name,
    cumulativeLayoutShift: Number(cumulativeLayoutShift.toFixed(5)),
    maximum: maximumLayoutShift,
    entryCount: entries.length,
    passes: cumulativeLayoutShift <= maximumLayoutShift
  };
}

async function measureWorkspaceIntrinsicSizes(
  page: Page,
  surface: string,
  viewport: { width: number; height: number },
): Promise<IntrinsicSizeRecord[]> {
  const records: IntrinsicSizeRecord[] = [];
  const sectionBodies = page.locator(".workspace-section > .workspace-section-body");
  const count = await sectionBodies.count();
  for (let index = 0; index < count; index += 1) {
    const body = sectionBodies.nth(index);
    await body.scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const measured = await body.evaluate((element) => {
      const style = getComputedStyle(element);
      const values = [...style.containIntrinsicSize.matchAll(/([\d.]+)px/g)];
      const fallback = Number(values.at(-1)?.[1] ?? "NaN");
      const section = element.closest(".workspace-section");
      return {
        sectionId: section?.id ?? `section-${String(index + 1)}`,
        contentVisibility: style.contentVisibility,
        containIntrinsicSize: style.containIntrinsicSize,
        configuredFallbackPx: fallback,
        measuredHeightPx: element.getBoundingClientRect().height
      };
    });
    const relativeDelta = Math.abs(measured.measuredHeightPx - measured.configuredFallbackPx)
      / Math.max(measured.measuredHeightPx, measured.configuredFallbackPx);
    records.push({
      name: `${surface}-${measured.sectionId}`,
      viewport,
      contentVisibility: measured.contentVisibility,
      containIntrinsicSize: measured.containIntrinsicSize,
      configuredFallbackPx: Number(measured.configuredFallbackPx.toFixed(2)),
      measuredHeightPx: Number(measured.measuredHeightPx.toFixed(2)),
      relativeDelta: Number(relativeDelta.toFixed(4)),
      maximumRelativeDelta: maximumIntrinsicSizeDelta,
      passes: measured.contentVisibility === "auto"
        && Number.isFinite(measured.configuredFallbackPx)
        && measured.configuredFallbackPx > 0
        && measured.measuredHeightPx > 0
        && relativeDelta <= maximumIntrinsicSizeDelta
    });
  }
  return records;
}

await mkdir(captureRoot, { recursive: true });
await mkdir(reportRoot, { recursive: true });

const environment = buildDevelopmentEnvironment("fixtures", {
  ...process.env,
  NODE_ENV: "production"
});
const server = spawn(
  process.execPath,
  [path.join(repositoryRoot, "node_modules/next/dist/bin/next"), "start", "-p", "3103"],
  { cwd: repositoryRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] },
);
let serverOutput = "";
server.stdout.on("data", (chunk: Buffer) => { serverOutput += chunk.toString("utf8"); });
server.stderr.on("data", (chunk: Buffer) => { serverOutput += chunk.toString("utf8"); });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ reducedMotion: "reduce" });
await context.addInitScript(() => {
  const state: LayoutShiftState = { entries: [] };
  (globalThis as typeof globalThis & { __sketchycutLayoutShift?: LayoutShiftState })
    .__sketchycutLayoutShift = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const candidate = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (candidate.hadRecentInput !== true && typeof candidate.value === "number") {
        state.entries.push(candidate.value);
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
});
const page = await context.newPage();
const externalRequests: string[] = [];
page.on("request", (request) => {
  if (request.url().includes("api.openai.com")) externalRequests.push(request.url());
});

const captures: CaptureRecord[] = [];
const accessibilitySnapshots: Record<string, string> = {};
const contrastChecks: ContrastRecord[] = [];
const layoutShiftChecks: LayoutShiftRecord[] = [];
const intrinsicSizeChecks: IntrinsicSizeRecord[] = [];
try {
  await waitForServer();

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/`);
  await page.getByRole("heading", { name: "From idea to laser-cut 3D construction" }).waitFor();
  await page.locator(".landing-demo canvas").waitFor();
  layoutShiftChecks.push(await measureLayoutShift(page, "home-lazy-canvas"));
  accessibilitySnapshots.homeDesktop = await page.locator("body").ariaSnapshot();
  contrastChecks.push(await contrast("home-primary-heading", page.getByRole("heading", { level: 1 })));
  contrastChecks.push(await contrast("home-primary-action", page.getByRole("link", { name: "See the example", exact: true }).last()));
  await capture(page, captures, "home-desktop", { width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Exploded" }).click();
  await capture(page, captures, "home-exploded-desktop", { width: 1440, height: 1100 }, page.locator(".landing-demo"));
  await page.getByRole("button", { name: "Assembled" }).click();
  await capture(page, captures, "home-mobile", { width: 390, height: 844 });
  accessibilitySnapshots.homeMobile = await page.locator("body").ariaSnapshot();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByText("Judge Access", { exact: true }).click();
  contrastChecks.push(await contrast("judge-submit", page.getByRole("button", { name: "Submit" })));
  await page.getByText("Judge Access", { exact: true }).click();

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/examples`);
  await resetLayoutShift(page);
  await waitForWorkspace(page);
  layoutShiftChecks.push(await measureLayoutShift(page, "examples-workspace-load"));
  accessibilitySnapshots.examplesDesktop = await page.locator("body").ariaSnapshot();
  intrinsicSizeChecks.push(...await measureWorkspaceIntrinsicSizes(page, "examples-desktop", desktopViewport));
  await capture(page, captures, "examples-basic-desktop", { width: 1440, height: 1100 }, undefined, false);
  await capture(page, captures, "examples-basic-mobile", { width: 390, height: 844 }, undefined, false);
  accessibilitySnapshots.examplesMobile = await page.locator("body").ariaSnapshot();
  intrinsicSizeChecks.push(...await measureWorkspaceIntrinsicSizes(page, "examples-mobile", mobileViewport));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Hinged-lid box", exact: true }).click();
  await waitForExample(page, "hinged-lid-box");
  await capture(page, captures, "examples-hinged-preview", { width: 1440, height: 1100 }, page.locator("#workspace-panel-preview"));
  await page.getByRole("button", { name: "Sliding-lid box", exact: true }).click();
  await waitForExample(page, "sliding-lid-box");
  await capture(page, captures, "examples-sliding-preview", { width: 1440, height: 1100 }, page.locator("#workspace-panel-preview"));

  await page.setViewportSize({ width: 1440, height: 1100 });
  await enterCreate(page);
  await resetLayoutShift(page);
  accessibilitySnapshots.createComposer = await page.locator("body").ariaSnapshot();
  contrastChecks.push(await contrast("create-generate-button", page.getByRole("button", { name: "Generate project" })));
  await capture(page, captures, "create-composer-desktop", { width: 1440, height: 1100 });
  await capture(page, captures, "create-composer-mobile", { width: 390, height: 844 });
  accessibilitySnapshots.createComposerMobile = await page.locator("body").ariaSnapshot();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel("Fixture scenario").selectOption(
    "Make a small rigid container using the reference for structure.",
  );
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await waitForWorkspace(page);
  layoutShiftChecks.push(await measureLayoutShift(page, "create-workspace-load"));
  accessibilitySnapshots.createGenerated = await page.locator("body").ariaSnapshot();
  intrinsicSizeChecks.push(...await measureWorkspaceIntrinsicSizes(page, "create-desktop", desktopViewport));
  await capture(page, captures, "create-generated-desktop", { width: 1440, height: 1100 }, page.locator(".generation-outcome"));
  await capture(page, captures, "create-generated-mobile", { width: 390, height: 844 }, page.locator(".generation-outcome"));
  await capture(page, captures, "create-generated-preview-desktop", { width: 1440, height: 1100 }, page.locator("#workspace-panel-preview"));
  await capture(page, captures, "create-generated-preview-mobile", { width: 390, height: 844 }, page.locator("#workspace-panel-preview"));
  accessibilitySnapshots.createGeneratedMobile = await page.locator("body").ariaSnapshot();
  intrinsicSizeChecks.push(...await measureWorkspaceIntrinsicSizes(page, "create-mobile", mobileViewport));

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/about`);
  await page.getByRole("heading", { name: "About SketchyCut" }).waitFor();
  accessibilitySnapshots.aboutDesktop = await page.locator("body").ariaSnapshot();
  await capture(page, captures, "about-desktop", { width: 1440, height: 1100 });

  if (externalRequests.length > 0) throw new Error("CURRENT_EVIDENCE_EXTERNAL_MODEL_REQUEST");
  if (contrastChecks.some((check) => !check.passes)) throw new Error("CURRENT_EVIDENCE_CONTRAST_FAILURE");
  const failedLayoutShifts = layoutShiftChecks.filter((check) => !check.passes);
  if (failedLayoutShifts.length > 0) {
    throw new Error(`CURRENT_EVIDENCE_LAYOUT_SHIFT_FAILURE:${JSON.stringify(failedLayoutShifts)}`);
  }
  const failedIntrinsicSizes = intrinsicSizeChecks.filter((check) => !check.passes);
  if (failedIntrinsicSizes.length > 0) {
    throw new Error(`CURRENT_EVIDENCE_INTRINSIC_SIZE_FAILURE:${JSON.stringify(failedIntrinsicSizes)}`);
  }
  if (!manualReviewConfirmed) throw new Error("CURRENT_EVIDENCE_MANUAL_REVIEW_REQUIRED");

  await writeFile(
    path.join(reportRoot, "visual-capture-report.json"),
    `${JSON.stringify({
      schemaVersion: "sketchycut-current-visual-capture@1.0.0",
      generatedAt: new Date().toISOString(),
      mode: "fixture-zero-model-call",
      productionOriginReviewed: "https://sketchycut.earlyspark.com",
      browserVersion: browser.version(),
      captures,
      externalModelRequests: externalRequests.length,
      layoutShiftChecks,
      intrinsicSizeChecks,
      manualVisualReview: {
        confirmed: true,
        criteria: [
          "desktop and 390 px composition is coherent and overflow-free",
          "assembled and exploded landing states remain fully framed",
          "continuous workspace sections retain readable hierarchy and spacing",
          "selection and operation states remain distinguishable without color alone"
        ]
      }
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(reportRoot, "accessibility-snapshots.json"),
    `${JSON.stringify({
      schemaVersion: "sketchycut-current-accessibility@1.0.0",
      generatedAt: new Date().toISOString(),
      snapshots: accessibilitySnapshots
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(reportRoot, "contrast-report.json"),
    `${JSON.stringify({
      schemaVersion: "sketchycut-current-contrast@1.0.0",
      standard: "WCAG 2 contrast ratio for normal text",
      checks: contrastChecks
    }, null, 2)}\n`,
  );
  const reportBytes = await Promise.all(
    ["visual-capture-report.json", "accessibility-snapshots.json", "contrast-report.json"]
      .map((name) => readFile(path.join(reportRoot, name))),
  );
  if (reportBytes.some((bytes) => bytes.byteLength === 0)) {
    throw new Error("CURRENT_EVIDENCE_REPORT_EMPTY");
  }
  process.stdout.write(`Captured ${String(captures.length)} current views with ${String(contrastChecks.length)} passing contrast checks.\n`);
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\n${serverOutput}`, { cause: error });
} finally {
  await page.close();
  await context.close();
  await browser.close();
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  ]);
}
