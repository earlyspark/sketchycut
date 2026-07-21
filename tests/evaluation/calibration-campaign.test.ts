import { describe, expect, it } from "vitest";

import { hashCanonical } from "../../src/domain/hash.js";
import {
  assertRoundBelongsToCampaign,
  buildCalibrationCandidateIdentity,
  buildCalibrationEvaluationIdentity,
  CalibrationCampaignManifestV1Schema,
  CalibrationRoundManifestV1Schema,
  compareCalibrationIdentity,
  summarizeCalibrationTokens
} from "../../src/evaluation/calibration-campaign.js";

const hash = (character: string): string => character.repeat(64);

async function candidate(overrides: Partial<Parameters<typeof buildCalibrationCandidateIdentity>[0]> = {}) {
  return buildCalibrationCandidateIdentity({
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
    imageDetailPolicy: "high",
    promptLayoutVersion: "stable-prefix-v1",
    promptHash: hash("1"),
    intentSchemaHash: hash("2"),
    capabilityCatalogHash: hash("3"),
    componentManifestHash: hash("4"),
    fullComponentManifestHash: hash("5"),
    packageLockHash: hash("6"),
    ...overrides
  });
}

async function evaluation(overrides: Partial<Parameters<typeof buildCalibrationEvaluationIdentity>[0]> = {}) {
  return buildCalibrationEvaluationIdentity({
    suiteId: "intent-conditioned-v1",
    cohortHash: hash("7"),
    protocolHash: hash("8"),
    scorerHash: hash("9"),
    comparatorHash: hash("a"),
    capabilityBoundaryHash: hash("b"),
    intentSchemaHash: hash("2"),
    dispatchPolicyHash: hash("c"),
    costPolicyHash: hash("d"),
    ...overrides
  });
}

async function campaign() {
  return CalibrationCampaignManifestV1Schema.parse({
    schemaVersion: "sketchycut-calibration-campaign@1.0.0",
    campaignId: "post-m9-generation-quality",
    status: "open",
    createdAt: "2026-07-19T20:00:00Z",
    closedAt: null,
    milestoneLabel: "M9",
    baselineCandidate: await candidate(),
    evaluation: await evaluation(),
    bridgeCampaignIds: [],
    physicalVerification: "not-run",
    notes: []
  });
}

