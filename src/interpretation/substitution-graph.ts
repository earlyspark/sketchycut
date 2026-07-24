import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/primitives.js";
import {
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import {
  RequirementRealizationLedgerV1Schema,
  type RequirementRealizationLedgerV1
} from "./realization-ledger.js";
import {
  UnsupportedSemanticSignatureIdSchema
} from "./unsupported-semantic-signatures.js";

export const CURRENT_SUBSTITUTION_GRAPH_VERSION = "1.0.0" as const;
export const SUBSTITUTION_GRAPH_MAX_DEPTH = 3 as const;

export const SubstitutionEdgeIdSchema = z.enum([
  "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners"
]);

export const ReplacementConstructionIdSchema = z.enum([
  "rigid-orthogonal-corner-construction"
]);

export const SubstitutionPreservationObligationSchema = z.enum([
  "access",
  "containment",
  "functional-aperture",
  "material",
  "organization",
  "release",
  "sizing",
  "surface-treatment",
  "validation-and-import-complexity"
]);

export const SubstitutionGraphEdgeSchema = z.object({
  edgeId: SubstitutionEdgeIdSchema,
  edgeVersion: z.literal("1.0.0"),
  fromSignatureId: UnsupportedSemanticSignatureIdSchema,
  toConstructionId: ReplacementConstructionIdSchema,
  cost: z.number().int().positive(),
  maximumApplications: z.number().int().positive().max(4),
  maximumDepth: z.number().int().positive().max(SUBSTITUTION_GRAPH_MAX_DEPTH),
  requiredAccountingReason: z.literal("CAPABILITY_NOT_REGISTERED"),
  requiredBodyRole: z.literal("primary-enclosure"),
  requiredBodyShapeClass: z.literal("orthogonal-shell"),
  prohibitedMustRequirementKinds: z.array(z.enum([
    "specific-profile",
    "compound-motion"
  ])).length(2),
  preservationObligations: z.array(
    SubstitutionPreservationObligationSchema,
  ).length(9),
  modifiedFallbackEligibleObligations: z.array(
    SubstitutionPreservationObligationSchema,
  ).length(3),
  disclosure: z.string().min(1).max(900)
}).strict().superRefine((edge, context) => {
  const preservation = new Set(edge.preservationObligations);
  if (edge.modifiedFallbackEligibleObligations.some((item) =>
    !preservation.has(item)
  )) {
    context.addIssue({
      code: "custom",
      message: "Modified-fallback obligations must be drawn from the edge's tracked preservation obligations."
    });
  }
});

export const SubstitutionGraphRegistrySchema = z.object({
  registryId: z.literal("sketchycut-deterministic-substitution-graph"),
  version: z.literal(CURRENT_SUBSTITUTION_GRAPH_VERSION),
  maximumDepth: z.literal(SUBSTITUTION_GRAPH_MAX_DEPTH),
  edges: z.array(SubstitutionGraphEdgeSchema).length(1)
}).strict();

export const SUBSTITUTION_GRAPH_REGISTRY = SubstitutionGraphRegistrySchema.parse({
  registryId: "sketchycut-deterministic-substitution-graph",
  version: CURRENT_SUBSTITUTION_GRAPH_VERSION,
  maximumDepth: SUBSTITUTION_GRAPH_MAX_DEPTH,
  edges: [{
    edgeId: "substitute-kerf-flexure-corners-with-rigid-orthogonal-corners",
    edgeVersion: "1.0.0",
    fromSignatureId: "kerf-flexure-corner-construction",
    toConstructionId: "rigid-orthogonal-corner-construction",
    cost: 10,
    maximumApplications: 1,
    maximumDepth: 1,
    requiredAccountingReason: "CAPABILITY_NOT_REGISTERED",
    requiredBodyRole: "primary-enclosure",
    requiredBodyShapeClass: "orthogonal-shell",
    prohibitedMustRequirementKinds: [
      "specific-profile",
      "compound-motion"
    ],
    preservationObligations: [
      "access",
      "containment",
      "functional-aperture",
      "material",
      "organization",
      "release",
      "sizing",
      "surface-treatment",
      "validation-and-import-complexity"
    ],
    modifiedFallbackEligibleObligations: [
      "functional-aperture",
      "organization",
      "surface-treatment"
    ],
    disclosure:
      "SketchyCut replaced the requested kerf-flexure corner construction with registered rigid orthogonal sheet corners. The result does not provide a curved silhouette, flexibility, or kerf-bend behavior."
  }]
});

export async function substitutionGraphRegistryHash(): Promise<string> {
  return hashCanonical(SUBSTITUTION_GRAPH_REGISTRY);
}

const TraversalEdgeSchema = z.object({
  edgeId: StableIdSchema,
  fromNodeId: StableIdSchema,
  toNodeId: StableIdSchema,
  cost: z.number().int().positive(),
  maximumApplications: z.number().int().positive().max(8)
}).strict();

export type TraversalEdge = z.infer<typeof TraversalEdgeSchema>;

export type SubstitutionTraversalPath = {
  edgeIds: string[];
  nodeIds: string[];
  totalCost: number;
};

export function enumerateBoundedSubstitutionPaths(input: {
  startNodeId: string;
  edges: readonly TraversalEdge[];
  maximumDepth: number;
}): {
  paths: SubstitutionTraversalPath[];
  cycleRejectedEdgeIds: string[];
  depthRejectedEdgeIds: string[];
} {
  const startNodeId = StableIdSchema.parse(input.startNodeId);
  const maximumDepth = z.number().int().nonnegative()
    .max(SUBSTITUTION_GRAPH_MAX_DEPTH).parse(input.maximumDepth);
  const edges = input.edges.map((edge) => TraversalEdgeSchema.parse(edge))
    .toSorted((left, right) =>
      left.cost - right.cost || left.edgeId.localeCompare(right.edgeId)
    );
  const queue: SubstitutionTraversalPath[] = [{
    edgeIds: [],
    nodeIds: [startNodeId],
    totalCost: 0
  }];
  const paths: SubstitutionTraversalPath[] = [];
  const cycleRejectedEdgeIds = new Set<string>();
  const depthRejectedEdgeIds = new Set<string>();
  while (queue.length > 0) {
    queue.sort((left, right) =>
      left.totalCost - right.totalCost ||
      left.edgeIds.join("\u0000").localeCompare(right.edgeIds.join("\u0000"))
    );
    const current = queue.shift()!;
    const currentNodeId = current.nodeIds.at(-1)!;
    for (const edge of edges.filter((candidate) =>
      candidate.fromNodeId === currentNodeId
    )) {
      if (current.nodeIds.includes(edge.toNodeId) ||
          current.edgeIds.filter((edgeId) => edgeId === edge.edgeId).length >=
            edge.maximumApplications) {
        cycleRejectedEdgeIds.add(edge.edgeId);
        continue;
      }
      if (current.edgeIds.length >= maximumDepth) {
        depthRejectedEdgeIds.add(edge.edgeId);
        continue;
      }
      const next = {
        edgeIds: [...current.edgeIds, edge.edgeId],
        nodeIds: [...current.nodeIds, edge.toNodeId],
        totalCost: current.totalCost + edge.cost
      };
      paths.push(next);
      queue.push(next);
    }
  }
  return {
    paths: paths.toSorted((left, right) =>
      left.totalCost - right.totalCost ||
      left.edgeIds.join("\u0000").localeCompare(right.edgeIds.join("\u0000"))
    ),
    cycleRejectedEdgeIds: [...cycleRejectedEdgeIds].sort(),
    depthRejectedEdgeIds: [...depthRejectedEdgeIds].sort()
  };
}

export const SubstitutionAttemptSchema = z.object({
  edgeId: SubstitutionEdgeIdSchema,
  signatureId: UnsupportedSemanticSignatureIdSchema,
  affectedInventoryItemId: StableIdSchema,
  depth: z.number().int().positive().max(SUBSTITUTION_GRAPH_MAX_DEPTH),
  totalCost: z.number().int().positive(),
  status: z.enum(["refused", "applied"]),
  findingCodes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/u))
}).strict();

