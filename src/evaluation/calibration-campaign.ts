import { z } from "zod";

import { Sha256Schema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";

const StableLabelSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9._-]*$/);
const PositiveMicrousdSchema = z.number().int().positive();

export const CalibrationStudyConfigurationIdSchema = z.enum([
  "low-medium-request-local-control",
  "low-medium-stable-prefix",
  "high-medium-stable-prefix",
  "high-high-stable-prefix",
  "mixed-medium-stable-prefix"
]);

export const CalibrationCandidateIdentityV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  modelId: z.string().trim().min(1).max(120),
  reasoningEffort: z.string().trim().min(1).max(40),
  imageDetailPolicy: z.enum(["low", "high", "auto", "mixed-first-high"]),
  promptLayoutVersion: z.enum(["stable-prefix-v1", "request-local-control-v1"]),
  promptHash: Sha256Schema,
  intentSchemaHash: Sha256Schema,
  capabilityCatalogHash: Sha256Schema,
  componentManifestHash: Sha256Schema,
  fullComponentManifestHash: Sha256Schema,
  packageLockHash: Sha256Schema,
  candidateHash: Sha256Schema,
  promptCacheKey: z.string().regex(/^sketchycut-calibration-[a-f0-9]{32}$/)
}).strict();

export type CalibrationCandidateIdentityV1 = z.infer<
  typeof CalibrationCandidateIdentityV1Schema
>;

export const CalibrationEvaluationIdentityV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  suiteId: StableLabelSchema,
  cohortHash: Sha256Schema,
  protocolHash: Sha256Schema,
  scorerHash: Sha256Schema,
  comparatorHash: Sha256Schema,
  capabilityBoundaryHash: Sha256Schema,
  intentSchemaHash: Sha256Schema,
  dispatchPolicyHash: Sha256Schema,
  costPolicyHash: Sha256Schema,
  evaluationIdentityHash: Sha256Schema
}).strict();

export type CalibrationEvaluationIdentityV1 = z.infer<
  typeof CalibrationEvaluationIdentityV1Schema
>;

export const CalibrationCampaignManifestV1Schema = z.object({
  schemaVersion: z.literal("sketchycut-calibration-campaign@1.0.0"),
  campaignId: StableLabelSchema,
  status: z.enum(["open", "closed"]),
  createdAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  milestoneLabel: z.string().trim().min(1).max(80).nullable(),
  baselineCandidate: CalibrationCandidateIdentityV1Schema,
  evaluation: CalibrationEvaluationIdentityV1Schema,
  bridgeCampaignIds: z.array(StableLabelSchema).max(16),
  physicalVerification: z.enum(["not-run", "partial", "complete"]),
  notes: z.array(z.string().trim().min(1).max(500)).max(32)
}).strict().superRefine((campaign, context) => {
  if (campaign.status === "open" && campaign.closedAt !== null) {
    context.addIssue({ code: "custom", path: ["closedAt"], message: "Open campaign cannot have a close time." });
  }
  if (campaign.status === "closed" && campaign.closedAt === null) {
    context.addIssue({ code: "custom", path: ["closedAt"], message: "Closed campaign requires a close time." });
  }
});

export type CalibrationCampaignManifestV1 = z.infer<
  typeof CalibrationCampaignManifestV1Schema
>;

const CommitmentMetadataSchema = z.object({
  commitment: Sha256Schema,
  panelDigest: Sha256Schema,
  comparatorMappingDigest: Sha256Schema,
  panelOrdinal: z.number().int().positive(),
  authoredAt: z.iso.datetime({ offset: true }),
  reservedForPromptRoundOrdinal: z.number().int().positive(),
  checkerResult: z.literal("SEALED_HOLDOUT_POLICY_PASS")
}).strict();

