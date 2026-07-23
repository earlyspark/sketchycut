import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import {
  ConstructionFindingV1Schema,
  SymbolicTopologyCandidateV1Schema,
  type ConstructionFindingV1,
  type SymbolicTopologyCandidateV1
} from "./construction-contracts.js";
import {
  ClosedSemanticProjectionSchema,
  MINIMUM_SEPARATED_ORGANIZATION_ASSUMPTION_ID,
  MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE,
  MINIMUM_SEPARATED_ORGANIZATION_FINDING_CODE,
  type ClosedSemanticProjection
} from "./semantic-interpretation.js";

export const TOPOLOGY_SYNTHESIS_VERSION = "symbolic-topology-synthesis-v4" as const;

const TopologySynthesisOutcomeV1Schema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("candidates"),
    candidates: z.array(SymbolicTopologyCandidateV1Schema).min(1),
    findings: z.array(ConstructionFindingV1Schema),
    policyVersion: z.literal(TOPOLOGY_SYNTHESIS_VERSION),
    policyHash: z.string().length(64)
  }).strict(),
  z.object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("concept-only"),
    candidates: z.array(SymbolicTopologyCandidateV1Schema).length(0),
    findings: z.array(ConstructionFindingV1Schema).min(1),
    blockedRequirementIds: z.array(z.string()),
    unresolvedNeeds: z.array(z.string()),
    policyVersion: z.literal(TOPOLOGY_SYNTHESIS_VERSION),
    policyHash: z.string().length(64)
  }).strict()
]);

export type TopologySynthesisOutcomeV1 = z.infer<typeof TopologySynthesisOutcomeV1Schema>;

const POLICY = {
  version: TOPOLOGY_SYNTHESIS_VERSION,
  accessOrder: ["open-top", "open-front", "covered"],
  partitionAxisOrder: ["width", "depth"],
  mechanisms: ["rigid", "fixed-top-frame", "retained-pin", "captured-slide"],
  standaloneRootRoles: ["support"],
  maximumSpaces: 4
} as const;

function finding(input: {
  code: ConstructionFindingV1["code"];
  phase?: ConstructionFindingV1["phase"];
  blocking?: boolean;
  ids?: readonly string[];
  message: string;
}): ConstructionFindingV1 {
  return ConstructionFindingV1Schema.parse({
    code: input.code,
    phase: input.phase ?? "semantic",
    blocking: input.blocking ?? true,
    relatedSemanticIds: [...(input.ids ?? [])].sort(),
    relatedConstraintIds: [],
    candidateId: null,
    message: input.message
  });
}

function connected(projection: ClosedSemanticProjection): boolean {
  const ids = projection.constructionBodies.map((item) => item.id);
  if (ids.length === 1) return true;
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const item of projection.interfaces) {
    adjacency.get(item.betweenBodyIds[0])?.add(item.betweenBodyIds[1]);
    adjacency.get(item.betweenBodyIds[1])?.add(item.betweenBodyIds[0]);
  }
  const visited = new Set<string>();
  const pending = [ids[0]!];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return visited.size === ids.length;
}

function contradictions(projection: ClosedSemanticProjection): string[] {
  const pairs = new Map<string, Map<string, string[]>>();
  for (const item of projection.interfaces) {
    const key = [...item.betweenBodyIds].sort().join("|");
    const behaviors = pairs.get(key) ?? new Map<string, string[]>();
    behaviors.set(item.behavior, [...(behaviors.get(item.behavior) ?? []), item.id]);
    pairs.set(key, behaviors);
  }
  return [...pairs.values()].flatMap((items) =>
    items.size > 1 ? [...items.values()].flat() : []
  ).sort();
}

function requiredRequirementIds(projection: ClosedSemanticProjection): string[] {
  return projection.requirements.filter((item) => item.priority === "must").map((item) => item.id).sort();
}