function sameStableIdentifier(left: string, right: string): boolean {
  return left === right;
}

function matchesRegisteredApplicationMetadata(
  application: {
    edgeVersion: string;
    signatureId: string;
    replacementConstructionId: string;
    preservationObligations: readonly string[];
    disclosure: string;
  },
  edge: {
    edgeVersion: string;
    fromSignatureId: string;
    toConstructionId: string;
    preservationObligations: readonly string[];
    disclosure: string;
  } | undefined,
): boolean {
  if (edge === undefined) return false;
  return sameStableIdentifier(application.edgeVersion, edge.edgeVersion) &&
    sameStableIdentifier(application.signatureId, edge.fromSignatureId) &&
    sameStableIdentifier(
      application.replacementConstructionId,
      edge.toConstructionId,
    ) &&
    JSON.stringify(application.preservationObligations) ===
      JSON.stringify(edge.preservationObligations) &&
    application.disclosure === edge.disclosure;
}

export const AppliedSubstitutionSchema = z.object({
  edgeId: SubstitutionEdgeIdSchema,
  edgeVersion: z.literal("1.0.0"),
  signatureId: UnsupportedSemanticSignatureIdSchema,
  replacementConstructionId: ReplacementConstructionIdSchema,
  affectedSemanticIds: z.array(StableIdSchema).min(1),
  derivedRequirementIds: z.array(StableIdSchema).min(1),
  preEdgeMustRequirementIds: z.array(StableIdSchema),
  preservedMustRequirementIds: z.array(StableIdSchema),
  changedMustRequirementIds: z.array(StableIdSchema),
  omittedMustRequirementIds: z.array(StableIdSchema),
  preservationObligations: z.array(
    SubstitutionPreservationObligationSchema,
  ).min(1),
  relaxedPreservationObligations: z.array(
    SubstitutionPreservationObligationSchema,
  ),
  disclosure: z.string().min(1).max(900)
}).strict().superRefine((application, context) => {
  for (const values of [
    application.affectedSemanticIds,
    application.derivedRequirementIds,
    application.preEdgeMustRequirementIds,
    application.preservedMustRequirementIds,
    application.changedMustRequirementIds,
    application.omittedMustRequirementIds,
    application.relaxedPreservationObligations
  ]) {
    if (values.some((value, index) =>
      index > 0 && values[index - 1]! >= value
    )) {
      context.addIssue({
        code: "custom",
        message: "Applied substitution semantic arrays must be uniquely sorted."
      });
    }
  }
  const partition = [
    ...application.preservedMustRequirementIds,
    ...application.changedMustRequirementIds,
    ...application.omittedMustRequirementIds
  ];
  if (
    new Set(partition).size !== partition.length ||
    JSON.stringify([...partition].sort()) !==
      JSON.stringify([...application.preEdgeMustRequirementIds].sort())
  ) {
    context.addIssue({
      code: "custom",
      message: "Preserved, changed, and omitted must-requirement IDs must exactly partition the pre-edge must requirements."
    });
  }
  const edge = SUBSTITUTION_GRAPH_REGISTRY.edges.find((candidate) =>
    sameStableIdentifier(candidate.edgeId, application.edgeId)
  );
  if (!matchesRegisteredApplicationMetadata(application, edge)) {
    context.addIssue({
      code: "custom",
      message: "Applied substitution metadata must match the registered edge exactly."
    });
  }
  const eligible = new Set(edge?.modifiedFallbackEligibleObligations ?? []);
  if (
    application.relaxedPreservationObligations.some((item) =>
      !eligible.has(item)
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Only registered modified-fallback obligations may be relaxed."
    });
  }
});

