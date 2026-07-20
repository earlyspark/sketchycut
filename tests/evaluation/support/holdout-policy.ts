import { z } from "zod";

import { Sha256Schema } from "../../../src/domain/contracts.js";
import { hashCanonical, sha256, stableJson } from "../../../src/domain/hash.js";
import { SemanticReferenceDescriptorSchema } from "../../../src/interpretation/semantic-input-contracts.js";
import {
  DiversityPanelProtocolSchema,
  validateDiversityPanelProtocol,
  type DiversityPanelProtocol
} from "../../../src/evaluation/semantic-diversity.js";
import {
  NoveltyRelationTupleV1Schema,
  PROMPT_EXAMPLE_CATALOG_V1,
  PromptExampleCatalogV1Schema,
  normalizeGeneralityText,
  relationTupleKey
} from "../../../src/evaluation/prompt-generality.js";

export const HOLDOUT_DISTRIBUTION_TEMPLATE_VERSION = "holdout-distribution-template-v1" as const;
export const HOLDOUT_PANEL_NOVELTY_POLICY_VERSION = "holdout-panel-novelty-policy-v1" as const;
export const HOLDOUT_COMMITMENT_VERSION = "sketchycut-sealed-holdout-commitment-v1" as const;

const ITERATION_CASE_IDS = [
  "long-pencil-enclosure",
  "flat-wide-tray",
  "tall-narrow-container",
  "four-sd-card-compartments",
  "open-front-cubby"
] as const;

const ComparatorClassSchema = z.enum(ITERATION_CASE_IDS);

const SealedHoldoutCaseV1Schema = z.object({
  caseId: z.string().regex(/^[a-z][a-z0-9-]+$/),
  syntheticBrief: z.string().trim().min(1).max(4_000),
  references: z.array(z.object({
    descriptor: SemanticReferenceDescriptorSchema,
    declaredRoles: z.array(z.enum(["structure", "motif"])).min(1).max(2)
  }).strict()).max(3),
  objectAliases: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  relationTuple: NoveltyRelationTupleV1Schema,
  paraphraseOfIterationCaseId: ComparatorClassSchema.nullable(),
  comparatorClass: ComparatorClassSchema
}).strict();

export const SealedHoldoutPanelV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  commitmentVersion: z.literal(HOLDOUT_COMMITMENT_VERSION),
  distributionTemplateVersion: z.literal(HOLDOUT_DISTRIBUTION_TEMPLATE_VERSION),
  noveltyPolicyVersion: z.literal(HOLDOUT_PANEL_NOVELTY_POLICY_VERSION),
  panelOrdinal: z.number().int().positive(),
  authoredAt: z.iso.datetime({ offset: true }),
  reservedForPromptRoundOrdinal: z.number().int().positive(),
  earlierPromptRoundOrdinals: z.array(z.number().int().positive()),
  earlierIterationRoundOrdinals: z.array(z.number().int().positive()),
  earlierHoldoutPanelOrdinals: z.array(z.number().int().positive()),
  protocol: DiversityPanelProtocolSchema,
  cases: z.array(SealedHoldoutCaseV1Schema).length(5),
  saltHex: z.string().regex(/^[0-9a-f]+$/).min(32).refine((value) => value.length % 2 === 0, "Salt must encode whole bytes.")
}).strict().superRefine((value, context) => {
  const protocolIds = value.protocol.cases.map((item) => item.id).sort();
  const caseIds = value.cases.map((item) => item.caseId).sort();
  if (new Set(caseIds).size !== caseIds.length || JSON.stringify(protocolIds) !== JSON.stringify(caseIds)) {
    context.addIssue({ code: "custom", message: "Sealed case IDs must uniquely match the protocol case set." });
  }
  if (value.earlierHoldoutPanelOrdinals.includes(value.panelOrdinal)) {
    context.addIssue({ code: "custom", message: "A panel cannot precede itself." });
  }
});

export type SealedHoldoutPanelV1 = z.infer<typeof SealedHoldoutPanelV1Schema>;

const PriorNoveltyUniverseV1Schema = z.object({
  priorObjectAliases: z.array(z.string().trim().min(1).max(80)),
  priorRelationTuples: z.array(NoveltyRelationTupleV1Schema)
}).strict();

const PUBLIC_OBJECT_ALIASES = [
  "automaton", "camera", "cards", "catchall", "keepsake", "notebook", "paint brush", "paint brushes", "pencil", "pencils",
  "phone", "phone stand", "sd card", "sd cards", "tea bag", "tea bags"
] as const;

