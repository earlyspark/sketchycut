import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  LiveCallAttempt
} from "../../src/interpretation/live-ledger.js";
import { MemoryGenerationStore } from "../../src/server/generation/memory-store.js";
import {
  parseBillingReconciliationCommandArguments,
  runBillingReconciliationCommand
} from "../../tools/generation-billing-reconciliation-command.js";

const temporaryDirectories: string[] = [];

async function localEvidenceFile(content: string): Promise<string> {
  const directory = await mkdtemp(path.join(
    tmpdir(),
    "sketchycut-billing-reconciliation-",
  ));
  temporaryDirectories.push(directory);
  const evidenceFile = path.join(directory, "provider-evidence.txt");
  await writeFile(evidenceFile, content, "utf8");
  return evidenceFile;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

function ambiguousAttempt(): LiveCallAttempt {
  return {
    schemaVersion: "1.0",
    attemptId: "attempt-ambiguous",
    submissionId: "submission-ambiguous",
    retryChainId: "retry-chain-ambiguous",
    retryOfAttemptId: null,
    initiatedBy: "live-eval",
    runtimeOrigin: "local-development",
    attemptOrdinal: 1,
    semanticRequestDigest: "a".repeat(64),
    promptHash: "b".repeat(64),
    schemaHash: "c".repeat(64),
    capabilityCatalogHash: "d".repeat(64),
    modelConfigurationHash: "e".repeat(64),
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    imageDetailPolicy: "high",
    promptLayoutVersion: "stable-prefix-current-v5",
    clientRequestId: "client-request-ambiguous",
    providerRequestId: null,
    providerModelId: null,
    responseId: null,
    finishState: "not-observed",
    dispatchState: "transport-handoff",
    outcome: "ambiguous-transport",
    occurredAt: "2026-07-23T22:28:13.060Z",
    latencyMs: 36,
    cacheResult: "miss",
    errorCode: "OPENAI_TRANSPORT_FAILURE",
    networkDispatchCount: 1,
    strictParse: "not-attempted",
    supportStateCorrect: null,
    deterministicCompile: "not-run",
    usage: { status: "unavailable", reason: "no-response" },
    billing: {
      state: "potentially-billed",
      estimatedCostUsd: null,
      requestBudgetUpperBoundUsd: 0.65,
      priceSnapshotId: "openai-public-pricing-2026-07-19-gpt-5-6-sol"
    }
  };
}

describe("billing reconciliation command", () => {
  it("requires attributed provider support evidence for a response-free attempt", async () => {
    const store = new MemoryGenerationStore();
    await store.appendLedgerAttempt(ambiguousAttempt());
    const evidenceFile = await localEvidenceFile(
      "Aggregate usage data without exact request attribution.",
    );
    const arguments_ = parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-usage-api",
      "--result", "confirmed-not-billed",
      "--actual-cost-usd", "0",
      "--evidence-file", evidenceFile,
      "--note", "Aggregate evidence cannot identify the request."
    ]);
    await expect(runBillingReconciliationCommand({
      store,
      arguments: arguments_
    })).rejects.toThrow(
      "GENERATION_BILLING_RECONCILIATION_CONCLUSIVE_ATTRIBUTION_REQUIRED",
    );
    expect(await store.readBillingReconciliations()).toEqual([]);
  });

  it("keeps dry-run read-only and appends one conclusive record without refunding exposure", async () => {
    const store = new MemoryGenerationStore();
    await store.appendLedgerAttempt(ambiguousAttempt());
    const evidenceContent =
      "Provider support attributed the request and confirmed its exact cost.";
    const evidenceFile = await localEvidenceFile(evidenceContent);
    const expectedDigest = createHash("sha256")
      .update(evidenceContent)
      .digest("hex");
    const arguments_ = parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-support",
      "--result", "confirmed-billed",
      "--actual-cost-usd", "0.012345",
      "--evidence-file", evidenceFile,
      "--note", "Provider support attributed the request and cost."
    ]);
    const dryRun = await runBillingReconciliationCommand({
      store,
      arguments: arguments_,
      now: new Date("2026-07-24T01:00:00.000Z"),
      reconciliationId: "reconciliation-dry-run"
    });
    expect(dryRun).toMatchObject({ applied: false });
    expect(dryRun.output).toContain(
      "Unresolved potentially billed exposure after: $0.00",
    );
    expect(dryRun.output).toContain(`Evidence SHA-256: ${expectedDigest}`);
    expect(dryRun.output).not.toContain(evidenceFile);
    expect(dryRun.output).not.toContain(evidenceContent);
    expect(await store.readBillingReconciliations()).toEqual([]);

    const applied = await runBillingReconciliationCommand({
      store,
      arguments: { ...arguments_, apply: true },
      now: new Date("2026-07-24T01:00:00.000Z"),
      reconciliationId: "reconciliation-applied"
    });
    expect(applied).toMatchObject({ applied: true });
    expect(applied.output).not.toContain(evidenceFile);
    expect(applied.output).not.toContain(evidenceContent);
    const reconciliations = await store.readBillingReconciliations();
    expect(reconciliations).toHaveLength(1);
    expect(reconciliations[0]!.evidenceDigest).toBe(expectedDigest);
    expect(JSON.stringify(reconciliations)).not.toContain(evidenceFile);
    expect(JSON.stringify(reconciliations)).not.toContain(evidenceContent);
    expect((await store.readLedgerAttempts())[0]!.billing.state).toBe(
      "potentially-billed",
    );
    expect((await store.readGlobalExposureState()).reservedExposureMicrousd)
      .toBe(0);
  });

  it("parses inconclusive evidence without pretending it clears exposure", async () => {
    const store = new MemoryGenerationStore();
    await store.appendLedgerAttempt(ambiguousAttempt());
    const arguments_ = parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-usage-dashboard",
      "--result", "aggregate-only",
      "--note", "The aggregate record is not request-attributed."
    ]);
    const result = await runBillingReconciliationCommand({
      store,
      arguments: { ...arguments_, apply: true },
      reconciliationId: "reconciliation-aggregate",
      now: new Date("2026-07-24T01:00:00.000Z")
    });
    expect(result.output).toContain(
      "Unresolved potentially billed exposure after: $0.65",
    );
  });

  it("settles an exhausted lookup at the complete administrative bound without inventing provider cost", async () => {
    const store = new MemoryGenerationStore();
    const originalAttempt = ambiguousAttempt();
    await store.appendLedgerAttempt(originalAttempt);
    const evidenceContent = [
      "Provider usage dashboard checked: aggregate-only.",
      "Provider usage API checked: no request-level attribution.",
      "Provider support path checked: exact attribution unavailable."
    ].join("\n");
    const evidenceFile = await localEvidenceFile(evidenceContent);
    const expectedDigest = createHash("sha256")
      .update(evidenceContent)
      .digest("hex");
    const arguments_ = parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "administrative-exhaustion",
      "--result", "administrative-full-bound",
      "--evidence-file", evidenceFile,
      "--note", "All registered attribution paths were exhausted; retain the complete request bound."
    ]);
    const applied = await runBillingReconciliationCommand({
      store,
      arguments: { ...arguments_, apply: true },
      now: new Date("2026-07-24T01:00:00.000Z"),
      reconciliationId: "reconciliation-administrative-bound"
    });
    expect(applied.output).toContain(
      "Unresolved potentially billed exposure after: $0.00",
    );
    expect(applied.output).toContain(
      "Administrative full bound retained: $0.65",
    );
    expect(applied.output).toContain(
      "Confirmed estimated cost after: $0.00",
    );
    expect(applied.output).toContain(
      "This is not provider-confirmed billing",
    );
    const [persistedAttempt] = await store.readLedgerAttempts();
    expect(persistedAttempt).toEqual(originalAttempt);
    const [reconciliation] = await store.readBillingReconciliations();
    expect(reconciliation).toMatchObject({
      result: "administrative-full-bound",
      source: "administrative-exhaustion",
      actualCostUsd: null,
      evidenceDigest: expectedDigest
    });
  });

  it("rejects caller-supplied digests and requires a local file for conclusive evidence", () => {
    expect(() => parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-support",
      "--result", "confirmed-not-billed",
      "--actual-cost-usd", "0",
      "--evidence-sha256", "f".repeat(64),
      "--note", "Caller-supplied digests are not accepted."
    ])).toThrow(
      "GENERATION_BILLING_RECONCILIATION_ARGUMENT_UNKNOWN_evidence-sha256",
    );
    expect(() => parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-support",
      "--result", "confirmed-not-billed",
      "--actual-cost-usd", "0",
      "--note", "Conclusive evidence must come from a local file."
    ])).toThrow(
      "GENERATION_BILLING_RECONCILIATION_CONCLUSIVE_EVIDENCE_REQUIRED",
    );
  });

  it("reports unreadable evidence without exposing its local path", async () => {
    const store = new MemoryGenerationStore();
    await store.appendLedgerAttempt(ambiguousAttempt());
    const privatePath = path.join(
      tmpdir(),
      "private-provider-evidence-that-does-not-exist.txt",
    );
    const arguments_ = parseBillingReconciliationCommandArguments([
      "--attempt-id", "attempt-ambiguous",
      "--source", "provider-support",
      "--result", "confirmed-not-billed",
      "--actual-cost-usd", "0",
      "--evidence-file", privatePath,
      "--note", "Provider support supplied exact request attribution."
    ]);
    let failure: unknown;
    try {
      await runBillingReconciliationCommand({
        store,
        arguments: arguments_
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "GENERATION_BILLING_RECONCILIATION_EVIDENCE_FILE_UNREADABLE",
    );
    expect((failure as Error).message).not.toContain(privatePath);
    expect(await store.readBillingReconciliations()).toEqual([]);
  });
});