export const SubstitutionSearchTraceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  graphVersion: z.literal(CURRENT_SUBSTITUTION_GRAPH_VERSION),
  selectedUnsupportedSignatureIds: z.array(
    UnsupportedSemanticSignatureIdSchema,
  ),
  substitutionSearchEntered: z.boolean(),
  substitutionSearchAttemptCount: z.number().int().nonnegative(),
  consideredEdgeIds: z.array(SubstitutionEdgeIdSchema),
  refusedEdgeIds: z.array(SubstitutionEdgeIdSchema),
  appliedEdgeIds: z.array(SubstitutionEdgeIdSchema),
  attempts: z.array(SubstitutionAttemptSchema),
  appliedSubstitutions: z.array(AppliedSubstitutionSchema)
}).strict().superRefine((trace, context) => {
  const uniquelySorted = (values: readonly string[]): boolean =>
    values.every((value, index) =>
      index === 0 || values[index - 1]! < value
    );
  for (const values of [
    trace.selectedUnsupportedSignatureIds,
    trace.consideredEdgeIds,
    trace.refusedEdgeIds,
    trace.appliedEdgeIds
  ]) {
    if (!uniquelySorted(values)) {
      context.addIssue({
        code: "custom",
        message: "Substitution diagnostic ID arrays must be uniquely sorted."
      });
    }
  }
  if (
    trace.substitutionSearchAttemptCount !== trace.attempts.length ||
    trace.substitutionSearchEntered !== (trace.attempts.length > 0) ||
    (!trace.substitutionSearchEntered && (
      trace.substitutionSearchAttemptCount !== 0 ||
      trace.consideredEdgeIds.length !== 0 ||
      trace.refusedEdgeIds.length !== 0 ||
      trace.appliedEdgeIds.length !== 0
    ))
  ) {
    context.addIssue({
      code: "custom",
      message: "Substitution search counters must agree with explicit search activity."
    });
  }
  const considered = [...new Set(trace.attempts.map((item) => item.edgeId))].sort();
  const refused = [...new Set(trace.attempts.flatMap((item) =>
    item.status === "refused" ? [item.edgeId] : []
  ))].sort();
  const applied = [...new Set(trace.appliedSubstitutions.map(
    (item) => item.edgeId,
  ))].sort();
  if (
    JSON.stringify(considered) !== JSON.stringify(trace.consideredEdgeIds) ||
    JSON.stringify(refused) !== JSON.stringify(trace.refusedEdgeIds) ||
    JSON.stringify(applied) !== JSON.stringify(trace.appliedEdgeIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Substitution edge summaries must derive exactly from attempts and applications."
    });
  }
  for (const attempt of trace.attempts) {
    if (!trace.selectedUnsupportedSignatureIds.includes(attempt.signatureId)) {
      context.addIssue({
        code: "custom",
        message: "Every substitution attempt must cite a selected unsupported signature."
      });
    }
    if (attempt.status !== "applied") continue;
    const matchingApplications = trace.appliedSubstitutions.filter(
      (application) =>
        sameStableIdentifier(application.edgeId, attempt.edgeId) &&
        sameStableIdentifier(
          application.signatureId,
          attempt.signatureId,
        ) &&
        application.affectedSemanticIds.includes(
          attempt.affectedInventoryItemId,
        ),
    );
    if (matchingApplications.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Every applied attempt must correlate to exactly one applied substitution."
      });
    }
  }
  for (const application of trace.appliedSubstitutions) {
    const matchingAttempts = trace.attempts.filter((attempt) =>
      attempt.status === "applied" &&
      sameStableIdentifier(attempt.edgeId, application.edgeId) &&
      sameStableIdentifier(
        attempt.signatureId,
        application.signatureId,
      ) &&
      application.affectedSemanticIds.includes(
        attempt.affectedInventoryItemId,
      )
    );
    if (
      matchingAttempts.length !== 1 ||
      !trace.selectedUnsupportedSignatureIds.includes(
        application.signatureId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Every applied substitution must correlate to exactly one selected-signature attempt."
      });
    }
  }
});

