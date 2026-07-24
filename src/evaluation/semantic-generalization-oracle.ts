import { z } from "zod";

import { authorizedEvidenceIds } from "../interpretation/source-evidence.js";
import type { GenerationOutcome } from "../interpretation/generation-outcome.js";
import type { SemanticInterpretation } from "../interpretation/semantic-interpretation.js";
import type { SemanticGenerationRequest } from "../interpretation/semantic-request.js";
import {
  SemanticEvaluationOutcomeKindSchema,
  SemanticEvaluationOutcomePolicySchema,
  type SEMANTIC_GENERALIZATION_CORPUS,
  type SemanticGeneralizationCaseId,
  type SemanticEvaluationOutcomePolicy
} from "./semantic-generalization.js";

type SemanticCase = (typeof SEMANTIC_GENERALIZATION_CORPUS.cases)[number];

const SEMANTIC_ORACLE_RULE_BY_CASE = {
  "unfamiliar-purpose-structure-dev": "unfamiliar-purpose-structure",
  "familiar-noun-scale-dev": "familiar-noun-scale",
  "paraphrase-open-access-dev": "paraphrase-open-access",
  "functional-name-separation-dev": "open-separation-organization",
  "bare-storage-name-nonorganization-dev": "bare-storage-name-nonorganization",
  "implicit-open-separation-organization-dev": "open-separation-organization",
  "implicit-covered-case-organization-dev": "implicit-covered-case-organization",
  "noun-swap-relationship-dev": "noun-swap-relationship",
  "relationship-swap-contained-dev": "relationship-swap-contained",
  "typo-colloquial-dev": "typo-colloquial",
  "irrelevant-image-object-dev": "irrelevant-image-object",
  "reference-role-purpose-control-dev": "reference-role-purpose-control",
  "reference-role-both-dev": "reference-role-both",
  "measurement-ordinary-dev": "measurement-ordinary",
  "measurement-ambiguous-dev": "measurement-ambiguous",
  "supported-unfamiliar-style-dev": "supported-unfamiliar-style",
  "review-correctable-coverage-dev": "review-correctable-coverage",
  "covered-access-context-control-a-dev": "covered-access-context-control",
  "covered-access-context-control-b-dev": "covered-access-context-control",
  "reference-role-purpose-control-a-dev": "reference-role-structure-only",
  "reference-role-exclusion-control-b-dev": "reference-role-structure-only",
  "organization-count-composite-control-dev": "organization-count-composite-control",
  "organization-grid-composite-control-dev": "organization-grid-composite-control",
  "storage-purpose-nonorganization-control-dev": "storage-purpose-nonorganization-control",
  "storage-context-nonorganization-control-dev": "storage-context-nonorganization-control",
  "substitution-lossy-flexure-positive-dev": "substitution-apply",
  "substitution-partitioned-flexure-positive-dev": "substitution-apply",
  "substitution-refusal-omission-dev": "substitution-refusal-fallback",
  "substitution-refusal-concept-only-dev": "substitution-refusal-concept-only",
  "substitution-direct-support-wins-dev": "direct-support-wins",
  "flexure-surface-negative-control-dev": "flexure-surface-negative",
  "flexure-context-negative-control-dev": "flexure-context-negative"
} as const satisfies Record<SemanticGeneralizationCaseId, string>;

type SemanticOracleRuleId =
  (typeof SEMANTIC_ORACLE_RULE_BY_CASE)[SemanticGeneralizationCaseId];

