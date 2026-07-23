import { z } from "zod";

import { authorizedEvidenceIds } from "../interpretation/source-evidence.js";
import type { GenerationOutcome } from "../interpretation/generation-outcome.js";
import type { SemanticInterpretation } from "../interpretation/semantic-interpretation.js";
import type { SemanticGenerationRequest } from "../interpretation/semantic-request.js";
import {
  SemanticEvaluationOutcomeKindSchema,
  SemanticEvaluationOutcomePolicySchema,
  type SEMANTIC_GENERALIZATION_CORPUS,
  type SemanticEvaluationOutcomePolicy
} from "./semantic-generalization.js";

type SemanticCase = (typeof SEMANTIC_GENERALIZATION_CORPUS.cases)[number];

export const SemanticPredicateResultSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/u),
  pass: z.boolean()
}).strict();

export const SemanticCaseOracleScoreSchema = z.object({
  caseId: z.string().min(1),
  strictInterpretation: z.boolean(),
  commitmentPredicates: z.array(SemanticPredicateResultSchema),
  contextPredicates: z.array(SemanticPredicateResultSchema),
  prohibitedBindingPredicates: z.array(SemanticPredicateResultSchema),
  outcomePolicy: SemanticEvaluationOutcomePolicySchema,
  observedOutcomeKind: z.enum([
    ...SemanticEvaluationOutcomeKindSchema.options,
    "failure"
  ]),
  outcomeAccepted: z.boolean(),
  primaryPass: z.boolean(),
  evidenceGrounded: z.boolean(),
  inventoryProjectionCoverage: z.boolean()
}).strict();

export type SemanticCaseOracleScore = z.infer<typeof SemanticCaseOracleScoreSchema>;

export function interpretationFromOutcome(outcome: GenerationOutcome): SemanticInterpretation | null {
  if (outcome.kind === "supported" ||
      outcome.kind === "simplified" ||
      outcome.kind === "modified") {
    return outcome.source.interpretation;
  }
  if (outcome.kind === "concept-only") return outcome.interpretation;
  return null;
}