export type SubstitutionSearchTrace = z.infer<
  typeof SubstitutionSearchTraceSchema
>;
export type SubstitutionGraphEdge = z.infer<typeof SubstitutionGraphEdgeSchema>;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function selectedUnsupportedSignatureIds(
  interpretation: SemanticInterpretation,
): z.infer<typeof UnsupportedSemanticSignatureIdSchema>[] {
  return uniqueSorted(
    SemanticInterpretationSchema.parse(interpretation).projection.accounting
      .flatMap((record) => record.unsupportedSignatureIds),
  ) as z.infer<typeof UnsupportedSemanticSignatureIdSchema>[];
}

export function initialSubstitutionSearchTrace(
  interpretation: SemanticInterpretation,
): SubstitutionSearchTrace {
  return SubstitutionSearchTraceSchema.parse({
    schemaVersion: "1.0",
    graphVersion: CURRENT_SUBSTITUTION_GRAPH_VERSION,
    selectedUnsupportedSignatureIds:
      selectedUnsupportedSignatureIds(interpretation),
    substitutionSearchEntered: false,
    substitutionSearchAttemptCount: 0,
    consideredEdgeIds: [],
    refusedEdgeIds: [],
    appliedEdgeIds: [],
    attempts: [],
    appliedSubstitutions: []
  });
}

