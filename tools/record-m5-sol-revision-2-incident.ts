import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AppendOnlyM5LedgerStore } from "./m5-ledger-store.js";
import { M5LiveRecordingIncidentSchema } from "./m5-live-recording-incident.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const liveDirectory = path.join(repositoryRoot, "docs/evidence/m05/live");
const reportPath = path.join(liveDirectory, "evaluation-gpt-5.6-sol-attempt-2.json");
const incidentPath = path.join(liveDirectory, "incident-gpt-5.6-sol-attempt-2.json");

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

if (await exists(reportPath)) {
  throw new Error("M5_SOL_REVISION_2_REPORT_ALREADY_EXISTS");
}
if (await exists(incidentPath)) {
  throw new Error("M5_SOL_REVISION_2_INCIDENT_ALREADY_EXISTS");
}
const ledgerPath = path.join(liveDirectory, "live-call-ledger.ndjson");
const ledgerLines = (await readFile(ledgerPath, "utf8")).split("\n").filter(Boolean);
if (ledgerLines.length !== 1) {
  throw new Error("M5_SOL_REVISION_2_RECOVERY_REQUIRES_EXACT_ATTEMPT_1_LEDGER");
}

const incident = M5LiveRecordingIncidentSchema.parse({
  schemaVersion: "1.0",
  incidentId: "incident-sol-revision-2-ledger-validation",
  evaluationId: "m5-live-gpt-5.6-sol-attempt-2",
  modelId: "gpt-5.6-sol",
  recordedAt: new Date().toISOString(),
  command: "npm run evaluate:m5:sol:revision-2",
  result: {
    networkDispatchCount: 1,
    providerResponseReachedLocalPipeline: true,
    strictParse: "passed",
    deterministicCompile: "passed",
    supportStateCorrect: null,
    immutableEvaluationReportWritten: false,
    ordinaryAttemptLedgerRecordWritten: false,
    terraDispatched: false
  },
  provenance: {
    clientRequestId: null,
    providerRequestId: null,
    responseId: null,
    usage: { status: "unavailable", reason: "post-response-local-recording-failure" },
    identifierReason: "Identifiers existed in process memory but were not persisted before the local ledger rejected the completed attempt."
  },
  billing: {
    state: "potentially-billed",
    estimatedCostUsd: null,
    unresolvedPotentialExposureUsd: 0.25,
    configuredPriceSnapshotId: "openai-public-pricing-2026-07-17-gpt-5.6-sol"
  },
  failure: {
    stage: "local-recording",
    code: "LOCAL_LEDGER_PRICE_SNAPSHOT_ID_VALIDATION_AFTER_COMPLETED_RESPONSE",
    stackLocation: "src/interpretation/orchestrator.ts:649 -> tools/m5-ledger-store.ts:78",
    cause: "The configured price snapshot ID contained dots and failed the ledger StableId schema after the completed response was compiled."
  },
  evidenceBasis: [
    "The thrown ZodError identifies billing.priceSnapshotId and the StableId regex.",
    "The orchestrator stack reached the successful completed-attempt append after strict parse, mapping, and deterministic compilation.",
    "No attempt-2 evaluation report or ordinary ledger attempt was written, and Terra remained undispatched."
  ],
  privacy: {
    rawReferencePersisted: false,
    rawProviderResponsePersisted: false,
    fullPromptPersisted: false,
    apiKeyPersisted: false
  },
  limitations: [
    "The model output, exact support-state result, provider identifiers, token usage, latency, and exact cost cannot be recovered from local evidence.",
    "This incident proves a completed local interpretation pipeline, not a passing frozen evaluation rubric.",
    "A further dispatch requires separate explicit builder authorization and must not reuse or overwrite revision-2 evidence."
  ]
});

const ledger = new AppendOnlyM5LedgerStore(repositoryRoot);
await ledger.appendRecordingIncident(incident);
await writeFile(incidentPath, `${JSON.stringify(incident, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx"
});
process.stdout.write("Recorded immutable Sol revision-2 post-response ledger incident; no network request was made.\n");
