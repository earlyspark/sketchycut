import { z } from "zod";

import { Sha256Schema, StableIdSchema } from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  CAPABILITY_CATALOG_V1,
  RegisteredMotifPrimitiveSchema,
  type RegisteredMotifPrimitive
} from "./capability-catalog.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "./intent-graph.js";

const FindingSchema = z
  .object({
    code: z.enum([
      "MAPPER_INPUT_INVALID",
      "EMPTY_OR_DISCONNECTED_TOPOLOGY",
      "CONTRADICTORY_INTERFACES",
      "COMPOUND_MOTION_UNSUPPORTED",
      "INTERFACE_ORIENTATION_UNSUPPORTED",
      "ESSENTIAL_ROD_REALIZATION_UNSUPPORTED",
      "MANDATORY_REQUIREMENT_UNSUPPORTED",
      "CORE_INTENT_UNREPRESENTABLE",
      "MOTIF_PRIMITIVE_UNREGISTERED",
      "PREFERRED_REQUIREMENT_OMITTED"
    ]),
    message: z.string().min(1).max(500),
    relatedIds: z.array(StableIdSchema)
  })
  .strict();

const RequirementEvidenceSchema = z
  .object({
    requirementId: StableIdSchema,
    capabilityIds: z.array(StableIdSchema).min(1),
    sourceEvidenceIds: z.array(StableIdSchema).min(1),
    deterministicCheckIds: z.array(StableIdSchema).min(1)
  })
  .strict();

const OperatorGraphSchema = z
  .object({
    graphId: z.enum([
      "rigid-panel-composition",
      "single-revolute-panel",
      "single-prismatic-panel"
    ]),
    capabilityIds: z.array(StableIdSchema).min(1),
    operatorIds: z.array(StableIdSchema).min(1),
    motionBehavior: z.enum(["rigid", "revolute", "prismatic"]),
    deterministicRank: z.literal(1)
  })
  .strict();

const MappingBaseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  intentDigest: Sha256Schema,
  findings: z.array(FindingSchema)
});

export const SupportedCapabilityMappingSchema = MappingBaseSchema.extend({
    kind: z.literal("supported"),
    operatorGraph: OperatorGraphSchema,
    requirementEvidence: z.array(RequirementEvidenceSchema),
    acceptedMotifPrimitives: z.array(RegisteredMotifPrimitiveSchema),
    disclosures: z.array(z.string().min(1).max(500)).length(0)
  }).strict();

export const SimplifiedCapabilityMappingSchema = MappingBaseSchema.extend({
    kind: z.literal("simplified"),
    operatorGraph: OperatorGraphSchema,
    requirementEvidence: z.array(RequirementEvidenceSchema),
    acceptedMotifPrimitives: z.array(RegisteredMotifPrimitiveSchema),
    disclosures: z.array(z.string().min(1).max(500)).min(1)
  }).strict();

export const ConceptOnlyCapabilityMappingSchema = MappingBaseSchema.extend({
    kind: z.literal("concept-only"),
    operatorGraph: z.null(),
    requirementEvidence: z.array(RequirementEvidenceSchema),
    acceptedMotifPrimitives: z.array(RegisteredMotifPrimitiveSchema),
    disclosures: z.array(z.string().min(1).max(500)),
    blockedRequirementIds: z.array(StableIdSchema),
    unresolvedNeeds: z.array(z.string().min(1).max(500))
  }).strict();

export const CapabilityMappingOutcomeSchema = z.discriminatedUnion("kind", [
  SupportedCapabilityMappingSchema,
  SimplifiedCapabilityMappingSchema,
  ConceptOnlyCapabilityMappingSchema
]);

export type CapabilityMappingOutcome = z.infer<typeof CapabilityMappingOutcomeSchema>;
type Finding = z.infer<typeof FindingSchema>;

const capabilityByRequirementKind: Partial<Record<
  IntentGraphV1["requirements"][number]["kind"],
  string
>> = {
  "rigid-assembly": "rigid-orthogonal-sheet-assembly",
  containment: "rigid-orthogonal-sheet-assembly",
  "revolute-motion": "single-axis-retained-revolute",
  "prismatic-motion": "single-axis-captured-prismatic",
  "permitted-stock": "rigid-orthogonal-sheet-assembly",
  "visual-treatment": "safe-procedural-surface-treatment"
} as const;