export function registeredSemanticOracleCaseIds(): SemanticGeneralizationCaseId[] {
  return (Object.keys(SEMANTIC_ORACLE_RULE_BY_CASE) as SemanticGeneralizationCaseId[])
    .toSorted();
}

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
  outcome: GenerationOutcome,
  candidateUnsupportedSignatureIds: readonly string[],
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
  const expected = testCase.expected;
  const trace = outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
    ? outcome.source.substitutionTrace
    : outcome.kind === "concept-only"
      ? outcome.substitutionTrace
      : null;
  const coverage = outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
    ? outcome.source.requestCoverage
    : null;
  const inventoryRealization = outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
    ? outcome.source.inventoryRealization
    : outcome.kind === "concept-only"
      ? outcome.inventoryRealization
      : null;
  const retainedScopeDecision = outcome.kind === "supported" ||
    outcome.kind === "simplified" ||
    outcome.kind === "modified"
    ? outcome.source.retainedScopeDecision
    : null;
  const exact = (actual: readonly string[], required: readonly string[]) =>
    JSON.stringify([...actual].toSorted()) ===
      JSON.stringify([...required].toSorted());
  const coverageDisposition = (
    itemId: string,
  ): "included" | "changed" | "omitted" | null => {
    if (coverage?.includedSemanticIds.includes(itemId) === true) return "included";
    if (coverage?.changedSemanticIds.includes(itemId) === true) return "changed";
    if (coverage?.omittedSemanticIds.includes(itemId) === true) return "omitted";
    return null;
  };
  const expectedDispositionForRealization = (
    state: NonNullable<typeof inventoryRealization>["records"][number]["realizationState"],
  ): "included" | "changed" | "omitted" =>
    state === "realized"
      ? "included"
      : state === "substituted" ||
          state === "simplified" ||
          state === "deferred"
        ? "changed"
        : "omitted";
  const derivedCoverageExact = expected.coveragePolicy === undefined
    ? true
    : inventoryRealization?.records.every((record) =>
        coverageDisposition(record.itemId) ===
          expectedDispositionForRealization(record.realizationState)
      ) === true;
  const derivedCoverageDisclosed = expected.coveragePolicy === undefined
    ? true
    : inventoryRealization?.records.every((record) =>
        record.realizationState === "realized" || record.disclosure !== null
      ) === true;
  const retainedScopeDecisionAccounted = retainedScopeDecision === null
    ? true
    : inventoryRealization !== null &&
      retainedScopeDecision.omittedInventoryItemIds.every((itemId) =>
        coverageDisposition(itemId) === (
          interpretation.inventory.items.find((item) =>
            item.id === itemId
          )?.importance === "preference"
            ? "changed"
            : "omitted"
        ) &&
        inventoryRealization.records.some((record) =>
          record.itemId === itemId &&
          record.reason === "DETERMINISTIC_RETAINED_SCOPE_OMISSION" &&
          record.disclosure !== null
        )
      ) &&
      exact(
        retainedScopeDecision.disclosures.map((item) => item.semanticId),
        retainedScopeDecision.omittedInventoryItemIds,
      );
  const coverageSelectorPredicates = expected.coveragePolicy?.selectors.map(
    (selector, index) => {
      const matching = interpretation.inventory.items.filter((item) => {
        const accountingRecord = accounting.get(item.id);
        const disposition = coverageDisposition(item.id);
        return selector.aspectsAny.some((aspect) =>
          item.aspects.includes(aspect)
        ) &&
          accountingRecord !== undefined &&
          selector.accountingStates.includes(accountingRecord.state) &&
          disposition !== null &&
          selector.allowedDispositions.includes(disposition);
      });
      return {
        code: `COMMITMENT_DERIVED_COVERAGE_SELECTOR_${String(index + 1)}`,
        pass: matching.length >= selector.minimumCount
      };
    },
  ) ?? [];
  const tracePolicyPredicates = expected.substitutionTracePolicy === undefined
    ? []
    : (() => {
        const policy = expected.substitutionTracePolicy;
        const targetSelected =
          candidateUnsupportedSignatureIds.includes(policy.signatureId) ||
          trace?.selectedUnsupportedSignatureIds.includes(policy.signatureId) ===
            true;
        const noActivity = trace !== null &&
          !trace.substitutionSearchEntered &&
          trace.substitutionSearchAttemptCount === 0 &&
          trace.consideredEdgeIds.length === 0 &&
          trace.refusedEdgeIds.length === 0 &&
          trace.appliedEdgeIds.length === 0;
        const signaturePass = trace !== null && (
          policy.mode === "prohibited" ||
            (policy.mode === "conditional-refuse" && !targetSelected)
            ? !targetSelected &&
              !trace.selectedUnsupportedSignatureIds.includes(policy.signatureId)
            : exact(trace.selectedUnsupportedSignatureIds, [policy.signatureId])
        );
        const searchPass = trace !== null && (
          policy.mode === "prohibited" ||
            (policy.mode === "conditional-refuse" && !targetSelected)
            ? noActivity
            : trace.substitutionSearchEntered &&
              trace.substitutionSearchAttemptCount === policy.exactAttemptCount &&
              exact(trace.consideredEdgeIds, [policy.edgeId])
        );
        const resolutionPass = trace !== null && (
          policy.mode === "must-apply"
            ? exact(trace.appliedEdgeIds, [policy.edgeId]) &&
              trace.refusedEdgeIds.length === 0
            : policy.mode === "must-refuse" ||
                (policy.mode === "conditional-refuse" && targetSelected)
              ? exact(trace.refusedEdgeIds, [policy.edgeId]) &&
                trace.appliedEdgeIds.length === 0
              : trace.appliedEdgeIds.length === 0 &&
                trace.refusedEdgeIds.length === 0
        );
        return predicates(
          ["COMMITMENT_SUBSTITUTION_SIGNATURE_POLICY", signaturePass],
          ["COMMITMENT_SUBSTITUTION_SEARCH_POLICY", searchPass],
          ["COMMITMENT_SUBSTITUTION_RESOLUTION_POLICY", resolutionPass],
        );
      })();
  const requirementById = new Map(
    projection.requirements.map((requirement) => [requirement.id, requirement]),
  );
  const requirementCoverage = (
    requirementId: string,
    disposition: "changed" | "omitted",
  ): boolean => {
    const ids = disposition === "changed"
      ? coverage?.changedSemanticIds ?? []
      : coverage?.omittedSemanticIds ?? [];
    if (ids.includes(requirementId)) return true;
    if (
      disposition === "omitted" &&
      retainedScopeDecision?.omittedRequirementIds.includes(requirementId) ===
      true
    ) {
      const requirement = requirementById.get(requirementId);
      return requirement?.inventoryItemIds.every((itemId) =>
          retainedScopeDecision.omittedInventoryItemIds.includes(itemId) &&
          coverage?.omittedSemanticIds.includes(itemId) === true
        ) === true;
    }
    return requirementById.get(requirementId)?.inventoryItemIds.some((itemId) =>
      ids.includes(itemId)
    ) === true;
  };
  const appliedSubstitutionPredicates = trace === null ||
      trace.appliedSubstitutions.length === 0
    ? []
    : predicates(
        [
          "COMMITMENT_SUBSTITUTION_REQUIREMENT_PARTITION",
          trace.appliedSubstitutions.every((application) => {
            const partition = [
              ...application.preservedMustRequirementIds,
              ...application.changedMustRequirementIds,
              ...application.omittedMustRequirementIds
            ];
            return new Set(partition).size === partition.length &&
              exact(partition, application.preEdgeMustRequirementIds);
          })
        ],
        [
          "COMMITMENT_SUBSTITUTION_PRESERVED_REQUIREMENTS_REALIZED",
          (outcome.kind === "supported" ||
            outcome.kind === "simplified" ||
            outcome.kind === "modified") &&
            trace.appliedSubstitutions.every((application) =>
              application.preservedMustRequirementIds.every((requirementId) => {
                const record = outcome.source.requirementRealization.records.find(
                  (candidate) => candidate.requirementId === requirementId,
                );
                return record !== undefined &&
                  !["unsupported", "uncertain"].includes(record.state) &&
                  record.evidenceLinks.length > 0;
              })
            )
        ],
        [
          "COMMITMENT_SUBSTITUTION_CHANGED_REQUIREMENTS_DISCLOSED",
          coverage !== null && trace.appliedSubstitutions.every((application) =>
            application.changedMustRequirementIds.every((requirementId) =>
              requirementCoverage(requirementId, "changed")
            )
          )
        ],
        [
          "COMMITMENT_SUBSTITUTION_OMITTED_REQUIREMENTS_DISCLOSED",
          coverage !== null && trace.appliedSubstitutions.every((application) =>
            application.omittedMustRequirementIds.every((requirementId) =>
              requirementCoverage(requirementId, "omitted")
            )
          )
        ],
      );
  const requiredContractPredicates = (): { code: string; pass: boolean }[] => [
    ...(expected.coveragePolicy === undefined ? [] : predicates(
      ["COMMITMENT_DERIVED_COVERAGE_EXACT", derivedCoverageExact],
      ["COMMITMENT_DERIVED_COVERAGE_DISCLOSED", derivedCoverageDisclosed],
      [
        "COMMITMENT_RETAINED_SCOPE_DECISION_ACCOUNTED",
        retainedScopeDecisionAccounted
      ],
    )),
    ...coverageSelectorPredicates,
    ...tracePolicyPredicates,
    ...appliedSubstitutionPredicates
  ];

  let commitmentPredicates: { code: string; pass: boolean }[];
  let contextPredicates: { code: string; pass: boolean }[] = [];
  let prohibitedBindingPredicates: { code: string; pass: boolean }[] = [];
  const ruleId: SemanticOracleRuleId = SEMANTIC_ORACLE_RULE_BY_CASE[testCase.id];
  switch (ruleId) {
    case "unfamiliar-purpose-structure":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      contextPredicates = contextPreserved();
      break;
    case "familiar-noun-scale":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_CONTEXT_OPERATION", hasEssentialOperationBound()]);
      break;
    case "covered-access-context-control":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_CONTEXT_OPERATION", hasEssentialOperationBound()]);
      break;
    case "organization-count-composite-control":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_FOUR_SPACES_EXPLICIT_COUNT", hasOrganizationCount(4)]
      );
      contextPredicates = contextPreserved();
      break;
    case "organization-grid-composite-control":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_TWO_BY_THREE_EXPLICIT_GRID", hasOrganizationGrid(2, 3)]
      );
      contextPredicates = contextPreserved();
      break;
    case "storage-purpose-nonorganization-control":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_EXPLICIT_SINGLE_SPACE", hasExplicitSingleSpace()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_STORAGE_PURPOSE_ORGANIZATION", hasOrganization()]);
      break;
    case "storage-context-nonorganization-control":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_EXPLICIT_SINGLE_SPACE", hasExplicitSingleSpace()]
      );
      contextPredicates = contextPreserved();
      prohibitedBindingPredicates = predicates(["PROHIBITED_ARCHIVE_CONTEXT_ORGANIZATION", hasOrganization()]);
      break;
    case "bare-storage-name-nonorganization":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_DEFAULT_SINGLE_SPACE", hasDefaultSingleSpace()]
      );
      prohibitedBindingPredicates = predicates(["PROHIBITED_BARE_STORAGE_MULTI_SPACE", hasOrganization()]);
      break;
    case "paraphrase-open-access":
      commitmentPredicates = predicates(
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_RIGID_CONSTRUCTION", hasRigid()]
      );
      break;
    case "open-separation-organization":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()]
      );
      break;
    case "implicit-covered-case-organization":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered") && hasRequirement("closure", "must")],
        ["COMMITMENT_MINIMUM_SEPARATED_ORGANIZATION", hasRequirement("organization", "must") && hasMinimumSeparatedOrganization()]
      );
      break;
    case "noun-swap-relationship":
      commitmentPredicates = predicates(
        ["COMMITMENT_CONTAINMENT", hasRequirement("containment", "must")],
        ["COMMITMENT_COVERED_ACCESS", hasAccess("covered")],
        ["COMMITMENT_THREE_SPACES", hasOrganizationCount(3)]
      );
      break;
    case "relationship-swap-contained":
      commitmentPredicates = predicates([
        "COMMITMENT_FULL_ENVELOPE_CONTAINMENT",
        hasRequirement("containment", "must") && hasObject("contained", "full-envelope")
      ]);
      break;
    case "typo-colloquial":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      break;
    case "irrelevant-image-object":
      commitmentPredicates = predicates([
        "COMMITMENT_OPEN_CONTAINER",
        hasRequirement("containment", "must") && hasAccess("open-top")
      ]);
      contextPredicates = contextPreserved();
      break;
    case "reference-role-purpose-control":
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
    case "reference-role-structure-only":
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
    case "reference-role-both":
      commitmentPredicates = predicates(
        ["COMMITMENT_REFERENCE_STRUCTURE", projection.constructionBodies.length > 0 && hasRigid()],
        ["COMMITMENT_REFERENCE_SURFACE", projection.motif !== null || hasRequirement("visual-treatment")]
      );
      break;
    case "measurement-ordinary":
      commitmentPredicates = predicates([
        "COMMITMENT_EXACT_EXTERNAL_WIDTH",
        interpretation.inventory.measurementTargets.some((item) =>
          item.interpretation === "exact" && item.target.subject === "project" &&
          item.target.envelope === "external" && item.target.axis === "width")
      ]);
      break;
    case "measurement-ambiguous":
      commitmentPredicates = predicates([
        "COMMITMENT_AMBIGUOUS_MEASUREMENT",
        interpretation.inventory.measurementTargets.some((item) =>
          item.interpretation === "ambiguous" || item.interpretation === "approximate")
      ]);
      break;
    case "supported-unfamiliar-style":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        ["PREFERENCE_VISUAL_MOOD", nonContextItems.some((item) => item.importance === "preference" && item.aspects.includes("surface"))]
      );
      break;
    case "review-correctable-coverage":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      break;
    case "substitution-apply":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_USABLE_ACCESS", projection.access.length > 0],
        ["COMMITMENT_REGISTERED_SUBSTITUTION_APPLIED", trace?.appliedEdgeIds.length === 1]
      );
      break;
    case "substitution-refusal-fallback":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
      );
      break;
    case "substitution-refusal-concept-only":
      commitmentPredicates = predicates([
        "COMMITMENT_REGISTERED_SUBSTITUTION_REFUSED",
        trace?.refusedEdgeIds.length === 1 && trace.appliedEdgeIds.length === 0
      ]);
      break;
    case "direct-support-wins":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      break;
    case "flexure-surface-negative":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")],
        [
          "COMMITMENT_SURFACE_SCOPE_ACCOUNTED",
          nonContextItems.some((item) =>
            item.aspects.includes("surface") &&
            coverageDisposition(item.id) !== null
          )
        ]
      );
      break;
    case "flexure-context-negative":
      commitmentPredicates = predicates(
        ["COMMITMENT_RIGID_CONTAINMENT", hasRequirement("containment", "must") && hasRigid()],
        ["COMMITMENT_OPEN_TOP_ACCESS", hasAccess("open-top")]
      );
      contextPredicates = contextPreserved();
      break;
    default:
      ruleId satisfies never;
      throw new Error(`SEMANTIC_ORACLE_RULE_UNREGISTERED:${String(ruleId)}`);
  }
  commitmentPredicates.push(...requiredContractPredicates());
  const prohibitedSignatureSelected =
    candidateUnsupportedSignatureIds.includes(
      "kerf-flexure-corner-construction",
    ) ||
    trace?.selectedUnsupportedSignatureIds.includes(
      "kerf-flexure-corner-construction",
    ) === true;
  const prohibitedSubstitutionActivity = trace !== null && (
    trace.substitutionSearchEntered ||
    trace.substitutionSearchAttemptCount > 0 ||
    trace.consideredEdgeIds.length > 0 ||
    trace.refusedEdgeIds.length > 0 ||
    trace.appliedEdgeIds.length > 0
  );
  for (const code of expected.prohibitedBindingPredicateCodes ?? []) {
    prohibitedBindingPredicates.push({
      code,
      pass: code === "PROHIBITED_NONSTRUCTURAL_FLEXURE_SIGNATURE"
        ? prohibitedSignatureSelected
        : prohibitedSubstitutionActivity
    });
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

export function semanticEvaluationOutcomeAccepted(
  policy: SemanticEvaluationOutcomePolicy,
  outcome: Pick<GenerationOutcome, "kind" | "exportAllowed">,
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
  candidateUnsupportedSignatureIds?: readonly string[];
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
  const interpreted = scoreInterpretation(
    input.testCase,
    interpretation,
    input.request,
    input.outcome,
    input.candidateUnsupportedSignatureIds ?? [],
  );
  const accepted = semanticEvaluationOutcomeAccepted(outcomePolicy, input.outcome);
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
