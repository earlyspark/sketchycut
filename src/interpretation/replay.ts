import { z } from "zod";

import {
  DesignRequestV1Schema,
  IntentFixtureV1Schema,
  Sha256Schema,
  type DesignRequestV1,
  type IntentFixtureV1
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";

export const ReplayRecordV1Schema = z
  .object({
    schemaVersion: z.literal("1.0"),
    requestDigest: Sha256Schema,
    request: DesignRequestV1Schema,
    response: IntentFixtureV1Schema,
    provenance: z
      .object({
        source: z.literal("pinned-fixture"),
        networkAllowed: z.literal(false),
        runtimeApplicationApiCalls: z.literal(0)
      })
      .strict()
  })
  .strict();

export type ReplayRecordV1 = z.infer<typeof ReplayRecordV1Schema>;

export class FixtureReplayTransport {
  readonly runtimeApplicationApiCalls = 0 as const;
  readonly networkAllowed = false as const;
  readonly #records: ReadonlyMap<string, ReplayRecordV1>;

  private constructor(records: ReadonlyMap<string, ReplayRecordV1>) {
    this.#records = records;
  }

  static async create(records: readonly unknown[]): Promise<FixtureReplayTransport> {
    const byDigest = new Map<string, ReplayRecordV1>();
    for (const candidate of records) {
      const record = ReplayRecordV1Schema.parse(candidate);
      const observedDigest = await hashCanonical(record.request);
      if (observedDigest !== record.requestDigest) {
        throw new Error(
          `Replay fixture ${record.response.fixtureId} has a stale request digest.`,
        );
      }
      if (byDigest.has(record.requestDigest)) {
        throw new Error(`Duplicate replay request digest ${record.requestDigest}.`);
      }
      byDigest.set(record.requestDigest, record);
    }
    return new FixtureReplayTransport(byDigest);
  }

  async interpret(requestCandidate: unknown): Promise<IntentFixtureV1> {
    const request: DesignRequestV1 = DesignRequestV1Schema.parse(requestCandidate);
    const digest = await hashCanonical(request);
    const record = this.#records.get(digest);
    if (record === undefined) {
      throw new Error(`No offline replay fixture matches request digest ${digest}.`);
    }
    return IntentFixtureV1Schema.parse(record.response);
  }
}