function traceFromAttempts(input: {
  selectedUnsupportedSignatureIds: z.infer<
    typeof UnsupportedSemanticSignatureIdSchema
  >[];
  attempts: z.infer<typeof SubstitutionAttemptSchema>[];
  appliedSubstitutions: z.infer<typeof AppliedSubstitutionSchema>[];
}): SubstitutionSearchTrace {
  return SubstitutionSearchTraceSchema.parse({
    schemaVersion: "1.0",
    graphVersion: CURRENT_SUBSTITUTION_GRAPH_VERSION,
    selectedUnsupportedSignatureIds: uniqueSorted(
      input.selectedUnsupportedSignatureIds,
    ),
    substitutionSearchEntered: true,
    substitutionSearchAttemptCount: input.attempts.length,
    consideredEdgeIds: uniqueSorted(input.attempts.map((item) => item.edgeId)),
    refusedEdgeIds: uniqueSorted(input.attempts.flatMap((item) =>
      item.status === "refused" ? [item.edgeId] : []
    )),
    appliedEdgeIds: uniqueSorted(input.appliedSubstitutions.map(
      (item) => item.edgeId,
    )),
    attempts: input.attempts,
    appliedSubstitutions: input.appliedSubstitutions
  });
}

export type PreparedSubstitutionCandidate = {
  interpretation: SemanticInterpretation;
  trace: SubstitutionSearchTrace;
};