function scoreInterpretation(
  testCase: SemanticCase,
  interpretation: SemanticInterpretation,
  request: SemanticGenerationRequest,
) {
  const projection = interpretation.projection;
  const nonContextItems = interpretation.inventory.items.filter((item) => item.importance !== "context");
  const contextItems = interpretation.inventory.items.filter((item) => item.importance === "context");
  const accounting = new Map(projection.accounting.map((item) => [item.itemId, item]));
  const hasRequirement = (kind: (typeof projection.requirements)[number]["kind"], priority: "must" | "prefer" | null = null) =>
    projection.requirements.some((item) => item.kind === kind && (priority === null || item.priority === priority));
  const hasAccess = (kind: (typeof projection.access)[number]["kind"]) =>
    projection.access.some((item) => item.kind === kind);
  const hasObject = (role: (typeof projection.objects)[number]["role"], engagement: (typeof projection.objects)[number]["engagement"]) =>
    projection.objects.some((item) => item.role === role && item.engagement === engagement);
  const hasCapability = (capabilityId: string) =>
    projection.accounting.some((item) => item.state === "bound" && item.capabilityIds.includes(capabilityId));
  const hasOrganizationCount = (count: number) => projection.organization.some((item) =>
    item.basis === "explicit-count" && item.desiredSpaceCount === count
  );
  const hasOrganizationGrid = (rows: number, columns: number) => projection.organization.some((item) =>
    item.basis === "explicit-grid" &&
    item.rows === rows && item.columns === columns &&
    item.desiredSpaceCount === rows * columns
  );
  const hasMinimumSeparatedOrganization = () => projection.organization.some((item) =>
    item.basis === "minimum-separated-policy" &&
    item.desiredSpaceCount === 2 &&
    item.rows === null &&
    item.columns === null
  );
  const hasExplicitSingleSpace = () => projection.organization.some((item) =>
    item.basis === "explicit-single-space" &&
    item.desiredSpaceCount === 1 &&
    item.rows === null &&
    item.columns === null
  );
  const hasDefaultSingleSpace = () => projection.organization.some((item) =>
    item.basis === "default-single-space-policy" &&
    item.desiredSpaceCount === 1 &&
    item.rows === null &&
    item.columns === null
  );
  const hasOrganization = () => projection.organization.some((item) =>
    item.desiredSpaceCount > 1
  );
  const hasMatchingAccessAperture = () => projection.cutThrough.some((aperture) =>
    aperture.purpose === "access" &&
    aperture.fixedTopAccess &&
    projection.access.some((access) =>
      access.bodyId === aperture.bodyId &&
      access.kind === "covered" &&
      access.direction === "top" &&
      access.requirementId === aperture.requirementId
    )
  );
  const hasRigid = () => hasCapability("rigid-orthogonal-sheet-assembly") || hasRequirement("rigid-interface", "must");
  const hasEssentialOperationBound = () => nonContextItems.some((item) =>
    item.importance === "essential" && item.aspects.includes("operation") && accounting.get(item.id)?.state === "bound"
  );
  const contextPreserved = (expectedMinimum = 1) => [{
    code: "CONTEXT_ITEM_PRESERVED",
    pass: contextItems.length >= expectedMinimum &&
      contextItems.every((item) => !accounting.has(item.id))
  }];
  const deferredSurfaceCount = projection.accounting.filter((record) => {
    const item = interpretation.inventory.items.find((candidate) => candidate.id === record.itemId);
    return record.state === "deferred" && item?.aspects.includes("surface") === true;
  }).length;
  const predicates = (...items: readonly (readonly [string, boolean])[]) =>
    items.map(([code, pass]) => ({ code, pass }));

  let commitmentPredicates: { code: string; pass: boolean }[];
  let contextPredicates: { code: string; pass: boolean }[] = [];
  let prohibitedBindingPredicates: { code: string; pass: boolean }[] = [];
  switch (testCase.id) {
    case "unfamiliar-purpose-structure-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      contextPredicates = contextPreserved();
      break;
    case "familiar-noun-scale-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_CONTEXT_OPERATION", hasEssentialOperationBound()]);
      break;
    case "covered-access-context-control-a-dev":
    case "covered-access-context-control-b-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_CONTEXT_OPERATION", hasEssentialOperationBound()]);
      break;
    case "organization-count-composite-control-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_FOUR_SPACES_EXPLICIT_COUNT", hasOrganizationCount(4)]
      );
      contextPredicates = contextPreserved();
      break;
    case "organization-grid-composite-control-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_TWO_BY_THREE_EXPLICIT_GRID", hasOrganizationGrid(2, 3)]
      );
      contextPredicates = contextPreserved();
      break;
    case "storage-purpose-nonorganization-control-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_EXPLICIT_SINGLE_SPACE", hasExplicitSingleSpace()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_STORAGE_PURPOSE_ORGANIZATION", hasOrganization()]);
      break;
    case "storage-context-nonorganization-control-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_EXPLICIT_SINGLE_SPACE", hasExplicitSingleSpace()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_ARCHIVE_CONTEXT_ORGANIZATION", hasOrganization()]);
      break;
    case "bare-storage-name-nonorganization-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_DEFAULT_SINGLE_SPACE", hasDefaultSingleSpace()]
      );
      prohibitedBindingPredicates = predicates(["PROHIBITED_BARE_STORAGE_MULTI_SPACE", hasOrganization()]);
      break;
    case "paraphrase-open-access-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_RIGID_CONSTRUCTION", hasRigid()]
      );
      break;
    case "functional-name-separation-dev":
    case "implicit-open-separation-organization-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()]
      );
      break;
    case "implicit-covered-case-organization-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()]
      );
      break;
    case "noun-swap-relationship-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered")],
        ["COMMITMENT_THREE_SPACES", hasOrganizationCount(3)]
      );
      break;
    case "relationship-swap-contained-dev":
      commitmentPredicates = predicates([
        "COMMITMENT_FULL_ENVELOPE_CONTAINMENT",
        hasRequirement("containment", "must") && hasObject("contained", "full-envelope")
      ]);
      break;
    case "typo-colloquial-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      break;
    case "irrelevant-image-object-dev":
      commitmentPredicates = predicates([
        "COMMITMENT_OPEN_CONTAINER",
        hasRequirement("containment", "must") && hasAccess("open-top")
      ]);
      contextPredicates = contextPreserved();
      break;
    case "reference-role-purpose-control-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_PROPORTION", projection.proportions.length > 0],
        ["COMMITMENT_JOINT_STRUCTURE", hasRigid()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(
        ["PROHIBITED_AUTOMATIC_OPERATION", hasEssentialOperationBound()],
        ["PROHIBITED_SURFACE_ROLE_ESCAPE", deferredSurfaceCount < 1]
      );
      break;
    case "reference-role-purpose-control-a-dev":
    case "reference-role-exclusion-control-b-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_SUPPORTED_ENCLOSURE", hasRequirement("containment", "must") || hasRequirement("support", "must")],
        ["COMMITMENT_ACCESS_OPENING", hasMatchingAccessAperture()],
        ["COMMITMENT_PROPORTION", projection.proportions.length > 0],
        ["COMMITMENT_JOINT_STRUCTURE", hasRigid()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(
        ["PROHIBITED_AUTOMATIC_OPERATION", hasEssentialOperationBound()],
        ["PROHIBITED_SURFACE_ROLE_ESCAPE", deferredSurfaceCount < 1],
        ["PROHIBITED_CUT_THROUGH_ROLE_ESCAPE", projection.cutThrough.some((item) =>
          item.purpose !== "access" && item.evidenceIds.some((evidenceId) => evidenceId.startsWith("reference-")))]
      );
      break;
    case "reference-role-both-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_REFERENCE_STRUCTURE", projection.constructionBodies.length > 0 && hasRigid()],
        ["COMMITMENT_REFERENCE_SURFACE", projection.motif !== null || hasRequirement("visual-treatment")]
      );
      break;
    case "measurement-ordinary-dev":
      commitmentPredicates = predicates([
        "COMMITMENT_EXACT_EXTERNAL_WIDTH",
        interpretation.inventory.measurementTargets.some((item) =>
          item.interpretation === "exact" && item.target.subject === "project" &&
          item.target.envelope === "external" && item.target.axis === "width")
      ]);
      break;
    case "measurement-ambiguous-dev":
      commitmentPredicates = predicates([
        "COMMITMENT_AMBIGUOUS_MEASUREMENT",
        interpretation.inventory.measurementTargets.some((item) =>
          item.interpretation === "ambiguous" || item.interpretation === "approximate")
      ]);
      break;
    case "supported-unfamiliar-style-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["PREFERENCE_VISUAL_MOOD", nonContextItems.some((item) => item.importance === "preference" && item.aspects.includes("surface"))]
      );
      break;
    case "review-correctable-coverage-dev":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      break;
    default:
      throw new Error(`SEMANTIC_ORACLE_CASE_UNREGISTERED:${testCase.id}`);
  }

  const authorized = authorizedEvidenceIds(request.sourceEvidenceIndex);
  const evidenceGrounded = interpretation.inventory.items.every((item) =>
    item.evidenceBindings.every((binding) => authorized.has(binding.evidenceId))
  ) && projection.requirements.every((item) => item.evidenceIds.every((id) => authorized.has(id)));
  const commitmentIds = nonContextItems.map((item) => item.id).sort();
  const accountingIds = projection.accounting.map((item) => item.itemId).sort();
  const inventoryProjectionCoverage = JSON.stringify(commitmentIds) === JSON.stringify(accountingIds) &&
    projection.accounting.every((item) => item.state !== "bound" ||
      item.requirementIds.length + item.bodyIds.length + item.interfaceIds.length +
      item.relationIds.length + item.capabilityIds.length > 0);
  return {
    commitmentPredicates,
    contextPredicates,
    prohibitedBindingPredicates,
    evidenceGrounded,
    inventoryProjectionCoverage
  };
}

