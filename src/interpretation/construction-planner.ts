import type { InputPolicyEvaluation } from "../domain/contracts.js";
import type { MotifRecipeV1 } from "../operators/procedural-surface-treatment.js";
import type { CanonicalSemanticProvenanceV2 } from "./canonical-generation-document.js";
import type { AppliedPinSetup } from "../domain/fabrication-setup.js";
import { hashCanonical } from "../domain/hash.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import { composeConstructionPlan } from "./construction-composition.js";
import {
  ConstructionFindingV1Schema,
  type ConstructionFindingV1,
  type ConstructionPlanV1,
  type SymbolicTopologyCandidateV1
} from "./construction-contracts.js";
import {
  compileConstructionPlan,
  type CompiledConstructionCandidateV1
} from "./construction-plan-compiler.js";
import {
  solveSizingConstraints,
  type ConstraintSizingResultV1
} from "./constraint-sizing-solver.js";
import type { ExplicitSizingConstraintsV1 } from "./explicit-sizing.js";
import { IntentGraphV2Schema, type IntentGraphV2 } from "./intent-graph-v2.js";
import { synthesizeSymbolicTopologies } from "./topology-synthesis.js";

export const CONSTRUCTION_PLANNER_VERSION = "construction-planner-v1" as const;
export const DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET = 32 as const;

const POLICY = {
  version: CONSTRUCTION_PLANNER_VERSION,
  candidateBudget: DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET,
  rankingOrder: ["evidence-backed-preference-misses", "assumptions", "estimated-sheet-area", "part-count", "plan-id"]
} as const;

export type PlanningCandidateRecordV1 = {
  candidateId: string;
  enumerationIndex: number;
  topology: SymbolicTopologyCandidateV1;
  sizing: ConstraintSizingResultV1;
  plan: ConstructionPlanV1 | null;
  compiled: CompiledConstructionCandidateV1 | null;
  status: "sizing-infeasible" | "compile-rejected" | "complexity-rejected" | "feasible";
  findings: readonly ConstructionFindingV1[];
};

export type ConstructionPlannerOutcomeV1 =
  | {
      schemaVersion: "1.0";
      kind: "planned";
      intent: IntentGraphV2;
      selected: PlanningCandidateRecordV1;
      candidates: readonly PlanningCandidateRecordV1[];
      findings: readonly ConstructionFindingV1[];
      policyVersion: typeof CONSTRUCTION_PLANNER_VERSION;
      policyHash: string;
    }
  | {
      schemaVersion: "1.0";
      kind: "concept-only";
      intent: IntentGraphV2;
      selected: null;
      candidates: readonly PlanningCandidateRecordV1[];
      findings: readonly ConstructionFindingV1[];
      blockedRequirementIds: readonly string[];
      unresolvedNeeds: readonly string[];
      policyVersion: typeof CONSTRUCTION_PLANNER_VERSION;
      policyHash: string;
    }
  | {
      schemaVersion: "1.0";
      kind: "failure";
      intent: IntentGraphV2;
      selected: null;
      candidates: readonly PlanningCandidateRecordV1[];
      findings: readonly ConstructionFindingV1[];
      failureCode: "SEARCH_BUDGET_EXHAUSTED";
      retryable: false;
      policyVersion: typeof CONSTRUCTION_PLANNER_VERSION;
      policyHash: string;
    };

function candidateFinding(input: {
  code: ConstructionFindingV1["code"];
  phase: ConstructionFindingV1["phase"];
  candidateId: string;
  semanticIds?: readonly string[];
  constraintIds?: readonly string[];
  message: string;
}): ConstructionFindingV1 {
  return ConstructionFindingV1Schema.parse({
    code: input.code,
    phase: input.phase,
    blocking: true,
    relatedSemanticIds: [...(input.semanticIds ?? [])].sort(),
    relatedConstraintIds: [...(input.constraintIds ?? [])].sort(),
    candidateId: input.candidateId,
    message: input.message
  });
}