describe("milestone-independent calibration campaigns", () => {
  it("hashes candidates and prompt-cache identities deterministically", async () => {
    const first = await candidate();
    const second = await candidate();
    expect(first).toEqual(second);
    expect(first.candidateHash).toBe(await hashCanonical({
      schemaVersion: "1.0",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
      imageDetailPolicy: "high",
      promptLayoutVersion: "stable-prefix-v1",
      promptHash: hash("1"),
      intentSchemaHash: hash("2"),
      capabilityCatalogHash: hash("3"),
      componentManifestHash: hash("4"),
      fullComponentManifestHash: hash("5"),
      packageLockHash: hash("6")
    }));
    expect(first.promptCacheKey).toBe(`sketchycut-calibration-${first.candidateHash.slice(0, 32)}`);

    const changed = await Promise.all([
      candidate({ modelId: "gpt-future" }),
      candidate({ reasoningEffort: "high" }),
      candidate({ imageDetailPolicy: "low" }),
      candidate({ promptLayoutVersion: "request-local-control-v1" }),
      candidate({ promptHash: hash("e") }),
      candidate({ intentSchemaHash: hash("f") }),
      candidate({ capabilityCatalogHash: hash("0") }),
      candidate({ componentManifestHash: hash("a") }),
      candidate({ fullComponentManifestHash: hash("b") }),
      candidate({ packageLockHash: hash("c") })
    ]);
    expect(new Set(changed.map((item) => item.promptCacheKey)).size).toBe(changed.length);
    expect(changed.every((item) => item.promptCacheKey !== first.promptCacheKey)).toBe(true);
  });

  it("permits candidate revisions but requires a new campaign for evaluation or capability changes", async () => {
    const currentCampaign = await campaign();
    const promptRevision = compareCalibrationIdentity({
      campaign: currentCampaign,
      candidate: await candidate({ promptHash: hash("e") }),
      evaluation: await evaluation()
    });
    expect(promptRevision).toMatchObject({
      compatible: true,
      requiresNewCampaign: false,
      changedEvaluationFields: [],
      changedCandidateFields: ["promptHash"]
    });

    const postM9Boundary = compareCalibrationIdentity({
      campaign: currentCampaign,
      candidate: await candidate({ intentSchemaHash: hash("f") }),
      evaluation: await evaluation({ intentSchemaHash: hash("f"), capabilityBoundaryHash: hash("e") })
    });
    expect(postM9Boundary.compatible).toBe(false);
    expect(postM9Boundary.requiresNewCampaign).toBe(true);
    expect(postM9Boundary.changedEvaluationFields).toEqual(["capabilityBoundaryHash", "intentSchemaHash"]);
  });

  it("keeps old campaign bytes parseable and isolates round kind and campaign identity", async () => {
    const currentCampaign = await campaign();
    expect(CalibrationCampaignManifestV1Schema.parse(JSON.parse(JSON.stringify(currentCampaign))))
      .toEqual(currentCampaign);
    const base = {
      schemaVersion: "sketchycut-calibration-round@1.0.0",
      campaignId: currentCampaign.campaignId,
      roundId: "iteration-1",
      roundOrdinal: 1,
      kind: "iteration",
      studyConfigurationId: "high-medium-stable-prefix",
      status: "registered",
      candidate: await candidate(),
      evaluationIdentityHash: currentCampaign.evaluation.evaluationIdentityHash,
      commitment: null,
      iterationReportHash: null,
      maximumDispatches: 5,
      maximumAggregateExposureMicrousd: 2_500_000,
      resultHash: null,
      summaryHash: null
    } as const;
    const round = CalibrationRoundManifestV1Schema.parse(base);
    expect(() => assertRoundBelongsToCampaign({ campaign: currentCampaign, round })).not.toThrow();
    expect(() => CalibrationRoundManifestV1Schema.parse({
      ...base,
      kind: "holdout",
      iterationReportHash: hash("e")
    })).toThrow(/sealed commitment/i);
    expect(() => CalibrationRoundManifestV1Schema.parse({
      ...base,
      kind: "holdout",
      commitment: {
        commitment: hash("1"), panelDigest: hash("2"), comparatorMappingDigest: hash("3"),
        panelOrdinal: 1, authoredAt: "2026-07-19T20:01:00Z",
        reservedForPromptRoundOrdinal: 1, checkerResult: "SEALED_HOLDOUT_POLICY_PASS"
      },
      iterationReportHash: hash("e")
    })).not.toThrow();
    expect(() => assertRoundBelongsToCampaign({
      campaign: currentCampaign,
      round: CalibrationRoundManifestV1Schema.parse({ ...base, campaignId: "another-campaign" })
    })).toThrow("CALIBRATION_ROUND_CAMPAIGN_MISMATCH");
  });

  it("summarizes tokens, cache reads, confirmed cost, and unresolved exposure without raw results", () => {
    expect(summarizeCalibrationTokens([
      {
        usage: { status: "reported", inputTokens: 1_000, cachedInputTokens: 800, cacheWriteInputTokens: 100, reasoningTokens: 50, outputTokens: 200, totalTokens: 1_200 },
        billing: { state: "confirmed-billed", estimatedCostUsd: 0.02, requestBudgetUpperBoundUsd: 0.5 }
      },
      {
        usage: { status: "unavailable" },
        billing: { state: "potentially-billed", estimatedCostUsd: null, requestBudgetUpperBoundUsd: 0.5 }
      }
    ])).toEqual({
      schemaVersion: "1.0",
      inputTokens: 1_000,
      cachedInputTokens: 800,
      cacheWriteTokens: 100,
      reasoningTokens: 50,
      outputTokens: 200,
      totalTokens: 1_200,
      cacheReadRate: 0.8,
      confirmedEstimatedCostUsd: 0.02,
      unresolvedPotentiallyBilledExposureUsd: 0.5
    });
  });
});
