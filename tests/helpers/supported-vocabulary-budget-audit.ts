import { z } from "zod";

import type { InputPolicyEvaluation } from "../../src/domain/contracts.js";
import type { AppliedPinSetup } from "../../src/domain/fabrication-setup.js";
import { hashCanonical } from "../../src/domain/hash.js";
import type { OrthogonalCompileProfiles } from "../../src/operators/orthogonal-compiler.js";
import {
  CONSTRUCTION_PLANNER_VERSION,
  DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET,
  constructionPlannerPolicyHash,
  planIntentConditionedConstruction
} from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import type { ClosedSemanticProjection } from "../../src/interpretation/semantic-interpretation.js";
import { synthesizeSymbolicTopologies, topologySynthesisPolicyHash } from "../../src/interpretation/topology-synthesis.js";
import { closedProjectionForTest } from "./closed-semantic-projection.js";

export const SUPPORTED_VOCABULARY_BUDGET_AUDIT_VERSION = "supported-vocabulary-budget-audit-v1" as const;

const AccessMechanismPairSchema = z.enum([
  "open-top-rigid",
  "open-front-rigid",
  "covered-unspecified",
  "covered-retained-pin",
  "covered-captured-slide"
]);
const PrioritySchema = z.enum(["must", "prefer"]);

const PruningProofV1Schema = z.object({
  ruleId: z.string().min(1),
  eliminatedCandidates: z.number().int().nonnegative(),
  proof: z.string().min(1)
}).strict();

export const SupportedVocabularyBudgetAuditRecordV1Schema = z.object({
  combinationId: z.string().min(1),
  accessMechanismPair: AccessMechanismPairSchema,
  accessPriority: PrioritySchema,
  organizationPriority: PrioritySchema,
  canonicalSpaceCount: z.number().int().min(1).max(4),
  containment: z.literal("required-generic-object"),
  candidatesBeforeHardPruning: z.number().int().positive(),
  pruningProofs: z.array(PruningProofV1Schema),
  candidatesAfterHardPruning: z.number().int().positive(),
  candidatesSolved: z.number().int().nonnegative(),
  candidatesCompiled: z.number().int().nonnegative(),
  branchAndBoundProofs: z.array(z.string()),
  outcomeKind: z.enum(["planned", "concept-only", "failure"]),
  selectedCandidateId: z.string().nullable(),
  selectedSheetsWithinImportBudget: z.boolean().nullable(),
  unsupportedFindingCodes: z.array(z.string()),
  searchBudgetExhausted: z.boolean(),
  unexaminedCandidateCouldChangeResult: z.boolean(),
  allCompiledSheetsWithinImportBudget: z.boolean()
}).strict();

export const SupportedVocabularyBudgetAuditV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  auditVersion: z.literal(SUPPORTED_VOCABULARY_BUDGET_AUDIT_VERSION),
  auditPolicyHash: z.string().length(64),
  topologyPolicyHash: z.string().length(64),
  plannerPolicyHash: z.string().length(64),
  plannerVersion: z.literal(CONSTRUCTION_PLANNER_VERSION),
  candidateBudget: z.literal(DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET),
  completeCrossProduct: z.object({
    accessMechanismPairs: z.array(AccessMechanismPairSchema).length(5),
    accessPriorities: z.array(PrioritySchema).length(2),
    organizationPriorities: z.array(PrioritySchema).length(2),
    canonicalSpaceCounts: z.array(z.number().int()).length(4),
    excludedIncompatiblePairs: z.array(z.object({
      pair: z.string().min(1),
      proof: z.string().min(1)
    }).strict())
  }).strict(),
  records: z.array(SupportedVocabularyBudgetAuditRecordV1Schema).length(80),
  maximumCandidatesBeforeHardPruning: z.number().int().positive(),
  maximumCandidatesAfterHardPruning: z.number().int().positive(),
  maximumCandidatesSolved: z.number().int().positive(),
  maximumCandidatesCompiled: z.number().int().positive(),
  complete: z.boolean()
}).strict();