function topologyConnected(intent: IntentGraphV1): boolean {
  const ids = intent.topology.bodies.map((body) => body.id);
  if (ids.length === 1) return true;
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const item of intent.topology.interfaces) {
    adjacency.get(item.between[0])?.add(item.between[1]);
    adjacency.get(item.between[1])?.add(item.between[0]);
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

function contradictoryInterfaceIds(intent: IntentGraphV1): string[] {
  const byPair = new Map<string, Map<string, string[]>>();
  for (const item of intent.topology.interfaces) {
    const pair = [...item.between].sort().join("|");
    const behaviors = byPair.get(pair) ?? new Map<string, string[]>();
    const ids = behaviors.get(item.behavior) ?? [];
    ids.push(item.id);
    behaviors.set(item.behavior, ids);
    byPair.set(pair, behaviors);
  }
  return [...byPair.values()].flatMap((behaviors) =>
    behaviors.size > 1 ? [...behaviors.values()].flat() : [],
  ).sort();
}

function operatorGraph(intent: IntentGraphV1): z.infer<typeof OperatorGraphSchema> {
  const moving = intent.topology.interfaces.filter((item) => item.behavior !== "rigid");
  const behavior = moving[0]?.behavior ?? "rigid";
  if (behavior === "revolute") {
    return {
      graphId: "single-revolute-panel",
      capabilityIds: [
        "rigid-orthogonal-sheet-assembly",
        "single-axis-retained-revolute",
        "safe-procedural-surface-treatment"
      ],
      operatorIds: [
        "orthogonal-panel-layout",
        "panel-tab-slot-mate",
        "edge-finger-mate",
        "retained-pin-revolute",
        "procedural-surface-treatment"
      ],
      motionBehavior: "revolute",
      deterministicRank: 1
    };
  }
  if (behavior === "prismatic") {
    return {
      graphId: "single-prismatic-panel",
      capabilityIds: [
        "rigid-orthogonal-sheet-assembly",
        "single-axis-captured-prismatic",
        "safe-procedural-surface-treatment"
      ],
      operatorIds: [
        "orthogonal-panel-layout",
        "panel-tab-slot-mate",
        "edge-finger-mate",
        "captured-panel-slide",
        "procedural-surface-treatment"
      ],
      motionBehavior: "prismatic",
      deterministicRank: 1
    };
  }
  return {
    graphId: "rigid-panel-composition",
    capabilityIds: [
      "rigid-orthogonal-sheet-assembly",
      "safe-procedural-surface-treatment"
    ],
    operatorIds: [
      "orthogonal-panel-layout",
      "panel-tab-slot-mate",
      "edge-finger-mate",
      "procedural-surface-treatment"
    ],
    motionBehavior: "rigid",
    deterministicRank: 1
  };
}

function evidenceFor(
  intent: IntentGraphV1,
  graph: z.infer<typeof OperatorGraphSchema>,
): z.infer<typeof RequirementEvidenceSchema>[] {
  return intent.requirements
    .filter((item) => item.priority === "must")
    .flatMap((item) => {
      const capabilityId = capabilityByRequirementKind[item.kind];
      if (capabilityId === undefined || !graph.capabilityIds.includes(capabilityId)) return [];
      return [{
        requirementId: item.id,
        capabilityIds: [capabilityId],
        sourceEvidenceIds: item.evidence.map((evidence) => evidence.evidenceId).sort(),
        deterministicCheckIds: [
          item.kind === "revolute-motion"
            ? "revolute-motion-proof"
            : item.kind === "prismatic-motion"
            ? "prismatic-motion-proof"
            : item.kind === "visual-treatment"
            ? "motif-operation-proof"
            : "canonical-validation"
        ]
      }];
    })
    .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
}

function motifSelection(intent: IntentGraphV1): {
  accepted: RegisteredMotifPrimitive[];
  unknown: string[];
} {
  const registered = new Set(CAPABILITY_CATALOG_V1.motifPrimitiveFamilies);
  const requested = intent.motif?.primitiveFamilies ?? [];
  return {
    accepted: requested.filter((item): item is RegisteredMotifPrimitive => registered.has(
      item as RegisteredMotifPrimitive,
    )).sort(),
    unknown: requested.filter((item) => !registered.has(item as RegisteredMotifPrimitive)).sort()
  };
}

export async function mapIntentGraph(candidate: unknown): Promise<CapabilityMappingOutcome> {
  const intentDigest = await hashCanonical(candidate);
  const parsed = IntentGraphV1Schema.safeParse(candidate);
  if (!parsed.success) {
    return CapabilityMappingOutcomeSchema.parse({
      schemaVersion: "1.0",
      kind: "concept-only",
      intentDigest,
      operatorGraph: null,
      requirementEvidence: [],
      acceptedMotifPrimitives: [],
      disclosures: [],
      blockedRequirementIds: [],
      unresolvedNeeds: ["The semantic topology did not satisfy the strict IntentGraphV1 contract."],
      findings: [{
        code: "MAPPER_INPUT_INVALID",
        message: "Strict semantic validation failed before capability mapping.",
        relatedIds: []
      }]
    });
  }
  const intent = parsed.data;
  const findings: Finding[] = [];
  const blocked = new Set<string>();
  const unresolved = new Set(intent.capabilityAssessment.unresolvedNeeds);
  const moving = intent.topology.interfaces.filter((item) => item.behavior !== "rigid");
  const contradictions = contradictoryInterfaceIds(intent);

  if (!topologyConnected(intent)) {
    findings.push({
      code: "EMPTY_OR_DISCONNECTED_TOPOLOGY",
      message: "All essential bodies must participate in one connected topology.",
      relatedIds: intent.topology.bodies.map((body) => body.id).sort()
    });
  }
  if (contradictions.length > 0) {
    findings.push({
      code: "CONTRADICTORY_INTERFACES",
      message: "The same body pair declares incompatible interface behaviors.",
      relatedIds: contradictions
    });
  }
  const movingBodyQuantity = intent.topology.bodies
    .filter((body) => body.role === "moving-panel")
    .reduce((total, body) => total + body.quantity, 0);
  if (moving.length > 1 || movingBodyQuantity > 1) {
    findings.push({
      code: "COMPOUND_MOTION_UNSUPPORTED",
      message: "Current registered graphs support one essential moving panel and one motion axis.",
      relatedIds: moving.map((item) => item.id).sort()
    });
  }
  for (const item of moving) {
    const supported = item.behavior === "revolute"
      ? ["coaxial", "unspecified"].includes(item.relativeOrientation)
      : ["width", "depth", "unspecified"].includes(item.axisRole);
    if (!supported) {
      findings.push({
        code: "INTERFACE_ORIENTATION_UNSUPPORTED",
        message: `The ${item.behavior} interface uses an unsupported orientation or axis role.`,
        relatedIds: [item.id]
      });
    }
  }
  const essentialRods = intent.topology.bodies.filter((body) => body.shapeClass === "rod");
  if (essentialRods.length > 0) {
    findings.push({
      code: "ESSENTIAL_ROD_REALIZATION_UNSUPPORTED",
      message: "Declared essential rod bodies require a registered realization; synthesized auxiliary pins do not satisfy arbitrary rod intent.",
      relatedIds: essentialRods.map((body) => body.id).sort()
    });
  }
  if (!intent.capabilityAssessment.coreIntentRepresentable) {
    findings.push({
      code: "CORE_INTENT_UNREPRESENTABLE",
      message: "The interpretation reports that the core function is outside the supplied capability catalog.",
      relatedIds: []
    });
  }

  const motif = motifSelection(intent);
  if (motif.unknown.length > 0) {
    findings.push({
      code: "MOTIF_PRIMITIVE_UNREGISTERED",
      message: `Unregistered motif primitive families were omitted: ${motif.unknown.join(", ")}.`,
      relatedIds: []
    });
  }
  const graph = operatorGraph(intent);
  const mandatoryKinds = new Set(intent.requirements
    .filter((item) => item.priority === "must")
    .map((item) => item.kind));
  const behaviorSupported = (kind: IntentGraphV1["requirements"][number]["kind"]): boolean => {
    if (kind === "revolute-motion") return graph.motionBehavior === "revolute";
    if (kind === "prismatic-motion") return graph.motionBehavior === "prismatic";
    if (kind === "specific-profile" || kind === "compound-motion") return false;
    if (kind === "permitted-stock") return essentialRods.length === 0;
    if (kind === "visual-treatment") return intent.motif !== null && motif.accepted.length > 0;
    return true;
  };
  for (const requirement of intent.requirements) {
    if (behaviorSupported(requirement.kind)) continue;
    if (requirement.priority === "must") {
      blocked.add(requirement.id);
      unresolved.add(requirement.statement);
      findings.push({
        code: "MANDATORY_REQUIREMENT_UNSUPPORTED",
        message: `Mandatory requirement ${requirement.id} has no registered deterministic evidence path.`,
        relatedIds: [requirement.id]
      });
    }
  }
  if (mandatoryKinds.has("compound-motion") || mandatoryKinds.has("specific-profile")) {
    unresolved.add("A required capability is not present in the registered V1 operator catalog.");
  }

  const blockingCodes = new Set([
    "EMPTY_OR_DISCONNECTED_TOPOLOGY",
    "CONTRADICTORY_INTERFACES",
    "COMPOUND_MOTION_UNSUPPORTED",
    "INTERFACE_ORIENTATION_UNSUPPORTED",
    "ESSENTIAL_ROD_REALIZATION_UNSUPPORTED",
    "MANDATORY_REQUIREMENT_UNSUPPORTED",
    "CORE_INTENT_UNREPRESENTABLE"
  ]);
  if (findings.some((finding) => blockingCodes.has(finding.code))) {
    return CapabilityMappingOutcomeSchema.parse({
      schemaVersion: "1.0",
      kind: "concept-only",
      intentDigest,
      operatorGraph: null,
      requirementEvidence: [],
      acceptedMotifPrimitives: motif.accepted,
      disclosures: [],
      blockedRequirementIds: [...blocked].sort(),
      unresolvedNeeds: [...unresolved].sort(),
      findings
    });
  }

  const disclosures: string[] = [];
  for (const requirement of intent.requirements) {
    if (requirement.priority === "prefer" && !behaviorSupported(requirement.kind)) {
      disclosures.push(`Preferred request omitted without changing the core function: ${requirement.statement}`);
      findings.push({
        code: "PREFERRED_REQUIREMENT_OMITTED",
        message: `Preferred requirement ${requirement.id} was omitted with disclosure.`,
        relatedIds: [requirement.id]
      });
    }
  }
  if (motif.unknown.length > 0) {
    disclosures.push("Unregistered visual primitives were omitted; only deterministic registered artwork is used.");
  }
  const requirementEvidence = evidenceFor(intent, graph);
  const missingEvidence = intent.requirements
    .filter((item) => item.priority === "must")
    .filter((item) => !requirementEvidence.some((entry) => entry.requirementId === item.id));
  if (missingEvidence.length > 0) {
    return CapabilityMappingOutcomeSchema.parse({
      schemaVersion: "1.0",
      kind: "concept-only",
      intentDigest,
      operatorGraph: null,
      requirementEvidence,
      acceptedMotifPrimitives: motif.accepted,
      disclosures,
      blockedRequirementIds: missingEvidence.map((item) => item.id).sort(),
      unresolvedNeeds: missingEvidence.map((item) => item.statement).sort(),
      findings: [
        ...findings,
        ...missingEvidence.map((item) => ({
          code: "MANDATORY_REQUIREMENT_UNSUPPORTED" as const,
          message: `Mandatory requirement ${item.id} lacks deterministic evidence.`,
          relatedIds: [item.id]
        }))
      ]
    });
  }
  return CapabilityMappingOutcomeSchema.parse({
    schemaVersion: "1.0",
    kind: disclosures.length > 0 ? "simplified" : "supported",
    intentDigest,
    operatorGraph: graph,
    requirementEvidence,
    acceptedMotifPrimitives: motif.accepted,
    disclosures,
    findings
  });
}