export function prepareFirstRegisteredSubstitution(input: {
  interpretation: SemanticInterpretation;
  priorAttempts?: z.infer<typeof SubstitutionAttemptSchema>[];
}): {
  kind: "candidate";
  candidate: PreparedSubstitutionCandidate;
} | {
  kind: "refused";
  trace: SubstitutionSearchTrace;
} | {
  kind: "not-applicable";
  trace: SubstitutionSearchTrace;
} {
  const interpretation = SemanticInterpretationSchema.parse(
    input.interpretation,
  );
  const selectedIds = selectedUnsupportedSignatureIds(interpretation);
  const signatureId = "kerf-flexure-corner-construction" as const;
  if (!selectedIds.includes(signatureId)) {
    return {
      kind: "not-applicable",
      trace: initialSubstitutionSearchTrace(interpretation)
    };
  }
  const edge = SUBSTITUTION_GRAPH_REGISTRY.edges[0]!;
  const accounting = interpretation.projection.accounting.filter((record) =>
    record.unsupportedSignatureIds.includes(signatureId)
  );
  const target = accounting[0];
  const item = interpretation.inventory.items.find((candidate) =>
    candidate.id === target?.itemId
  );
  const primaryBodies = interpretation.projection.constructionBodies.filter(
    (body) => body.role === edge.requiredBodyRole,
  );
  const prohibitedMustRequirementIds = interpretation.projection.requirements
    .filter((requirement) =>
      requirement.priority === "must" &&
      edge.prohibitedMustRequirementKinds.includes(
        requirement.kind as "specific-profile" | "compound-motion",
      )
    )
    .map((requirement) => requirement.id);
  const itemById = new Map(
    interpretation.inventory.items.map((candidate) => [candidate.id, candidate]),
  );
  const accountingById = new Map(
    interpretation.projection.accounting.map((record) => [record.itemId, record]),
  );
  const unresolvedDependencyIds = target === undefined
    ? []
    : interpretation.inventory.relationships.flatMap((relationship) => {
        if (
          relationship.kind !== "depends-on" ||
          relationship.fromItemId !== target.itemId
        ) {
          return [];
        }
        const dependency = itemById.get(relationship.toItemId);
        const dependencyAccounting = accountingById.get(relationship.toItemId);
        return dependency?.importance === "essential" &&
          (
            dependencyAccounting?.state === "unbound" ||
            dependencyAccounting?.state === "uncertain"
          )
          ? [relationship.toItemId]
          : [];
      });
  const refusalCodes = [
    ...(accounting.length !== 1 ||
      target?.reason !== edge.requiredAccountingReason ||
      target.state !== "unbound"
      ? ["SUBSTITUTION_SIGNATURE_ACCOUNTING_INELIGIBLE"]
      : []),
    ...(item?.importance !== "essential"
      ? ["SUBSTITUTION_REQUIRES_ESSENTIAL_CONSTRUCTION_ITEM"]
      : []),
    ...(primaryBodies.length !== 1 ||
      primaryBodies[0]?.shapeClass !== edge.requiredBodyShapeClass
      ? ["SUBSTITUTION_PRIMARY_BODY_PRECONDITION_FAILED"]
      : []),
    ...(prohibitedMustRequirementIds.length > 0
      ? ["SUBSTITUTION_MUST_REQUIREMENT_PROHIBITS_EDGE"]
      : []),
    ...(unresolvedDependencyIds.length > 0
      ? ["SUBSTITUTION_ESSENTIAL_DEPENDENCY_UNRESOLVED"]
      : [])
  ];
  if (refusalCodes.length > 0 || target === undefined || item === undefined) {
    const attempt = SubstitutionAttemptSchema.parse({
      edgeId: edge.edgeId,
      signatureId,
      affectedInventoryItemId: target?.itemId ?? item?.id ?? "inventory-item-unknown",
      depth: 1,
      totalCost: edge.cost,
      status: "refused",
      findingCodes: refusalCodes.length === 0
        ? ["SUBSTITUTION_PRECONDITION_FAILED"]
        : refusalCodes
    });
    return {
      kind: "refused",
      trace: traceFromAttempts({
        selectedUnsupportedSignatureIds: selectedIds,
        attempts: [...(input.priorAttempts ?? []), attempt],
        appliedSubstitutions: []
      })
    };
  }
  const primaryBody = primaryBodies[0]!;
  const derivedRequirementId = StableIdSchema.parse(
    `substitution-${item.id}-rigid-corner-interface`,
  );
  const preservedMustRequirementIds = uniqueSorted(
    interpretation.projection.requirements.flatMap((requirement) =>
      requirement.priority === "must" ? [requirement.id] : []
    ),
  );
  const evidenceIds = uniqueSorted(
    item.evidenceBindings.map((binding) => binding.evidenceId),
  );
  const transformed = structuredClone(interpretation);
  transformed.projection.requirements.push({
    id: derivedRequirementId,
    priority: "must",
    kind: "rigid-interface",
    inventoryItemIds: [item.id],
    evidenceIds
  });
  const transformedBody = transformed.projection.constructionBodies.find(
    (body) => body.id === primaryBody.id,
  )!;
  transformedBody.requirementIds = uniqueSorted([
    ...transformedBody.requirementIds,
    derivedRequirementId
  ]);
  transformedBody.inventoryItemIds = uniqueSorted([
    ...transformedBody.inventoryItemIds,
    item.id
  ]);
  transformedBody.evidenceIds = uniqueSorted([
    ...transformedBody.evidenceIds,
    ...evidenceIds
  ]);
  const transformedAccounting = transformed.projection.accounting.find(
    (record) => record.itemId === item.id,
  )!;
  Object.assign(transformedAccounting, {
    state: "bound",
    requirementIds: [derivedRequirementId],
    bodyIds: [primaryBody.id],
    interfaceIds: [],
    relationIds: uniqueSorted(
      transformed.inventory.relationships.flatMap((relationship) =>
        relationship.fromItemId === item.id ||
        relationship.toItemId === item.id
          ? [relationship.id]
          : []
      ),
    ),
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    deferredByEvidenceIds: [],
    unsupportedSignatureIds: [],
    reason: null
  });
  const attempt = SubstitutionAttemptSchema.parse({
    edgeId: edge.edgeId,
    signatureId,
    affectedInventoryItemId: item.id,
    depth: 1,
    totalCost: edge.cost,
    status: "applied",
    findingCodes: []
  });
  const applied = AppliedSubstitutionSchema.parse({
    edgeId: edge.edgeId,
    edgeVersion: edge.edgeVersion,
    signatureId,
    replacementConstructionId: edge.toConstructionId,
    affectedSemanticIds: [item.id],
    derivedRequirementIds: [derivedRequirementId],
    preEdgeMustRequirementIds: preservedMustRequirementIds,
    preservedMustRequirementIds,
    changedMustRequirementIds: [],
    omittedMustRequirementIds: [],
    preservationObligations: edge.preservationObligations,
    relaxedPreservationObligations: [],
    disclosure: edge.disclosure
  });
  return {
    kind: "candidate",
    candidate: {
      interpretation: SemanticInterpretationSchema.parse(transformed),
      trace: traceFromAttempts({
        selectedUnsupportedSignatureIds: selectedIds,
        attempts: [...(input.priorAttempts ?? []), attempt],
        appliedSubstitutions: [applied]
      })
    }
  };
}

