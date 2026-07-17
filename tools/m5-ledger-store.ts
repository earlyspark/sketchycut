import { mkdir, readFile, appendFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  appendAttempt,
  appendBillingReconciliation
} from "../src/interpretation/ledger-append.js";
import {
  BillingReconciliationSchema,
  LiveCallAttemptSchema,
  LiveCallLedgerV1Schema,
  type LiveCallAttempt,
  type LiveCallLedgerV1
} from "../src/interpretation/live-ledger.js";
import {
  M5LiveRecordingIncidentSchema,
  type M5LiveRecordingIncident
} from "./m5-live-recording-incident.js";

const AttemptEventSchema = z
  .object({
    recordType: z.literal("attempt"),
    attempt: LiveCallAttemptSchema
  })
  .strict();

const ReconciliationEventSchema = z
  .object({
    recordType: z.literal("reconciliation"),
    reconciliation: BillingReconciliationSchema
  })
  .strict();

const RecordingIncidentEventSchema = z
  .object({
    recordType: z.literal("recording-incident"),
    incident: M5LiveRecordingIncidentSchema
  })
  .strict();

const LedgerEventSchema = z.discriminatedUnion("recordType", [
  AttemptEventSchema,
  ReconciliationEventSchema,
  RecordingIncidentEventSchema
]);

const LEDGER_ID = "m5-live-call-ledger";

async function readEvents(filePath: string): Promise<z.infer<typeof LedgerEventSchema>[]> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return source
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => LedgerEventSchema.parse(JSON.parse(line) as unknown));
}

function reconstruct(events: readonly z.infer<typeof LedgerEventSchema>[]): LiveCallLedgerV1 | null {
  let ledger: LiveCallLedgerV1 | null = null;
  for (const event of events) {
    if (event.recordType === "attempt") {
      ledger = appendAttempt(ledger, LEDGER_ID, event.attempt);
    } else if (event.recordType === "reconciliation") {
      if (ledger === null) throw new Error("M5_LEDGER_RECONCILIATION_BEFORE_ATTEMPT");
      ledger = appendBillingReconciliation(ledger, event.reconciliation);
    }
  }
  return ledger;
}

export class AppendOnlyM5LedgerStore {
  readonly #filePath: string;
  #appendChain: Promise<void> = Promise.resolve();

  constructor(repositoryRoot: string) {
    this.#filePath = path.join(
      repositoryRoot,
      "docs/evidence/m05/live/live-call-ledger.ndjson",
    );
  }

  append(attemptCandidate: unknown): Promise<void> {
    const attempt = LiveCallAttemptSchema.parse(attemptCandidate);
    const work = this.#appendChain.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true });
      const before = await readEvents(this.#filePath);
      if (attempt.retryOfRecordingIncidentId !== null &&
          attempt.retryOfRecordingIncidentId !== undefined &&
          !before.some((event) => event.recordType === "recording-incident" &&
            event.incident.incidentId === attempt.retryOfRecordingIncidentId)) {
        throw new Error("M5_LEDGER_RETRY_RECORDING_INCIDENT_NOT_FOUND");
      }
      const candidate = appendAttempt(reconstruct(before), LEDGER_ID, attempt);
      LiveCallLedgerV1Schema.parse(candidate);
      await appendFile(
        this.#filePath,
        `${JSON.stringify(AttemptEventSchema.parse({ recordType: "attempt", attempt }))}\n`,
        { encoding: "utf8", flag: "a" },
      );
      const after = await readEvents(this.#filePath);
      const observed = reconstruct(after);
      if (observed === null) throw new Error("M5_LEDGER_APPEND_MISSING");
      LiveCallLedgerV1Schema.parse(observed);
      if (observed.attempts.at(-1)?.attemptId !== attempt.attemptId) {
        throw new Error("M5_LEDGER_APPEND_VERIFICATION_FAILED");
      }
    });
    this.#appendChain = work.catch(() => undefined);
    return work;
  }

  appendReconciliation(reconciliationCandidate: unknown): Promise<void> {
    const reconciliation = BillingReconciliationSchema.parse(reconciliationCandidate);
    const work = this.#appendChain.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true });
      const before = await readEvents(this.#filePath);
      const previous = reconstruct(before);
      if (previous === null) throw new Error("M5_LEDGER_RECONCILIATION_BEFORE_ATTEMPT");
      const candidate = appendBillingReconciliation(previous, reconciliation);
      LiveCallLedgerV1Schema.parse(candidate);
      await appendFile(
        this.#filePath,
        `${JSON.stringify(ReconciliationEventSchema.parse({
          recordType: "reconciliation",
          reconciliation
        }))}\n`,
        { encoding: "utf8", flag: "a" },
      );
      const observed = reconstruct(await readEvents(this.#filePath));
      if (observed === null ||
          observed.reconciliations.at(-1)?.reconciliationId !== reconciliation.reconciliationId) {
        throw new Error("M5_LEDGER_RECONCILIATION_APPEND_VERIFICATION_FAILED");
      }
      LiveCallLedgerV1Schema.parse(observed);
    });
    this.#appendChain = work.catch(() => undefined);
    return work;
  }

  appendRecordingIncident(incidentCandidate: unknown): Promise<void> {
    const incident = M5LiveRecordingIncidentSchema.parse(incidentCandidate);
    const work = this.#appendChain.then(async () => {
      await mkdir(path.dirname(this.#filePath), { recursive: true });
      const before = await readEvents(this.#filePath);
      if (before.some((event) => event.recordType === "recording-incident" &&
          event.incident.incidentId === incident.incidentId)) {
        throw new Error("M5_LEDGER_RECORDING_INCIDENT_ALREADY_EXISTS");
      }
      const reconstructed = reconstruct(before);
      if (reconstructed !== null) LiveCallLedgerV1Schema.parse(reconstructed);
      await appendFile(
        this.#filePath,
        `${JSON.stringify(RecordingIncidentEventSchema.parse({
          recordType: "recording-incident",
          incident
        }))}\n`,
        { encoding: "utf8", flag: "a" },
      );
      const after = await readEvents(this.#filePath);
      const observed = after.findLast((event) => event.recordType === "recording-incident");
      if (observed?.recordType !== "recording-incident" ||
          observed.incident.incidentId !== incident.incidentId) {
        throw new Error("M5_LEDGER_RECORDING_INCIDENT_APPEND_VERIFICATION_FAILED");
      }
      const afterLedger = reconstruct(after);
      if (afterLedger !== null) LiveCallLedgerV1Schema.parse(afterLedger);
    });
    this.#appendChain = work.catch(() => undefined);
    return work;
  }

  async read(): Promise<LiveCallLedgerV1 | null> {
    await this.#appendChain;
    return reconstruct(await readEvents(this.#filePath));
  }

  async hasRecordingIncident(incidentId: string): Promise<boolean> {
    await this.#appendChain;
    return (await readEvents(this.#filePath)).some((event) =>
      event.recordType === "recording-incident" && event.incident.incidentId === incidentId
    );
  }

  get filePath(): string {
    return this.#filePath;
  }
}

export type { LiveCallAttempt };
export type { M5LiveRecordingIncident };
