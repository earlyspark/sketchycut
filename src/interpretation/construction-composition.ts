import { hashCanonical } from "../domain/hash.js";
import { registeredOperatorVersions } from "../operators/registry.js";
import {
  ConstructionPlanV1Schema,
  type ConstructionPlanV1,
  type SymbolicTopologyCandidateV1
} from "./construction-contracts.js";
import type { SizingDecisionV1 } from "./constraint-sizing-solver.js";
import { IntentGraphV2Schema, type IntentGraphV2 } from "./intent-graph-v2.js";

export const CONSTRUCTION_COMPOSITION_VERSION = "construction-composition-v1" as const;

const POLICY = {
  version: CONSTRUCTION_COMPOSITION_VERSION,
  panelRoleOrder: ["foundation", "rear", "left", "right", "front", "cover", "divider"],
  baseOperators: ["orthogonal-panel-layout", "panel-tab-slot-mate", "edge-finger-mate"],
  mechanismOperator: {
    "retained-pin": "retained-pin-revolute",
    "captured-slide": "captured-panel-slide"
  }
} as const;

function preferenceMisses(intent: IntentGraphV2, topology: SymbolicTopologyCandidateV1): number {
  let misses = 0;
  for (const item of intent.access.filter((candidate) => candidate.priority === "prefer")) {
    if (item.kind !== topology.access) misses += 1;
  }
  for (const item of intent.organization.filter((candidate) => candidate.priority === "prefer")) {
    const expected = item.desiredSpaceCount ?? (item.rows ?? 1) * (item.columns ?? 1);
    if (expected !== topology.canonicalSpaces.length) misses += 1;
  }
  return misses;
}

function omittedPreferredRequirements(intent: IntentGraphV2, topology: SymbolicTopologyCandidateV1) {
  const omitted = new Map<string, string>();
  for (const item of intent.access.filter((candidate) => candidate.priority === "prefer")) {
    if (item.kind !== topology.access) {
      omitted.set(item.requirementId, `Preferred ${item.kind} access was not selected by this construction candidate.`);
    }
  }
  for (const item of intent.organization.filter((candidate) => candidate.priority === "prefer")) {
    const expected = item.desiredSpaceCount ?? (item.rows ?? 1) * (item.columns ?? 1);
    if (expected !== topology.canonicalSpaces.length) {
      omitted.set(item.requirementId, `Preferred ${String(expected)}-space organization was not selected by this construction candidate.`);
    }
  }
  return [...omitted.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
    ([requirementId, disclosure]) => ({ requirementId, disclosure }),
  );
}

function estimatedSheetAreaSquareMm(topology: SymbolicTopologyCandidateV1, sizing: SizingDecisionV1): number {
  const width = sizing.external.widthUm;
  const depth = sizing.external.depthUm;
  const height = sizing.external.heightUm;
  const roles = topology.faces.map((item) => item.role);
  const squareUm = width * depth +
    roles.filter((role) => role === "rear" || role === "front").length * width * height +
    roles.filter((role) => role === "left" || role === "right" || role === "divider").length * depth * height +
    roles.filter((role) => role === "cover").length * width * depth;
  return Math.round(squareUm / 1_000_000);
}

export async function composeConstructionPlan(input: {
  intent: unknown;
  topology: SymbolicTopologyCandidateV1;
  sizing: SizingDecisionV1;
}): Promise<ConstructionPlanV1> {
  const intent = IntentGraphV2Schema.parse(input.intent);
  const topology = input.topology;
  const operators = registeredOperatorVersions();
  const orderedFaces = [...topology.faces].sort((left, right) => {
    const role = POLICY.panelRoleOrder.indexOf(left.role) - POLICY.panelRoleOrder.indexOf(right.role);
    return role !== 0 ? role : left.id.localeCompare(right.id);
  });
  let dividerIndex = 0;
  const dividerCount = orderedFaces.filter((face) => face.role === "divider").length;
  const panels = orderedFaces.map((face) => {
    if (face.role === "divider") dividerIndex += 1;
    const markingCode = face.role === "foundation" ? "p1"
      : face.role === "front" ? "p2"
      : face.role === "rear" ? "p3"
      : face.role === "left" ? "p4"
      : face.role === "right" ? "p5"
      : face.role === "divider" ? `p${String(5 + dividerIndex)}`
      : `p${String(6 + dividerCount)}`;
    return {
      id: face.id,
      role: face.role,
      markingCode,
      sourceSemanticIds: [...new Set([...face.sourceRequirementIds, topology.primaryBodyId])].sort()
    };
  });
  const panelIds = new Set(panels.map((item) => item.id));
  const mates: ConstructionPlanV1["mates"] = [];
  for (const panel of panels.filter((item) => item.role !== "foundation" && item.role !== "cover")) {
    mates.push({
      id: `seat-${panel.id}`,
      kind: "tab-slot",
      betweenPanelIds: [panel.id, "foundation-panel"],
      sourceSemanticIds: panel.sourceSemanticIds
    });
  }
  for (const [id, first, second] of [
    ["rear-left-corner", "rear-panel", "left-panel"],
    ["rear-right-corner", "rear-panel", "right-panel"],
    ["front-left-corner", "front-panel", "left-panel"],
    ["front-right-corner", "front-panel", "right-panel"]
  ] as const) {
    if (!panelIds.has(first) || !panelIds.has(second)) continue;
    mates.push({
      id,
      kind: "edge-finger",
      betweenPanelIds: [first, second],
      sourceSemanticIds: topology.sourceRequirementIds
    });
  }
  if (topology.mechanism !== "rigid") {
    mates.push({
      id: `${topology.mechanism}-interface`,
      kind: topology.mechanism,
      betweenPanelIds: ["cover-panel", "rear-panel"],
      sourceSemanticIds: topology.sourceRequirementIds
    });
  }
  const operatorIds = [
    ...POLICY.baseOperators,
    ...(topology.mechanism === "rigid" ? [] : [POLICY.mechanismOperator[topology.mechanism]]),
    ...(intent.motif === null ? [] : ["procedural-surface-treatment"])
  ];
  const operatorProgram = operatorIds.map((operatorId) => {
    const operatorVersion = operators.get(operatorId);
    if (operatorVersion === undefined) throw new Error(`CONSTRUCTION_OPERATOR_UNREGISTERED:${operatorId}`);
    return { operatorId, operatorVersion };
  });
  const assumptions = topology.assumptionIds.map((id) => ({
    id,
    disclosure: id === "single-space-assumption"
      ? "No organization count was evidenced; the construction uses one canonical space."
      : id === "moving-cover-realization-assumption"
      ? "Covered access did not specify a mechanism; the planner selected a registered moving-cover realization."
      : "A deterministic construction assumption was applied."
  }));
  const policyHash = await hashCanonical(POLICY);
  return ConstructionPlanV1Schema.parse({
    schemaVersion: "1.0",
    planId: `plan-${topology.candidateId}`,
    topology,
    panels,
    mates,
    operatorProgram,
    rankingVector: [
      preferenceMisses(intent, topology),
      assumptions.length,
      estimatedSheetAreaSquareMm(topology, input.sizing),
      panels.length
    ],
    assumptions,
    simplifications: omittedPreferredRequirements(intent, topology),
    policyVersion: "construction-planner-v1",
    policyHash
  });
}

export async function constructionCompositionPolicyHash(): Promise<string> {
  return hashCanonical(POLICY);
}