function conceptOnly(input: {
  findings: ConstructionFindingV1[];
  projection: ClosedSemanticProjection;
  policyHash: string;
}): TopologySynthesisOutcomeV1 {
  const related = new Set(input.findings.flatMap((item) => item.relatedSemanticIds));
  const blocked = input.projection.requirements
    .filter((item) => item.priority === "must" && (related.has(item.id) || input.findings.some((finding) => finding.code === "MANDATORY_REQUIREMENT_UNSUPPORTED")))
    .map((item) => item.id)
    .sort();
  return TopologySynthesisOutcomeV1Schema.parse({
    schemaVersion: "1.0",
    kind: "concept-only",
    candidates: [],
    findings: input.findings,
    blockedRequirementIds: blocked,
    unresolvedNeeds: input.projection.accounting.flatMap((item) =>
      item.state === "unbound" || item.state === "uncertain"
        ? [`Semantic commitment ${item.itemId} is ${item.state}; fabrication export is withheld.`]
        : []
    ),
    policyVersion: TOPOLOGY_SYNTHESIS_VERSION,
    policyHash: input.policyHash
  });
}

function accessOptions(projection: ClosedSemanticProjection, primaryBodyId: string): { options: ("open-top" | "open-front" | "covered")[]; conflictIds: string[] } {
  const relevant = projection.access.filter((item) =>
    item.bodyId === primaryBodyId &&
    !(item.kind === "covered" && item.direction === "front")
  );
  const must = [...new Set(relevant.filter((item) => item.priority === "must").map((item) => item.kind))];
  if (must.length > 1) {
    return { options: [], conflictIds: relevant.filter((item) => item.priority === "must").map((item) => item.requirementId) };
  }
  if (must.length === 1) return { options: [must[0]!], conflictIds: [] };
  const preferred = [...new Set(relevant.map((item) => item.kind))];
  return {
    options: preferred.length > 0
      ? [
          ...POLICY.accessOrder.filter((item): item is typeof preferred[number] => preferred.includes(item)),
          ...POLICY.accessOrder.filter((item) => item === "open-top" && !preferred.includes(item))
        ]
      : ["open-top"],
    conflictIds: []
  };
}

function mechanism(projection: ClosedSemanticProjection): {
  kind: "rigid" | "retained-pin" | "captured-slide";
  axis: "width" | "depth" | null;
  conflictIds: string[];
} {
  const moving = projection.interfaces.filter((item) => item.behavior !== "rigid");
  if (moving.length > 1) return { kind: "rigid", axis: null, conflictIds: moving.map((item) => item.id) };
  const item = moving[0];
  if (item === undefined) return { kind: "rigid", axis: null, conflictIds: [] };
  if (item.behavior === "revolute") {
    return item.axis === null || item.axis === "width"
      ? { kind: "retained-pin", axis: "width", conflictIds: [] }
      : { kind: "retained-pin", axis: null, conflictIds: [item.id] };
  }
  return item.axis === "depth"
    ? { kind: "captured-slide", axis: "depth", conflictIds: [] }
    : { kind: "captured-slide", axis: null, conflictIds: [item.id] };
}

function organization(input: ClosedSemanticProjection, primaryBodyId: string): {
  options: {
    count: number;
    requirementIds: string[];
    basis: ClosedSemanticProjection["organization"][number]["basis"] | "single-space";
  }[];
  gridUnsupportedIds: string[];
  countUnsupportedIds: string[];
  defaultedRequirementIds: string[];
} {
  const relevant = input.organization.filter((item) => item.bodyId === primaryBodyId);
  const required = relevant.filter((item) => item.priority === "must");
  const selected = (required.length > 0 ? required : relevant).sort((left, right) => left.requirementId.localeCompare(right.requirementId))[0];
  if (selected === undefined) {
    return {
      options: [{ count: 1, requirementIds: [], basis: "single-space" }],
      gridUnsupportedIds: [],
      countUnsupportedIds: [],
      defaultedRequirementIds: []
    };
  }
  const grid = selected.rows !== null && selected.columns !== null && selected.rows > 1 && selected.columns > 1;
  const count = selected.desiredSpaceCount;
  if (count > POLICY.maximumSpaces) {
    return {
      options: selected.priority === "prefer"
        ? [{ count: 1, requirementIds: [], basis: "single-space" }]
        : [],
      gridUnsupportedIds: [],
      countUnsupportedIds: selected.priority === "must" ? [selected.requirementId] : [],
      defaultedRequirementIds: []
    };
  }
  if (grid) {
    return {
      options: selected.priority === "prefer"
        ? [{ count: 1, requirementIds: [], basis: "single-space" }]
        : [],
      gridUnsupportedIds: selected.priority === "must" ? [selected.requirementId] : [],
      countUnsupportedIds: [],
      defaultedRequirementIds: []
    };
  }
  return {
    options: [
      { count, requirementIds: [selected.requirementId], basis: selected.basis },
      ...(selected.priority === "prefer" && count > 1
        ? [{ count: 1, requirementIds: [], basis: "single-space" as const }]
        : [])
    ],
    gridUnsupportedIds: [],
    countUnsupportedIds: [],
    defaultedRequirementIds: selected.basis === "minimum-separated-policy"
      ? [selected.requirementId]
      : []
  };
}