const ITERATION_SEMANTICS = {
  "long-pencil-enclosure": {
    objectRoles: ["contained"], access: "covered", organizationCount: null, scaleEvidenceTarget: "pencils",
    proportionDirection: "width-over-depth", mechanism: "none"
  },
  "flat-wide-tray": {
    objectRoles: ["contained"], access: "open-top", organizationCount: null, scaleEvidenceTarget: null,
    proportionDirection: "width-over-height", mechanism: "none"
  },
  "tall-narrow-container": {
    objectRoles: ["contained"], access: "open-top", organizationCount: null, scaleEvidenceTarget: null,
    proportionDirection: "height-over-width", mechanism: "none"
  },
  "four-sd-card-compartments": {
    objectRoles: ["contained"], access: "open-top", organizationCount: 4, scaleEvidenceTarget: "sd cards",
    proportionDirection: "none", mechanism: "none"
  },
  "open-front-cubby": {
    objectRoles: ["contained"], access: "open-front", organizationCount: null, scaleEvidenceTarget: "notebook",
    proportionDirection: "none", mechanism: "none"
  }
} as const satisfies Record<typeof ITERATION_CASE_IDS[number], z.input<typeof NoveltyRelationTupleV1Schema>>;

const ITERATION_BRIEFS = {
  "long-pencil-enclosure": "Make a long, narrow covered enclosure for six standard pencils.",
  "flat-wide-tray": "Make a flat, wide open-top tray for my desk.",
  "tall-narrow-container": "Make a tall, narrow open-top container for paint brushes.",
  "four-sd-card-compartments": "Make an open-top organizer with four compartments for SD cards.",
  "open-front-cubby": "Make an open-front cubby for a small notebook."
} as const;

const NOVELTY_POLICY = {
  version: HOLDOUT_PANEL_NOVELTY_POLICY_VERSION,
  normalizer: "nfkc-lowercase-alphanumeric-token-v1",
  schemaVocabularyExempt: true,
  minimumNovelCases: 4,
  publicObjectAliases: PUBLIC_OBJECT_ALIASES,
  iterationCaseIds: ITERATION_CASE_IDS,
  catalogVersion: PROMPT_EXAMPLE_CATALOG_V1.catalogVersion
} as const;

const DISTRIBUTION_TEMPLATE = {
  version: HOLDOUT_DISTRIBUTION_TEMPLATE_VERSION,
  caseCount: 5,
  exactOpportunityTotals: { proportions: 3, counts: 1, scaleEvidence: 2, access: 1 },
  minimumMateriallyDifferentCases: 4,
  minimumDimensionSensitiveCases: 2,
  requireEveryTopologySensitiveCase: true,
  pairwiseAspectCaseCount: 3,
  minimumParaphraseCases: 1,
  minimumNovelCases: 4
} as const;

export const HoldoutPolicyReportV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  distributionTemplateVersion: z.literal(HOLDOUT_DISTRIBUTION_TEMPLATE_VERSION),
  noveltyPolicyVersion: z.literal(HOLDOUT_PANEL_NOVELTY_POLICY_VERSION),
  distributionPolicyHash: Sha256Schema,
  noveltyPolicyHash: Sha256Schema,
  commitmentMatches: z.boolean(),
  schemaPass: z.boolean(),
  distributionPass: z.boolean(),
  noveltyPass: z.boolean(),
  comparatorMappingPass: z.boolean(),
  paraphrasePass: z.boolean(),
  novelCaseCount: z.number().int().nonnegative().max(5),
  panelDigest: Sha256Schema,
  comparatorMappingDigest: Sha256Schema,
  pass: z.boolean()
}).strict();

function publicRelationKeys(): Set<string> {
  return new Set(Object.values(ITERATION_SEMANTICS).map((item) => relationTupleKey(item)));
}

function distributionPass(protocol: DiversityPanelProtocol): boolean {
  try {
    validateDiversityPanelProtocol(protocol);
  } catch {
    return false;
  }
  return protocol.roundPolicy.expectedCaseCount === DISTRIBUTION_TEMPLATE.caseCount &&
    protocol.roundPolicy.minimumMateriallyDifferentCases === DISTRIBUTION_TEMPLATE.minimumMateriallyDifferentCases &&
    protocol.roundPolicy.minimumDimensionSensitiveCases === DISTRIBUTION_TEMPLATE.minimumDimensionSensitiveCases &&
    protocol.roundPolicy.requireEveryTopologySensitiveCase === DISTRIBUTION_TEMPLATE.requireEveryTopologySensitiveCase &&
    protocol.roundPolicy.pairwiseDistinctAspectCaseIds.length === DISTRIBUTION_TEMPLATE.pairwiseAspectCaseCount &&
    (Object.keys(DISTRIBUTION_TEMPLATE.exactOpportunityTotals) as (keyof typeof DISTRIBUTION_TEMPLATE.exactOpportunityTotals)[]).every(
      (key) => protocol.roundPolicy.exactOpportunityTotals[key] === DISTRIBUTION_TEMPLATE.exactOpportunityTotals[key]
    );
}