export type SupportedVocabularyBudgetAuditV1 = z.infer<typeof SupportedVocabularyBudgetAuditV1Schema>;

const ACCESS_MECHANISM_PAIRS = [
  "open-top-rigid",
  "open-front-rigid",
  "covered-unspecified",
  "covered-retained-pin",
  "covered-captured-slide"
] as const;
const PRIORITIES = ["must", "prefer"] as const;
const SPACE_COUNTS = [1, 2, 3, 4] as const;

const AUDIT_POLICY = {
  version: SUPPORTED_VOCABULARY_BUDGET_AUDIT_VERSION,
  accessMechanismPairs: ACCESS_MECHANISM_PAIRS,
  accessPriorities: PRIORITIES,
  organizationPriorities: PRIORITIES,
  canonicalSpaceCounts: SPACE_COUNTS,
  containment: "required-generic-object",
  exactSizing: "auto-unanchored",
  candidateBudget: DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET,
  exclusions: [
    {
      pair: "covered-fixed-interface",
      proof: "The registered orthogonal construction has no fixed or glued cover; unspecified covered access is realized only through a disclosed registered moving-cover construction."
    },
    {
      pair: "open-top-or-front-moving-cover",
      proof: "A retained-pin or captured-slide interface necessarily realizes covered access and cannot preserve an open-top or open-front hard requirement."
    },
    {
      pair: "retained-pin-non-width-axis",
      proof: "retained-pin-revolute@1.0.0 accepts only the registered width-axis section reduction."
    },
    {
      pair: "captured-slide-non-depth-axis",
      proof: "captured-panel-slide@1.3.0 accepts only the registered negative-depth translation and transverse-section proof."
    }
  ]
} as const;