function fallbackObligationForRequirement(input: {
  interpretation: SemanticInterpretation;
  requirementId: string;
}): z.infer<typeof SubstitutionPreservationObligationSchema> | null {
  const requirement = input.interpretation.projection.requirements.find(
    (candidate) => candidate.id === input.requirementId,
  );
  if (requirement === undefined) return null;
  if (requirement.kind === "organization") return "organization";
  if (requirement.kind === "visual-treatment") return "surface-treatment";
  if (requirement.kind === "functional-aperture") {
    const applications = input.interpretation.projection.cutThrough.filter(
      (candidate) => candidate.requirementId === requirement.id,
    );
    if (applications.some((application) =>
      application.fixedTopAccess || application.purpose === "access"
    )) {
      return null;
    }
    return "functional-aperture";
  }
  if (requirement.kind === "cut-through-treatment") {
    const applications = input.interpretation.projection.cutThrough.filter(
      (candidate) => candidate.requirementId === requirement.id,
    );
    return applications.some((application) =>
      application.fixedTopAccess || application.purpose === "access"
    )
      ? null
      : "functional-aperture";
  }
  return null;
}

export function substitutionTraceForRetainedScope(input: {
  interpretation: SemanticInterpretation;
  trace: SubstitutionSearchTrace;
  changedRequirementIds?: readonly string[];
  omittedRequirementIds: readonly string[];
}): SubstitutionSearchTrace | null {
  const interpretation = SemanticInterpretationSchema.parse(
    input.interpretation,
  );
  const trace = SubstitutionSearchTraceSchema.parse(input.trace);
  const changed = new Set(input.changedRequirementIds ?? []);
  const omitted = new Set(input.omittedRequirementIds);
  const applications = trace.appliedSubstitutions.map((application) => {
    const changedMustRequirementIds =
      application.preEdgeMustRequirementIds.filter((requirementId) =>
        changed.has(requirementId)
      );
    const omittedMustRequirementIds =
      application.preEdgeMustRequirementIds.filter((requirementId) =>
        omitted.has(requirementId)
      );
    if (changedMustRequirementIds.some((requirementId) =>
      omitted.has(requirementId)
    )) {
      return null;
    }
    const relaxedRequirementIds = [
      ...changedMustRequirementIds,
      ...omittedMustRequirementIds
    ];
    const relaxedPreservationObligations = uniqueSorted(
      relaxedRequirementIds.flatMap((requirementId) => {
        const obligation = fallbackObligationForRequirement({
          interpretation,
          requirementId
        });
        return obligation === null ? [] : [obligation];
      }),
    ) as z.infer<typeof SubstitutionPreservationObligationSchema>[];
    if (
      relaxedPreservationObligations.length !==
        new Set(relaxedRequirementIds.map((requirementId) =>
          fallbackObligationForRequirement({ interpretation, requirementId })
        )).size ||
      relaxedRequirementIds.some((requirementId) =>
        fallbackObligationForRequirement({
          interpretation,
          requirementId
        }) === null
      )
    ) {
      return null;
    }
    return AppliedSubstitutionSchema.parse({
      ...application,
      preservedMustRequirementIds:
        application.preservedMustRequirementIds.filter((requirementId) =>
          !omitted.has(requirementId) && !changed.has(requirementId)
        ),
      changedMustRequirementIds: uniqueSorted([
        ...application.changedMustRequirementIds,
        ...changedMustRequirementIds
      ]),
      omittedMustRequirementIds: uniqueSorted([
        ...application.omittedMustRequirementIds,
        ...omittedMustRequirementIds
      ]),
      relaxedPreservationObligations
    });
  });
  if (applications.some((application) => application === null)) return null;
  return SubstitutionSearchTraceSchema.parse({
    ...trace,
    appliedSubstitutions: applications
  });
}