function buildCandidate(input: {
  primaryBodyId: string;
  access: "open-top" | "open-front" | "covered";
  mechanism: "rigid" | "fixed-top-frame" | "retained-pin" | "captured-slide";
  mechanismAxis: "width" | "depth" | null;
  spaces: number;
  partitionAxis: "width" | "depth" | null;
  requirementIds: string[];
  organizationRequirementIds: string[];
  assumptionIds: string[];
  ordinal: number;
}): SymbolicTopologyCandidateV1 {
  const faceRoles = [
    "foundation",
    "rear",
    "left",
    "right",
    ...(input.access === "open-front" ? [] : ["front"]),
    ...(input.access === "covered" ? ["cover"] : []),
    ...Array.from({ length: input.spaces - 1 }, () => "divider")
  ] as const;
  let divider = 0;
  const faces = faceRoles.map((role) => {
    if (role === "divider") divider += 1;
    return {
      id: role === "divider" ? `divider-${String(divider)}` : `${role}-panel`,
      role,
      sourceRequirementIds: role === "divider"
        ? input.organizationRequirementIds
        : input.requirementIds
    };
  });
  return SymbolicTopologyCandidateV1Schema.parse({
    schemaVersion: "1.0",
    candidateId: `topology-${String(input.ordinal).padStart(2, "0")}-${input.access}-${input.mechanism}-${input.partitionAxis ?? "none"}`,
    primaryBodyId: input.primaryBodyId,
    access: input.access,
    mechanism: input.mechanism,
    mechanismAxis: input.mechanismAxis,
    faces,
    canonicalSpaces: Array.from({ length: input.spaces }, (_, index) => ({
      id: `space-${String(index + 1)}`,
      order: index,
      sourceRequirementIds: input.organizationRequirementIds
    })),
    partitionAxis: input.spaces > 1 ? input.partitionAxis : null,
    sourceRequirementIds: input.requirementIds,
    assumptionIds: [...new Set([
      ...(input.organizationRequirementIds.length === 0 ? ["single-space-assumption"] : []),
      ...input.assumptionIds
    ])].sort()
  });
}