function comparePlans(left: PlanningCandidateRecordV1, right: PlanningCandidateRecordV1): number {
  if (left.plan === null || right.plan === null) throw new Error("PLANNER_RANKING_REQUIRES_PLAN");
  const length = Math.max(left.plan.rankingVector.length, right.plan.rankingVector.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.plan.rankingVector[index] ?? 0) - (right.plan.rankingVector[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.plan.planId.localeCompare(right.plan.planId);
}

function aggregateConceptFinding(records: readonly PlanningCandidateRecordV1[]): ConstructionFindingV1 {
  const sizing = records.flatMap((item) => item.findings).find((item) =>
    item.code === "FIT_CRITICAL_MEASUREMENT_REQUIRED" ||
    item.code === "SIZING_HARD_CONSTRAINT_INFEASIBLE" ||
    item.code === "SIZING_OBJECT_TARGET_AMBIGUOUS" ||
    item.code === "SIZING_PROPORTION_RELATION_CONFLICT"
  );
  if (sizing !== undefined) return { ...sizing, candidateId: null };
  return candidateFinding({
    code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
    phase: "composition",
    candidateId: records[0]?.candidateId ?? "no-candidate",
    semanticIds: records.flatMap((item) => item.topology.sourceRequirementIds),
    message: "No registered candidate passed sizing, compilation, validation, and export-complexity gates."
  });
}

export async function planIntentConditionedConstruction(input: {
  intent: unknown;
  explicitConstraints: ExplicitSizingConstraintsV1;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
  pin: AppliedPinSetup;
  motifPlacement?: MotifRecipeV1["placement"];
  semanticProvenance?: CanonicalSemanticProvenanceV2;
  candidateBudget?: number;
}): Promise<ConstructionPlannerOutcomeV1> {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const policyHash = await hashCanonical(POLICY);
  const synthesis = await synthesizeSymbolicTopologies(intent);
  if (synthesis.kind === "concept-only") {
    return {
      schemaVersion: "1.0",
      kind: "concept-only",
      intent,
      selected: null,
      candidates: [],
      findings: synthesis.findings,
      blockedRequirementIds: synthesis.blockedRequirementIds,
      unresolvedNeeds: synthesis.unresolvedNeeds,
      policyVersion: CONSTRUCTION_PLANNER_VERSION,
      policyHash
    };
  }
  const budget = input.candidateBudget ?? DEFAULT_CONSTRUCTION_CANDIDATE_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < 0) throw new Error("CONSTRUCTION_CANDIDATE_BUDGET_INVALID");
  if (synthesis.candidates.length > budget) {
    const finding = candidateFinding({
      code: "SEARCH_BUDGET_EXHAUSTED",
      phase: "topology",
      candidateId: synthesis.candidates[budget]?.candidateId ?? synthesis.candidates[0]!.candidateId,
      semanticIds: synthesis.candidates.flatMap((item) => item.sourceRequirementIds),
      message: "The fixed candidate budget ended before every potentially result-changing candidate was examined."
    });
    return {
      schemaVersion: "1.0",
      kind: "failure",
      intent,
      selected: null,
      candidates: [],
      findings: [finding],
      failureCode: "SEARCH_BUDGET_EXHAUSTED",
      retryable: false,
      policyVersion: CONSTRUCTION_PLANNER_VERSION,
      policyHash
    };
  }

  const records: PlanningCandidateRecordV1[] = [];
  for (const [index, topology] of synthesis.candidates.entries()) {
    const sizing = await solveSizingConstraints({
      intent,
      explicitConstraints: input.explicitConstraints,
      topology,
      materialThicknessUm: Math.round(input.profiles.material.measuredThicknessMm * 1_000)
    });
    if (sizing.kind === "infeasible") {
      records.push({
        candidateId: topology.candidateId,
        enumerationIndex: index,
        topology,
        sizing,
        plan: null,
        compiled: null,
        status: "sizing-infeasible",
        findings: [candidateFinding({
          code: sizing.findingCode,
          phase: "sizing",
          candidateId: topology.candidateId,
          semanticIds: sizing.relatedSemanticIds,
          constraintIds: sizing.conflictingConstraintIds,
          message: sizing.message
        })]
      });
      continue;
    }
    const plan = await composeConstructionPlan({ intent, topology, sizing });
    try {
      const compiled = await compileConstructionPlan({
        requestId: `planner-${String(index + 1)}-${topology.candidateId}`,
        intent,
        plan,
        sizing,
        profiles: input.profiles,
        inputPolicyEvaluation: input.inputPolicyEvaluation,
        pin: input.pin,
        ...(input.motifPlacement === undefined ? {} : { motifPlacement: input.motifPlacement }),
        ...(input.semanticProvenance === undefined ? {} : { semanticProvenance: input.semanticProvenance })
      });
      if (compiled.importComplexity.some((item) => !item.withinCurrentLimit)) {
        records.push({
          candidateId: topology.candidateId,
          enumerationIndex: index,
          topology,
          sizing,
          plan,
          compiled,
          status: "complexity-rejected",
          findings: [candidateFinding({
            code: "STUDIO_IMPORT_COMPLEXITY_EXCEEDED",
            phase: "validate",
            candidateId: topology.candidateId,
            semanticIds: topology.sourceRequirementIds,
            message: "At least one sheet exceeds the registered xTool Studio import-complexity budget."
          })]
        });
        continue;
      }
      records.push({
        candidateId: topology.candidateId,
        enumerationIndex: index,
        topology,
        sizing,
        plan,
        compiled,
        status: "feasible",
        findings: []
      });
    } catch (error) {
      records.push({
        candidateId: topology.candidateId,
        enumerationIndex: index,
        topology,
        sizing,
        plan,
        compiled: null,
        status: "compile-rejected",
        findings: [candidateFinding({
          code: "CANDIDATE_COMPILATION_FAILED",
          phase: "compile",
          candidateId: topology.candidateId,
          semanticIds: topology.sourceRequirementIds,
          message: error instanceof Error
            ? `Registered candidate compilation rejected: ${error.message}`.slice(0, 500)
            : "Registered candidate compilation rejected."
        })]
      });
    }
  }
  const feasible = records.filter((item) => item.status === "feasible").sort(comparePlans);
  if (feasible[0] === undefined) {
    const aggregate = aggregateConceptFinding(records);
    return {
      schemaVersion: "1.0",
      kind: "concept-only",
      intent,
      selected: null,
      candidates: records,
      findings: [...records.flatMap((item) => item.findings), aggregate],
      blockedRequirementIds: intent.requirements.filter((item) => item.priority === "must").map((item) => item.id).sort(),
      unresolvedNeeds: intent.unresolvedNeeds.map((item) => item.semanticSummary),
      policyVersion: CONSTRUCTION_PLANNER_VERSION,
      policyHash
    };
  }
  return {
    schemaVersion: "1.0",
    kind: "planned",
    intent,
    selected: feasible[0],
    candidates: records,
    findings: feasible[0].plan!.simplifications.map((item) => candidateFinding({
      code: "PREFERRED_REQUIREMENT_OMITTED",
      phase: "rank",
      candidateId: feasible[0]!.candidateId,
      semanticIds: [item.requirementId],
      message: item.disclosure
    })),
    policyVersion: CONSTRUCTION_PLANNER_VERSION,
    policyHash
  };
}

export async function constructionPlannerPolicyHash(): Promise<string> {
  return hashCanonical(POLICY);
}