function payloadWithoutSalt(panel: SealedHoldoutPanelV1): Omit<SealedHoldoutPanelV1, "saltHex"> {
  return {
    schemaVersion: panel.schemaVersion,
    commitmentVersion: panel.commitmentVersion,
    distributionTemplateVersion: panel.distributionTemplateVersion,
    noveltyPolicyVersion: panel.noveltyPolicyVersion,
    panelOrdinal: panel.panelOrdinal,
    authoredAt: panel.authoredAt,
    reservedForPromptRoundOrdinal: panel.reservedForPromptRoundOrdinal,
    earlierPromptRoundOrdinals: panel.earlierPromptRoundOrdinals,
    earlierIterationRoundOrdinals: panel.earlierIterationRoundOrdinals,
    earlierHoldoutPanelOrdinals: panel.earlierHoldoutPanelOrdinals,
    protocol: panel.protocol,
    cases: panel.cases
  };
}

export async function holdoutCommitment(panelCandidate: unknown): Promise<{
  commitment: string;
  panelDigest: string;
  comparatorMappingDigest: string;
}> {
  const panel = SealedHoldoutPanelV1Schema.parse(panelCandidate);
  const payload = payloadWithoutSalt(panel);
  const comparatorMapping = panel.cases.map((item) => ({ caseId: item.caseId, comparatorClass: item.comparatorClass }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  return {
    commitment: await sha256(`${HOLDOUT_COMMITMENT_VERSION}\0${stableJson(panel)}`),
    panelDigest: await hashCanonical(payload),
    comparatorMappingDigest: await hashCanonical(comparatorMapping)
  };
}

export async function verifyOpenedHoldoutPanel(input: {
  panel: unknown;
  expectedCommitment: string;
  catalog?: unknown;
  priorNoveltyUniverse?: unknown;
}): Promise<z.infer<typeof HoldoutPolicyReportV1Schema>> {
  const parsed = SealedHoldoutPanelV1Schema.safeParse(input.panel);
  if (!parsed.success) throw new Error("SEALED_HOLDOUT_SCHEMA_INVALID");
  const panel = parsed.data;
  const catalog = PromptExampleCatalogV1Schema.parse(input.catalog ?? PROMPT_EXAMPLE_CATALOG_V1);
  const prior = PriorNoveltyUniverseV1Schema.parse(input.priorNoveltyUniverse ?? {
    priorObjectAliases: [], priorRelationTuples: []
  });
  const digests = await holdoutCommitment(panel);
  const knownAliases = new Set([
    ...PUBLIC_OBJECT_ALIASES,
    ...catalog.examples.flatMap((item) => item.objectAliases),
    ...prior.priorObjectAliases
  ].map(normalizeGeneralityText));
  const knownRelations = new Set([
    ...publicRelationKeys(),
    ...catalog.examples.map((item) => relationTupleKey(item.relationTuple)),
    ...prior.priorRelationTuples.map(relationTupleKey)
  ]);
  const novelCaseCount = panel.cases.filter((item) =>
    item.objectAliases.some((alias) => !knownAliases.has(normalizeGeneralityText(alias))) ||
    !knownRelations.has(relationTupleKey(item.relationTuple))
  ).length;
  const paraphrases = panel.cases.filter((item) => item.paraphraseOfIterationCaseId !== null);
  const paraphrasePass = paraphrases.length >= DISTRIBUTION_TEMPLATE.minimumParaphraseCases && paraphrases.every((item) => {
    const iterationId = item.paraphraseOfIterationCaseId!;
    return relationTupleKey(item.relationTuple) === relationTupleKey(ITERATION_SEMANTICS[iterationId]) &&
      normalizeGeneralityText(item.syntheticBrief) !== normalizeGeneralityText(ITERATION_BRIEFS[iterationId]);
  });
  const comparatorMappingPass = panel.cases.every((item) => ITERATION_CASE_IDS.includes(item.comparatorClass));
  const reportWithoutPass = {
    schemaVersion: "1.0" as const,
    distributionTemplateVersion: HOLDOUT_DISTRIBUTION_TEMPLATE_VERSION,
    noveltyPolicyVersion: HOLDOUT_PANEL_NOVELTY_POLICY_VERSION,
    distributionPolicyHash: await hashCanonical(DISTRIBUTION_TEMPLATE),
    noveltyPolicyHash: await hashCanonical(NOVELTY_POLICY),
    commitmentMatches: digests.commitment === input.expectedCommitment,
    schemaPass: true,
    distributionPass: distributionPass(panel.protocol),
    noveltyPass: novelCaseCount >= DISTRIBUTION_TEMPLATE.minimumNovelCases,
    comparatorMappingPass,
    paraphrasePass,
    novelCaseCount,
    panelDigest: digests.panelDigest,
    comparatorMappingDigest: digests.comparatorMappingDigest
  };
  return HoldoutPolicyReportV1Schema.parse({
    ...reportWithoutPass,
    pass: reportWithoutPass.commitmentMatches && reportWithoutPass.schemaPass &&
      reportWithoutPass.distributionPass && reportWithoutPass.noveltyPass &&
      reportWithoutPass.comparatorMappingPass && reportWithoutPass.paraphrasePass
  });
}

export async function holdoutDistributionPolicyHash(): Promise<string> {
  return hashCanonical(DISTRIBUTION_TEMPLATE);
}

export async function holdoutNoveltyPolicyHash(): Promise<string> {
  return hashCanonical(NOVELTY_POLICY);
}