function outcomeAccepted(
  policy: SemanticEvaluationOutcomePolicy,
  outcome: GenerationOutcome,
): boolean {
  if (outcome.kind === "failure" || !policy.allowedKinds.includes(outcome.kind)) {
    return false;
  }
  if (!policy.exportRequired) return true;
  return (outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified") &&
    outcome.exportAllowed;
}

export function scoreSemanticCaseOracle(input: {
  testCase: SemanticCase;
  request: SemanticGenerationRequest;
  outcome: GenerationOutcome;
}): SemanticCaseOracleScore {
  const interpretation = interpretationFromOutcome(input.outcome);
  const outcomePolicy = input.testCase.expected.outcomePolicy;
  if (interpretation === null) {
    return SemanticCaseOracleScoreSchema.parse({
      caseId: input.testCase.id,
      strictInterpretation: false,
      commitmentPredicates: [],
      contextPredicates: [],
      prohibitedBindingPredicates: [],
      outcomePolicy,
      observedOutcomeKind: input.outcome.kind,
      outcomeAccepted: false,
      primaryPass: false,
      evidenceGrounded: false,
      inventoryProjectionCoverage: false
    });
  }
  const interpreted = scoreInterpretation(input.testCase, interpretation, input.request);
  const accepted = outcomeAccepted(outcomePolicy, input.outcome);
  const primaryPass = accepted && interpreted.evidenceGrounded &&
    interpreted.inventoryProjectionCoverage &&
    interpreted.commitmentPredicates.every((item) => item.pass) &&
    interpreted.contextPredicates.every((item) => item.pass) &&
    interpreted.prohibitedBindingPredicates.every((item) => !item.pass);
  return SemanticCaseOracleScoreSchema.parse({
    caseId: input.testCase.id,
    strictInterpretation: true,
    ...interpreted,
    outcomePolicy,
    observedOutcomeKind: input.outcome.kind,
    outcomeAccepted: accepted,
    primaryPass
  });
}
