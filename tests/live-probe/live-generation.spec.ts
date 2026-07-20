import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// One explicitly authorized deployed live Sol dispatch through the protected /create
// flow, using the current rigid brief and synthetic sample reference.
// The durable semantic cache must be cleared beforehand so the request
// misses cache and reaches the model exactly once.
const ACCESS_CODE = process.env.SKETCHYCUT_E2E_ACCESS_CODE ?? "";
const RIGID_BRIEF = "Make a small rigid container using the reference for structure.";
const OUTCOME_PATH = resolve(
  process.env.SKETCHYCUT_LIVE_OUTCOME_PATH ?? "artifacts/live-probe/live-evaluation.json",
);

async function enterWorkspace(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByText("Judge Access", { exact: true }).click();
  await page.getByLabel("Access code").fill(ACCESS_CODE);
  await Promise.all([
    page.waitForURL("**/create"),
    page.getByRole("button", { name: "Submit" }).click()
  ]);
}

test("performs exactly one deployed live Sol generation", async ({ page }) => {
  let generationRequests = 0;
  let generationResponse: unknown = null;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/create/generate")) generationRequests += 1;
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/api/create/generate")) {
      void response.json().then((body) => { generationResponse = body; }).catch(() => undefined);
    }
  });

  await enterWorkspace(page);
  await page.getByLabel("Prompt").fill(RIGID_BRIEF);
  await page.getByRole("button", { name: "Use a synthetic sample" }).click();
  await page.getByRole("button", { name: "Generate project" }).click();
  await expect(page.getByTestId("compiled-product")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("compiled-product")).toHaveAttribute("data-compile-status", "ready");
  expect(generationRequests).toBe(1);

  await expect.poll(() => generationResponse).not.toBeNull();
  const body = generationResponse as {
    outcome: {
      kind: string;
      transportMode: string;
      attempt: { attemptId?: string } | null;
    };
    project: { projectId: string; lastGeometryHash: string; lastDocumentHash: string } | null;
  };
  expect(body.outcome.transportMode).toBe("live");
  expect(["supported", "simplified"]).toContain(body.outcome.kind);
  expect(body.project).not.toBeNull();

  const workspace = page.getByTestId("compiled-product");
  const record = {
    recordedAt: new Date().toISOString(),
    deploymentUrl: process.env.SKETCHYCUT_DEPLOYMENT_URL,
    generationRequests,
    outcomeKind: body.outcome.kind,
    transportMode: body.outcome.transportMode,
    attempt: body.outcome.attempt,
    project: body.project,
    workspaceGeometryHash: await workspace.getAttribute("data-geometry-hash"),
    workspaceDocumentHash: await workspace.getAttribute("data-source-document-hash")
  };
  mkdirSync(dirname(OUTCOME_PATH), { recursive: true });
  writeFileSync(OUTCOME_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await page.screenshot({
    path: resolve(dirname(OUTCOME_PATH), "deployed-terra-workspace.png"),
    fullPage: false
  });
});