export function normalizeSubstitutionTraceForRequirementRealization(input: {
  interpretation: SemanticInterpretation;
  trace: SubstitutionSearchTrace;
  requirementRealization: RequirementRealizationLedgerV1;
  omittedRequirementIds: readonly string[];
}): SubstitutionSearchTrace | null {
  const requirementRealization = RequirementRealizationLedgerV1Schema.parse(
    input.requirementRealization,
  );
  return substitutionTraceForRetainedScope({
    interpretation: input.interpretation,
    trace: input.trace,
    changedRequirementIds: requirementRealization.records.flatMap((record) =>
      record.priority === "must" && record.state === "simplified"
        ? [record.requirementId]
        : []
    ),
    omittedRequirementIds: input.omittedRequirementIds
  });
}

export function refusedPostPipelineSubstitutionTrace(input: {
  candidate: PreparedSubstitutionCandidate;
  findingCode: string;
}): SubstitutionSearchTrace {
  const attempts = input.candidate.trace.attempts.map((attempt) =>
    SubstitutionAttemptSchema.parse({
      ...attempt,
      status: "refused",
      findingCodes: uniqueSorted([...attempt.findingCodes, input.findingCode])
    })
  );
  return traceFromAttempts({
    selectedUnsupportedSignatureIds:
      input.candidate.trace.selectedUnsupportedSignatureIds,
    attempts,
    appliedSubstitutions: []
  });
}