function intentFor(input: {
  pair: typeof ACCESS_MECHANISM_PAIRS[number];
  accessPriority: typeof PRIORITIES[number];
  organizationPriority: typeof PRIORITIES[number];
  spaces: typeof SPACE_COUNTS[number];
}): ClosedSemanticProjection {
  const moving = input.pair === "covered-retained-pin" || input.pair === "covered-captured-slide";
  const retained = input.pair === "covered-retained-pin";
  const accessKind = input.pair === "open-front-rigid" ? "open-front" as const
    : moving || input.pair === "covered-unspecified" ? "covered" as const
    : "open-top" as const;
  const requirements = [
    {
      id: "containment-required",
      priority: "must",
      kind: "containment",
      semanticSummary: "Contain the generic object.",
      evidenceIds: ["audit-brief"]
    },
    {
      id: "access-request",
      priority: input.accessPriority,
      kind: "access",
      semanticSummary: `Use ${accessKind} access.`,
      evidenceIds: ["audit-brief"]
    },
    ...(input.spaces > 1 ? [{
      id: "organization-request",
      priority: input.organizationPriority,
      kind: "organization",
      semanticSummary: `Provide ${String(input.spaces)} canonical spaces.`,
      evidenceIds: ["audit-brief"]
    }] : []),
    ...(moving ? [{
      id: "moving-cover-required",
      priority: "must" as const,
      kind: retained ? "revolute-interface" as const : "prismatic-interface" as const,
      semanticSummary: retained ? "Retain a revolute cover." : "Capture a sliding cover.",
      evidenceIds: ["audit-brief"]
    }] : [])
  ];
  return closedProjectionForTest({
    schemaVersion: "2.4",
    title: "Supported-vocabulary budget audit",
    purpose: "Exercise one complete registered semantic construction combination.",
    requirements,
    constructionBodies: [
      {
        id: "primary-body",
        role: "primary-enclosure",
        shapeClass: "orthogonal-shell",
        requirementIds: requirements.map((item) => item.id),
        evidenceIds: ["audit-brief"]
      },
      ...(moving ? [{
        id: "moving-cover",
        role: "cover" as const,
        shapeClass: "planar" as const,
        requirementIds: ["moving-cover-required"],
        evidenceIds: ["audit-brief"]
      }] : [])
    ],
    objects: [{
      id: "generic-contained-object",
      role: "contained",
      engagement: "full-envelope",
      semanticLabel: "generic object",
      quantity: 1,
      evidenceIds: ["audit-brief"]
    }],
    interfaces: moving ? [{
      id: "moving-cover-interface",
      betweenBodyIds: ["primary-body", "moving-cover"],
      behavior: retained ? "revolute" : "prismatic",
      axis: retained ? "width" : "depth",
      requirementIds: ["moving-cover-required"],
      evidenceIds: ["audit-brief"]
    }] : [],
    access: [{
      bodyId: "primary-body",
      kind: accessKind,
      direction: accessKind === "open-front" ? "front" : "top",
      basis: accessKind === "open-front"
        ? "explicit-open-front"
        : accessKind === "covered"
          ? "explicit-covered-top"
          : "explicit-open-top",
      priority: input.accessPriority,
      requirementId: "access-request",
      evidenceIds: ["audit-brief"]
    }],
    organization: input.spaces > 1 ? [{
      bodyId: "primary-body",
      desiredSpaceCount: input.spaces,
      rows: null,
      columns: null,
      basis: "explicit-count",
      priority: input.organizationPriority,
      requirementId: "organization-request",
      evidenceIds: ["audit-brief"]
    }] : [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compact-goal", kind: "compactness", rank: 1, evidenceIds: ["audit-brief"] }],
    motif: null,
    cutThrough: [],
    referenceBrief: [],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  });
}

function beforePruningCount(input: {
  pair: typeof ACCESS_MECHANISM_PAIRS[number];
  accessPriority: typeof PRIORITIES[number];
  organizationPriority: typeof PRIORITIES[number];
  spaces: typeof SPACE_COUNTS[number];
}): number {
  const topologyChoices = input.pair === "covered-unspecified"
    ? input.accessPriority === "prefer" ? 3 : 2
    : input.accessPriority === "prefer" && input.pair !== "open-top-rigid" ? 2 : 1;
  const requestedOrganizationChoices = input.spaces === 1 ? 1 : 2;
  const fallbackChoices = input.organizationPriority === "prefer" && input.spaces > 1 ? 1 : 0;
  return topologyChoices * (requestedOrganizationChoices + fallbackChoices);
}

export async function runSupportedVocabularyBudgetAudit(input: {
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
}): Promise<SupportedVocabularyBudgetAuditV1> {
  const exactConstraints = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" },
    parsedConstraints: [],
    parserFindings: []
  });
  const records: z.infer<typeof SupportedVocabularyBudgetAuditRecordV1Schema>[] = [];
  for (const pair of ACCESS_MECHANISM_PAIRS) {
    for (const accessPriority of PRIORITIES) {
      for (const organizationPriority of PRIORITIES) {
        for (const spaces of SPACE_COUNTS) {
          const intent = intentFor({ pair, accessPriority, organizationPriority, spaces });
          const synthesis = await synthesizeSymbolicTopologies(intent);
          if (synthesis.kind !== "candidates") {
            throw new Error(`SUPPORTED_VOCABULARY_SYNTHESIS_REGRESSION:${pair}:${accessPriority}:${organizationPriority}:${String(spaces)}`);
          }
          const candidatesBeforeHardPruning = beforePruningCount({ pair, accessPriority, organizationPriority, spaces });
          const eliminated = candidatesBeforeHardPruning - synthesis.candidates.length;
          if (eliminated < 0) throw new Error("SUPPORTED_VOCABULARY_PRUNING_COUNT_INVALID");
          const outcome = await planIntentConditionedConstruction({
            projection: intent,
            explicitConstraints: exactConstraints,
            profiles: input.profiles,
            inputPolicyEvaluation: input.inputPolicyEvaluation,
            pin: input.pin
          });
          const candidates = outcome.candidates;
          const compiled = candidates.filter((item) => item.compiled !== null);
          records.push(SupportedVocabularyBudgetAuditRecordV1Schema.parse({
            combinationId: `${pair}-${accessPriority}-access-${organizationPriority}-organization-${String(spaces)}-spaces`,
            accessMechanismPair: pair,
            accessPriority,
            organizationPriority,
            canonicalSpaceCount: spaces,
            containment: "required-generic-object",
            candidatesBeforeHardPruning,
            pruningProofs: eliminated === 0 ? [] : [{
              ruleId: "equivalent-moving-cover-access-collapse",
              eliminatedCandidates: eliminated,
              proof: "A registered moving-cover interface fixes covered access, so open-top fallback expansion resolves to byte-equivalent covered topology and is removed by canonical topology identity."
            }],
            candidatesAfterHardPruning: synthesis.candidates.length,
            candidatesSolved: candidates.length,
            candidatesCompiled: compiled.length,
            branchAndBoundProofs: [],
            outcomeKind: outcome.kind,
            selectedCandidateId: outcome.kind === "planned" ? outcome.selected.candidateId : null,
            selectedSheetsWithinImportBudget: outcome.kind === "planned"
              ? outcome.selected.compiled!.importComplexity.every((sheet) => sheet.withinCurrentLimit)
              : null,
            unsupportedFindingCodes: outcome.kind === "planned" ? [] : outcome.findings.map((item) => item.code),
            searchBudgetExhausted: outcome.kind === "failure",
            unexaminedCandidateCouldChangeResult: candidates.length !== synthesis.candidates.length,
            allCompiledSheetsWithinImportBudget: compiled.every((item) =>
              item.compiled!.importComplexity.every((sheet) => sheet.withinCurrentLimit)
            )
          }));
        }
      }
    }
  }
  const maximum = (key: "candidatesBeforeHardPruning" | "candidatesAfterHardPruning" | "candidatesSolved" | "candidatesCompiled") =>
    Math.max(...records.map((item) => item[key]));
  const complete = records.length === 80 && records.every((item) =>
    !item.searchBudgetExhausted &&
    !item.unexaminedCandidateCouldChangeResult &&
    item.outcomeKind !== "failure" &&
    (item.outcomeKind === "planned"
      ? item.selectedCandidateId !== null && item.selectedSheetsWithinImportBudget === true
      : item.selectedCandidateId === null && item.unsupportedFindingCodes.length > 0)
  );
  return SupportedVocabularyBudgetAuditV1Schema.parse({
    schemaVersion: "1.0",
    auditVersion: SUPPORTED_VOCABULARY_BUDGET_AUDIT_VERSION,
    auditPolicyHash: await hashCanonical(AUDIT_POLICY),
    topologyPolicyHash: await topologySynthesisPolicyHash(),
    plannerPolicyHash: await constructionPlannerPolicyHash(),
    plannerVersion: CONSTRUCTION_PLANNER_VERSION,
    candidateBudget: DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET,
    completeCrossProduct: {
      accessMechanismPairs: [...ACCESS_MECHANISM_PAIRS],
      accessPriorities: [...PRIORITIES],
      organizationPriorities: [...PRIORITIES],
      canonicalSpaceCounts: [...SPACE_COUNTS],
      excludedIncompatiblePairs: AUDIT_POLICY.exclusions
    },
    records,
    maximumCandidatesBeforeHardPruning: maximum("candidatesBeforeHardPruning"),
    maximumCandidatesAfterHardPruning: maximum("candidatesAfterHardPruning"),
    maximumCandidatesSolved: maximum("candidatesSolved"),
    maximumCandidatesCompiled: maximum("candidatesCompiled"),
    complete
  });
}

export async function supportedVocabularyBudgetAuditPolicyHash(): Promise<string> {
  return hashCanonical(AUDIT_POLICY);
}