export async function synthesizeSymbolicTopologies(candidate: unknown): Promise<TopologySynthesisOutcomeV1> {
  const projection = ClosedSemanticProjectionSchema.parse(candidate);
  const policyHash = await hashCanonical(POLICY);
  const findings: ConstructionFindingV1[] = [];
  const explicitPrimary = projection.constructionBodies.filter((item) =>
    item.role === "primary-enclosure"
  );
  const standaloneSupport = explicitPrimary.length === 0 &&
    projection.constructionBodies.length === 1 &&
    POLICY.standaloneRootRoles.some((role) => role === projection.constructionBodies[0]!.role)
    ? projection.constructionBodies[0]
    : undefined;
  const primary = explicitPrimary.length === 1 ? explicitPrimary[0] : standaloneSupport;
  if (primary === undefined || !connected(projection)) {
    findings.push(finding({
      code: "EMPTY_OR_DISCONNECTED_TOPOLOGY",
      ids: projection.constructionBodies.map((item) => item.id),
      message: "Exactly one connected primary enclosure or standalone support body is required."
    }));
  }
  const contradictionIds = contradictions(projection);
  if (contradictionIds.length > 0) findings.push(finding({
    code: "CONTRADICTORY_INTERFACES",
    ids: contradictionIds,
    message: "A construction-body pair declares contradictory interface behavior."
  }));
  const unsupportedShapes = projection.constructionBodies.filter((item) =>
    ["rod", "angled", "curved", "freeform"].includes(item.shapeClass)
  );
  if (unsupportedShapes.length > 0) findings.push(finding({
    code: unsupportedShapes.some((item) => item.shapeClass === "rod")
      ? "ESSENTIAL_ROD_REALIZATION_UNSUPPORTED"
      : "MANDATORY_REQUIREMENT_UNSUPPORTED",
    ids: unsupportedShapes.flatMap((item) => [item.id, ...item.requirementIds]),
    message: "The required construction shape has no registered orthogonal sheet realization."
  }));
  const explicitMotion = mechanism(projection);
  const fixedTopRequests = projection.cutThrough.filter((item) => item.fixedTopAccess);
  if (fixedTopRequests.length > 0 && explicitMotion.kind !== "rigid") {
    findings.push(finding({
      code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
      ids: fixedTopRequests.flatMap((item) => [item.id, item.requirementId]),
      message: "A fixed-top aperture cannot share the same cover with a moving interface."
    }));
  }
  if (explicitMotion.conflictIds.length > 0) findings.push(finding({
    code: projection.interfaces.filter((item) => item.behavior !== "rigid").length > 1
      ? "COMPOUND_MOTION_UNSUPPORTED"
      : "INTERFACE_ORIENTATION_UNSUPPORTED",
    ids: explicitMotion.conflictIds,
    message: "The moving interface exceeds the registered single-axis mechanism boundary."
  }));
  const unsupportedRequirements = projection.requirements.filter((item) =>
    item.priority === "must" && ["specific-profile", "compound-motion"].includes(item.kind)
  );
  if (unsupportedRequirements.length > 0) findings.push(finding({
    code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
    ids: unsupportedRequirements.map((item) => item.id),
    message: "A mandatory semantic requirement has no registered construction evidence path."
  }));
  if (findings.some((item) => item.blocking) || primary === undefined) {
    return conceptOnly({ findings, projection, policyHash });
  }

  const unsupportedCoveredFront = projection.access.filter((item) =>
    item.bodyId === primary.id &&
    item.kind === "covered" &&
    item.direction === "front" &&
    item.priority === "must"
  );
  if (unsupportedCoveredFront.length > 0) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: unsupportedCoveredFront.map((item) => item.requirementId),
        message: "The registered construction vocabulary does not yet realize mandatory covered-front access."
      })],
      projection,
      policyHash
    });
  }

  const access = accessOptions(projection, primary.id);
  if (access.conflictIds.length > 0) {
    return conceptOnly({
      findings: [finding({
        code: "CONTRADICTORY_INTERFACES",
        ids: access.conflictIds,
        message: "Mandatory access requirements select incompatible openings."
      })],
      projection,
      policyHash
    });
  }
  if (fixedTopRequests.length > 0 && !access.options.includes("covered")) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: fixedTopRequests.flatMap((item) => [item.id, item.requirementId]),
        message: "Fixed-top access requires a covered rigid topology."
      })],
      projection,
      policyHash
    });
  }
  const mandatoryNonCoveredAccess = projection.access.some((item) =>
    item.bodyId === primary.id && item.priority === "must" && item.kind !== "covered"
  );
  if (explicitMotion.kind !== "rigid" && mandatoryNonCoveredAccess) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: projection.access.filter((item) => item.priority === "must").map((item) => item.requirementId),
        message: "The registered moving-cover mechanisms cannot preserve a mandatory non-covered access state."
      })],
      projection,
      policyHash
    });
  }
  const organizationIntent = organization(projection, primary.id);
  if (organizationIntent.gridUnsupportedIds.length > 0) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: organizationIntent.gridUnsupportedIds,
        message: "The initial vocabulary supports one-axis partitions but not a required two-axis grid."
      })],
      projection,
      policyHash
    });
  }
  if (organizationIntent.countUnsupportedIds.length > 0) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: organizationIntent.countUnsupportedIds,
        message: `The initial registered vocabulary supports at most ${String(POLICY.maximumSpaces)} one-axis spaces.`
      })],
      projection,
      policyHash
    });
  }
  if (organizationIntent.defaultedRequirementIds.length > 0) {
    findings.push(finding({
      code: MINIMUM_SEPARATED_ORGANIZATION_FINDING_CODE,
      blocking: false,
      ids: organizationIntent.defaultedRequirementIds,
      message: MINIMUM_SEPARATED_ORGANIZATION_DISCLOSURE
    }));
  }
  const requiredIds = [...new Set([
    ...requiredRequirementIds(projection),
    ...primary.requirementIds
  ])].sort();
  const candidates: SymbolicTopologyCandidateV1[] = [];
  for (const accessKind of fixedTopRequests.length > 0 ? ["covered" as const] : access.options) {
    const resolvedAccess = explicitMotion.kind === "rigid" ? accessKind : "covered";
    const mechanismOptions = explicitMotion.kind !== "rigid"
      ? [{ kind: explicitMotion.kind, axis: explicitMotion.axis, assumed: false }]
      : fixedTopRequests.length > 0
      ? [{ kind: "fixed-top-frame" as const, axis: null, assumed: false }]
      : resolvedAccess === "covered"
      ? [
          { kind: "retained-pin" as const, axis: "width" as const, assumed: true },
          { kind: "captured-slide" as const, axis: "depth" as const, assumed: true }
        ]
      : [{ kind: "rigid" as const, axis: null, assumed: false }];
    for (const mechanismOption of mechanismOptions) {
      for (const organizationOption of organizationIntent.options) {
        const partitionAxes = organizationOption.count > 1
          ? organizationOption.basis === "minimum-separated-policy"
            ? [POLICY.partitionAxisOrder[0]]
            : POLICY.partitionAxisOrder
          : [null];
        for (const partitionAxis of partitionAxes) {
          candidates.push(buildCandidate({
            primaryBodyId: primary.id,
            access: resolvedAccess,
            mechanism: mechanismOption.kind,
            mechanismAxis: mechanismOption.axis,
            spaces: organizationOption.count,
            partitionAxis,
            requirementIds: requiredIds,
            organizationRequirementIds: organizationOption.requirementIds,
            assumptionIds: [
              ...(organizationOption.basis === "default-single-space-policy"
                ? ["single-space-assumption"]
                : []),
              ...(organizationOption.basis === "minimum-separated-policy"
                ? [MINIMUM_SEPARATED_ORGANIZATION_ASSUMPTION_ID]
                : []),
              ...(mechanismOption.assumed ? ["moving-cover-realization-assumption"] : [])
            ],
            ordinal: candidates.length + 1
          }));
        }
      }
    }
  }
  if (candidates.length === 0) {
    return conceptOnly({
      findings: [finding({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        ids: projection.access.filter((item) => item.priority === "must").map((item) => item.requirementId),
        message: "No registered construction realizes the requested access and interface semantics."
      })],
      projection,
      policyHash
    });
  }
  const unique = [...new Map(candidates.map((item) => [
    JSON.stringify({ access: item.access, mechanism: item.mechanism, spaces: item.canonicalSpaces.length, partitionAxis: item.partitionAxis }),
    item
  ])).values()];
  return TopologySynthesisOutcomeV1Schema.parse({
    schemaVersion: "1.0",
    kind: "candidates",
    candidates: unique,
    findings,
    policyVersion: TOPOLOGY_SYNTHESIS_VERSION,
    policyHash
  });
}

export async function topologySynthesisPolicyHash(): Promise<string> {
  return hashCanonical(POLICY);
}