export const CalibrationRoundManifestV1Schema = z.object({
  schemaVersion: z.literal("sketchycut-calibration-round@1.0.0"),
  campaignId: StableLabelSchema,
  roundId: StableLabelSchema,
  roundOrdinal: z.number().int().positive(),
  kind: z.enum(["iteration", "holdout"]),
  studyConfigurationId: CalibrationStudyConfigurationIdSchema,
  status: z.enum(["registered", "prepared", "authorized", "partial", "completed", "failed"]),
  candidate: CalibrationCandidateIdentityV1Schema,
  evaluationIdentityHash: Sha256Schema,
  commitment: CommitmentMetadataSchema.nullable(),
  iterationReportHash: Sha256Schema.nullable(),
  maximumDispatches: z.literal(5),
  maximumAggregateExposureMicrousd: PositiveMicrousdSchema,
  resultHash: Sha256Schema.nullable(),
  summaryHash: Sha256Schema.nullable()
}).strict().superRefine((round, context) => {
  if (round.commitment !== null &&
      round.commitment.reservedForPromptRoundOrdinal !== round.roundOrdinal) {
    context.addIssue({ code: "custom", path: ["commitment", "reservedForPromptRoundOrdinal"], message: "Commitment is reserved for another round." });
  }
  if (round.kind === "iteration" && round.commitment !== null) {
    context.addIssue({ code: "custom", path: ["commitment"], message: "Frozen-corpus iteration rounds do not consume sealed-panel commitments." });
  }
  if (round.kind === "holdout" && round.commitment === null) {
    context.addIssue({ code: "custom", path: ["commitment"], message: "Holdout round requires an independently sealed commitment." });
  }
  if (round.kind === "iteration" && round.iterationReportHash !== null) {
    context.addIssue({ code: "custom", path: ["iterationReportHash"], message: "Iteration round cannot depend on another iteration report." });
  }
  if (round.kind === "holdout" && round.iterationReportHash === null) {
    context.addIssue({ code: "custom", path: ["iterationReportHash"], message: "Holdout round requires its passing iteration report hash." });
  }
  const terminal = round.status === "completed" || round.status === "failed";
  if (terminal !== (round.resultHash !== null && round.summaryHash !== null)) {
    context.addIssue({ code: "custom", path: ["resultHash"], message: "Terminal round requires immutable result and summary hashes only." });
  }
});

export type CalibrationRoundManifestV1 = z.infer<typeof CalibrationRoundManifestV1Schema>;

export const CalibrationResumeV1Schema = z.object({
  schemaVersion: z.literal("sketchycut-calibration-resume@1.0.0"),
  campaignPath: z.string().trim().min(1),
  roundPath: z.string().trim().min(1).nullable(),
  stage: z.enum([
    "campaign-open",
    "commitment-required",
    "authorization-required",
    "execution-authorized",
    "partial-stop",
    "round-complete",
    "campaign-closed"
  ]),
  nextCommand: z.string().trim().min(1).nullable(),
  updatedAt: z.iso.datetime({ offset: true })
}).strict();

export const CalibrationTokenSummaryV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadRate: z.number().min(0).max(1),
  confirmedEstimatedCostUsd: z.number().nonnegative(),
  unresolvedPotentiallyBilledExposureUsd: z.number().nonnegative()
}).strict();

export type CalibrationCompatibility = {
  compatible: boolean;
  requiresNewCampaign: boolean;
  changedEvaluationFields: string[];
  changedCandidateFields: string[];
};

const EVALUATION_FIELDS = [
  "suiteId",
  "cohortHash",
  "protocolHash",
  "scorerHash",
  "comparatorHash",
  "capabilityBoundaryHash",
  "intentSchemaHash",
  "dispatchPolicyHash",
  "costPolicyHash"
] as const;

const CANDIDATE_FIELDS = [
  "modelId",
  "reasoningEffort",
  "imageDetailPolicy",
  "promptLayoutVersion",
  "promptHash",
  "intentSchemaHash",
  "capabilityCatalogHash",
  "componentManifestHash",
  "fullComponentManifestHash",
  "packageLockHash"
] as const;

export async function buildCalibrationCandidateIdentity(input: Omit<
  CalibrationCandidateIdentityV1,
  "schemaVersion" | "candidateHash" | "promptCacheKey"
>): Promise<CalibrationCandidateIdentityV1> {
  const provisional = { schemaVersion: "1.0" as const, ...input };
  const candidateHash = await hashCanonical(provisional);
  return CalibrationCandidateIdentityV1Schema.parse({
    ...provisional,
    candidateHash,
    promptCacheKey: `sketchycut-calibration-${candidateHash.slice(0, 32)}`
  });
}

export async function buildCalibrationEvaluationIdentity(input: Omit<
  CalibrationEvaluationIdentityV1,
  "schemaVersion" | "evaluationIdentityHash"
>): Promise<CalibrationEvaluationIdentityV1> {
  const provisional = { schemaVersion: "1.0" as const, ...input };
  return CalibrationEvaluationIdentityV1Schema.parse({
    ...provisional,
    evaluationIdentityHash: await hashCanonical(provisional)
  });
}

export function compareCalibrationIdentity(input: {
  campaign: CalibrationCampaignManifestV1;
  candidate: CalibrationCandidateIdentityV1;
  evaluation: CalibrationEvaluationIdentityV1;
}): CalibrationCompatibility {
  const campaign = CalibrationCampaignManifestV1Schema.parse(input.campaign);
  const candidate = CalibrationCandidateIdentityV1Schema.parse(input.candidate);
  const evaluation = CalibrationEvaluationIdentityV1Schema.parse(input.evaluation);
  const changedEvaluationFields = EVALUATION_FIELDS.filter((field) =>
    campaign.evaluation[field] !== evaluation[field]
  );
  const changedCandidateFields = CANDIDATE_FIELDS.filter((field) =>
    campaign.baselineCandidate[field] !== candidate[field]
  );
  return {
    compatible: campaign.status === "open" && changedEvaluationFields.length === 0,
    requiresNewCampaign: campaign.status === "closed" || changedEvaluationFields.length > 0,
    changedEvaluationFields,
    changedCandidateFields
  };
}

export function assertRoundBelongsToCampaign(input: {
  campaign: CalibrationCampaignManifestV1;
  round: CalibrationRoundManifestV1;
}): void {
  const campaign = CalibrationCampaignManifestV1Schema.parse(input.campaign);
  const round = CalibrationRoundManifestV1Schema.parse(input.round);
  if (campaign.status !== "open") throw new Error("CALIBRATION_CAMPAIGN_CLOSED");
  if (round.campaignId !== campaign.campaignId) throw new Error("CALIBRATION_ROUND_CAMPAIGN_MISMATCH");
  if (round.evaluationIdentityHash !== campaign.evaluation.evaluationIdentityHash) {
    throw new Error("CALIBRATION_ROUND_EVALUATION_MISMATCH");
  }
}

export function summarizeCalibrationTokens(attempts: readonly {
  usage: { status: "reported"; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; reasoningTokens: number; outputTokens: number; totalTokens: number } |
    { status: "unavailable" };
  billing: { state: string; estimatedCostUsd: number | null; requestBudgetUpperBoundUsd: number | null };
}[]) {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let reasoningTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let confirmedEstimatedCostUsd = 0;
  let unresolvedPotentiallyBilledExposureUsd = 0;
  for (const attempt of attempts) {
    if (attempt.usage.status === "reported") {
      inputTokens += attempt.usage.inputTokens;
      cachedInputTokens += attempt.usage.cachedInputTokens;
      cacheWriteTokens += attempt.usage.cacheWriteInputTokens;
      reasoningTokens += attempt.usage.reasoningTokens;
      outputTokens += attempt.usage.outputTokens;
      totalTokens += attempt.usage.totalTokens;
    }
    if (attempt.billing.estimatedCostUsd !== null) {
      confirmedEstimatedCostUsd += attempt.billing.estimatedCostUsd;
    } else if (attempt.billing.state === "potentially-billed") {
      unresolvedPotentiallyBilledExposureUsd += attempt.billing.requestBudgetUpperBoundUsd ?? 0;
    }
  }
  return CalibrationTokenSummaryV1Schema.parse({
    schemaVersion: "1.0",
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    reasoningTokens,
    outputTokens,
    totalTokens,
    cacheReadRate: inputTokens === 0 ? 0 : cachedInputTokens / inputTokens,
    confirmedEstimatedCostUsd: Number(confirmedEstimatedCostUsd.toFixed(8)),
    unresolvedPotentiallyBilledExposureUsd: Number(unresolvedPotentiallyBilledExposureUsd.toFixed(8))
  });
}
