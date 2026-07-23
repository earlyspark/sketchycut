import { z } from "zod";

import { StableIdSchema } from "../domain/primitives.js";
import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  SemanticAtomSchema,
  expandSemanticAtoms,
  semanticAtomCandidateSchemaForEvidenceId,
  semanticAtomCoordinate,
  semanticAtomRequiredAspect,
  type SemanticAtom,
  type SemanticAtomInventoryItem
} from "./semantic-atom-registry.js";
import {
  CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION,
  OpenSemanticInventorySchema,
  SemanticAspectSchema,
  SemanticEvidenceBindingSchema,
  SemanticInterpretationSchema,
  normalizeSemanticStrictOutputSchema,
  type SemanticInterpretation,
  type OpenSemanticInventory
} from "./semantic-interpretation.js";
import {
  SourceEvidenceIndexSchema,
  authorizedEvidenceIds,
  type SourceEvidenceIndex
} from "./source-evidence.js";

export const CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION = "6.0" as const;

const CompactModelTextSchema = z.string().min(1).max(320);
const RecoverableReasonSchema = z.enum([
  "CAPABILITY_NOT_REGISTERED",
  "EVIDENCE_INSUFFICIENT",
  "EVIDENCE_CONFLICT",
  "PROJECTION_COVERAGE_MISMATCH"
]);

const RelationshipChoiceSchema = z.object({
  kind: z.enum(["supports", "contradicts", "depends-on", "refines"]),
  targetItemOrdinal: z.number().int().min(1).max(48)
}).strict();

const ModelMeasurementTargetSchema = z.discriminatedUnion("subject", [
  z.object({
    subject: z.literal("project"),
    envelope: z.enum(["external", "internal"]),
    axis: z.enum(["width", "depth", "height"])
  }).strict(),
  z.object({
    subject: z.literal("object"),
    objectRole: z.enum(["contained", "supported"]),
    axis: z.enum(["width", "depth", "height"])
  }).strict()
]);

function candidateSchemaForEvidenceId(evidenceIdSchema: z.ZodType<string>) {
  const semanticAtomCandidateSchema =
    semanticAtomCandidateSchemaForEvidenceId(evidenceIdSchema);
  const evidenceBindingSchema = z.object({
    evidenceId: evidenceIdSchema,
    aspect: SemanticAspectSchema,
    support: z.enum(["direct", "inferred"])
  }).strict();
  const measurementChoiceSchema = z.object({
    target: ModelMeasurementTargetSchema,
    interpretation: z.enum(["exact", "approximate", "range", "ambiguous"]),
    literal: z.object({
      evidenceId: evidenceIdSchema,
      start: z.number().int().nonnegative(),
      end: z.number().int().positive()
    }).strict()
  }).strict();
  const commonShape = {
    claim: CompactModelTextSchema,
    evidenceBindings: z.array(evidenceBindingSchema).min(1).max(8),
    relationships: z.array(RelationshipChoiceSchema).max(12),
    measurements: z.array(measurementChoiceSchema).max(8)
  };
  const itemSchema = z.discriminatedUnion("state", [
    z.object({
      ...commonShape,
      importance: z.enum(["essential", "preference"]),
      state: z.literal("bound"),
      atoms: z.array(semanticAtomCandidateSchema).min(1).max(12)
    }).strict(),
    z.object({
      ...commonShape,
      importance: z.enum(["essential", "preference"]),
      state: z.literal("deferred")
    }).strict(),
    z.object({
      ...commonShape,
      importance: z.enum(["essential", "preference"]),
      state: z.literal("unbound"),
      reason: RecoverableReasonSchema
    }).strict(),
    z.object({
      ...commonShape,
      importance: z.enum(["essential", "preference"]),
      state: z.literal("uncertain"),
      reason: RecoverableReasonSchema,
      rationale: CompactModelTextSchema
    }).strict(),
    z.object({
      ...commonShape,
      state: z.literal("context")
    }).strict()
  ]);
  return z.object({
    schemaVersion: z.literal(CURRENT_SEMANTIC_MODEL_OUTPUT_VERSION),
    atomTemplateVersion: z.literal(CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION),
    items: z.array(itemSchema).min(1).max(48)
  }).strict();
}

export const SemanticInterpretationCandidateSchema = candidateSchemaForEvidenceId(StableIdSchema);

export type SemanticInterpretationCandidate = z.infer<typeof SemanticInterpretationCandidateSchema>;
export type SemanticInterpretationCandidateSchemaType = ReturnType<typeof candidateSchemaForEvidenceId>;

export function semanticInterpretationCandidateSchema(
  sourceEvidenceIndex: SourceEvidenceIndex,
): SemanticInterpretationCandidateSchemaType {
  const index = SourceEvidenceIndexSchema.parse(sourceEvidenceIndex);
  const evidenceIds = [...authorizedEvidenceIds(index)];
  if (evidenceIds.length === 0) throw new Error("SEMANTIC_PROVIDER_SCHEMA_REQUIRES_EVIDENCE");
  const evidenceIdSchema = z.enum(evidenceIds as [string, ...string[]]);
  return candidateSchemaForEvidenceId(evidenceIdSchema);
}

function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const candidate = z.toJSONSchema(schema, { target: "draft-7" });
  const normalized = normalizeSemanticStrictOutputSchema(candidate);
  return typeof candidate.$schema === "string"
    ? { $schema: candidate.$schema, ...normalized }
    : normalized;
}

export const SEMANTIC_INTERPRETATION_JSON_SCHEMA =
  providerJsonSchema(SemanticInterpretationCandidateSchema);

export function semanticInterpretationProviderSchema(
  sourceEvidenceIndex: SourceEvidenceIndex,
): Record<string, unknown> {
  return providerJsonSchema(semanticInterpretationCandidateSchema(sourceEvidenceIndex));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function itemId(itemIndex: number): string {
  return StableIdSchema.parse(`inventory-item-${String(itemIndex + 1)}`);
}

function relationshipId(itemIndex: number, relationshipIndex: number): string {
  return StableIdSchema.parse(
    `inventory-item-${String(itemIndex + 1)}-relationship-${String(relationshipIndex + 1)}`,
  );
}

function measurementId(itemIndex: number, measurementIndex: number): string {
  return StableIdSchema.parse(
    `inventory-item-${String(itemIndex + 1)}-measurement-${String(measurementIndex + 1)}`,
  );
}

function deterministicOmissionDisclosure(
  importance: "essential" | "preference" | "context",
): string | null {
  if (importance === "context") return null;
  return importance === "essential"
    ? "This essential semantic item withholds export unless deterministic accounting proves it bound."
    : "This preferred semantic item may be simplified only with a deterministic limitation disclosure.";
}

function evidenceClass(
  index: SourceEvidenceIndex,
  evidenceId: string,
): "brief" | "reference" | null {
  if (index.spans.some((span) => span.evidenceId === evidenceId)) return "brief";
  if (index.references.some((reference) => reference.evidenceId === evidenceId)) return "reference";
  return null;
}

function referenceAllowsAspect(
  index: SourceEvidenceIndex,
  evidenceId: string,
  aspect: z.infer<typeof SemanticAspectSchema>,
): boolean {
  const reference = index.references.find((candidate) => candidate.evidenceId === evidenceId);
  if (reference === undefined) return true;
  if (aspect === "operation") return false;
  if (aspect === "context") return true;
  return reference.declaredRoles.includes(aspect);
}

type CandidateItem = SemanticInterpretationCandidate["items"][number];
type EvidenceBinding = z.infer<typeof SemanticEvidenceBindingSchema>;

function evidenceIdsForAtom(
  item: CandidateItem,
  atom: SemanticAtom,
): string[] {
  if (atom.kind === "primary-enclosure") {
    return unique([
      ...atom.enclosure.evidenceIds,
      ...atom.access.evidenceIds,
      ...atom.space.evidenceIds
    ]);
  }
  return unique(item.evidenceBindings.map((binding) => binding.evidenceId));
}

function normalizedAtomEvidenceBindings(
  item: CandidateItem,
  sourceEvidenceIndex: SourceEvidenceIndex,
): EvidenceBinding[] {
  const bindings = [...item.evidenceBindings];
  if (item.state !== "bound") return bindings;
  for (const atom of item.atoms) {
    const aspect = semanticAtomRequiredAspect(atom);
    for (const evidenceId of evidenceIdsForAtom(item, atom)) {
      if (!referenceAllowsAspect(sourceEvidenceIndex, evidenceId, aspect) ||
          bindings.some((binding) =>
            binding.evidenceId === evidenceId && binding.aspect === aspect
          )) {
        continue;
      }
      const selectedBindings = item.evidenceBindings.filter(
        (binding) => binding.evidenceId === evidenceId,
      );
      if (selectedBindings.length === 0) continue;
      bindings.push({
        evidenceId,
        aspect,
        support: selectedBindings.some((binding) => binding.support === "direct")
          ? "direct"
          : "inferred"
      });
    }
  }
  return bindings;
}

function normalizedRelationship(input: {
  candidate: SemanticInterpretationCandidate;
  itemIndex: number;
  relationshipIndex: number;
  sourceEvidenceIndex?: SourceEvidenceIndex;
}) {
  const sourceItem = input.candidate.items[input.itemIndex]!;
  const choice = sourceItem.relationships[input.relationshipIndex]!;
  const targetIndex = choice.targetItemOrdinal - 1;
  const targetItem = input.candidate.items[targetIndex];
  if (targetItem === undefined || targetIndex === input.itemIndex) {
    throw new Error(
      `SEMANTIC_RELATIONSHIP_TARGET_INVALID:${String(input.itemIndex + 1)}:${String(choice.targetItemOrdinal)}`,
    );
  }
  let resolution: "from-item" | "to-item" | "unresolved" | "not-applicable" =
    choice.kind === "contradicts" ? "unresolved" : "not-applicable";
  let precedenceBasis: "explicit-brief" | "maker-reference-role" | "none" = "none";
  if (choice.kind === "contradicts" && input.sourceEvidenceIndex !== undefined) {
    const source = input.sourceEvidenceIndex;
    const sourceHasBrief = sourceItem.evidenceBindings.some(
      (binding) => evidenceClass(source, binding.evidenceId) === "brief",
    );
    const targetHasBrief = targetItem.evidenceBindings.some(
      (binding) => evidenceClass(source, binding.evidenceId) === "brief",
    );
    const sourceHasReference = sourceItem.evidenceBindings.some(
      (binding) => evidenceClass(source, binding.evidenceId) === "reference",
    );
    const targetHasReference = targetItem.evidenceBindings.some(
      (binding) => evidenceClass(source, binding.evidenceId) === "reference",
    );
    if (sourceHasBrief && targetHasReference && !targetHasBrief) {
      resolution = "from-item";
      precedenceBasis = "explicit-brief";
    } else if (targetHasBrief && sourceHasReference && !sourceHasBrief) {
      resolution = "to-item";
      precedenceBasis = "explicit-brief";
    } else {
      const sourceExcluded = sourceItem.evidenceBindings.length > 0 &&
        sourceItem.evidenceBindings.every(
          (binding) => !referenceAllowsAspect(source, binding.evidenceId, binding.aspect),
        );
      const targetExcluded = targetItem.evidenceBindings.length > 0 &&
        targetItem.evidenceBindings.every(
          (binding) => !referenceAllowsAspect(source, binding.evidenceId, binding.aspect),
        );
      if (sourceExcluded !== targetExcluded) {
        resolution = sourceExcluded ? "to-item" : "from-item";
        precedenceBasis = "maker-reference-role";
      }
    }
  }
  return {
    id: relationshipId(input.itemIndex, input.relationshipIndex),
    kind: choice.kind,
    fromItemId: itemId(input.itemIndex),
    toItemId: itemId(targetIndex),
    resolution,
    precedenceBasis,
    evidenceIds: unique([
      ...sourceItem.evidenceBindings.map((binding) => binding.evidenceId),
      ...targetItem.evidenceBindings.map((binding) => binding.evidenceId)
    ])
  };
}

function objectIdForMeasurement(
  candidate: SemanticInterpretationCandidate,
  objectRole: "contained" | "supported",
): string {
  const matches: string[] = [];
  for (const [candidateItemIndex, candidateItem] of candidate.items.entries()) {
    if (candidateItem.state !== "bound") continue;
    for (const [atomIndex, atom] of candidateItem.atoms.entries()) {
      if (objectRole === "contained" && atom.kind === "primary-enclosure") {
        matches.push(semanticAtomCoordinate(itemId(candidateItemIndex), atomIndex, "object-contained"));
      }
      if (objectRole === "supported" && atom.kind === "partial-support") {
        matches.push(semanticAtomCoordinate(itemId(candidateItemIndex), atomIndex, "object-supported"));
      }
    }
  }
  if (matches.length !== 1) {
    throw new Error(`SEMANTIC_MEASUREMENT_OBJECT_TARGET_INVALID:${objectRole}:${String(matches.length)}`);
  }
  return matches[0]!;
}

function normalizedInventory(
  candidate: SemanticInterpretationCandidate,
  sourceEvidenceIndex?: SourceEvidenceIndex,
): OpenSemanticInventory {
  const items = candidate.items.map((candidateItem, candidateItemIndex) => {
    const evidenceBindings = sourceEvidenceIndex === undefined
      ? candidateItem.evidenceBindings
      : normalizedAtomEvidenceBindings(candidateItem, sourceEvidenceIndex);
    const contextOnly = evidenceBindings.every(
      (binding) => binding.aspect === "context",
    );
    const importance = candidateItem.state === "context" || contextOnly
      ? "context" as const
      : candidateItem.importance;
    return {
      id: itemId(candidateItemIndex),
      claim: candidateItem.claim,
      importance,
      aspects: unique(evidenceBindings.map((binding) => binding.aspect)),
      evidenceBindings,
      omissionConsequence: deterministicOmissionDisclosure(importance),
      uncertainty: candidateItem.state === "uncertain"
        ? { state: "uncertain" as const, rationale: candidateItem.rationale }
        : { state: "certain" as const, rationale: null }
    };
  });
  const relationships = candidate.items.flatMap((candidateItem, candidateItemIndex) =>
    candidateItem.relationships.map((_, relationshipIndex) => normalizedRelationship({
      candidate,
      itemIndex: candidateItemIndex,
      relationshipIndex,
      ...(sourceEvidenceIndex === undefined ? {} : { sourceEvidenceIndex })
    }))
  );
  const measurementTargets = candidate.items.flatMap((candidateItem, candidateItemIndex) =>
    candidateItem.measurements.map((measurement, measurementIndex) => ({
      id: measurementId(candidateItemIndex, measurementIndex),
      inventoryItemId: itemId(candidateItemIndex),
      target: measurement.target.subject === "project"
        ? measurement.target
        : {
            subject: "contained-object" as const,
            objectId: objectIdForMeasurement(candidate, measurement.target.objectRole),
            axis: measurement.target.axis
          },
      interpretation: measurement.interpretation,
      literal: measurement.literal
    }))
  );
  return OpenSemanticInventorySchema.parse({
    title: "Interpreted maker request",
    purpose: "Preserve the evidence-grounded semantic choices in this request.",
    items,
    relationships,
    assumptions: [],
    measurementTargets
  });
}

function resolutionItems(
  candidate: SemanticInterpretationCandidate,
  inventory: OpenSemanticInventory,
): SemanticAtomInventoryItem[] {
  const items: SemanticAtomInventoryItem[] = [];
  for (const [candidateItemIndex, candidateItem] of candidate.items.entries()) {
    const inventoryItem = inventory.items[candidateItemIndex]!;
    if (inventoryItem.importance === "context" || candidateItem.state === "context") {
      items.push({ ...inventoryItem, importance: "context" });
      continue;
    }
    if (candidateItem.state === "bound") {
      items.push({
        ...inventoryItem,
        importance: candidateItem.importance,
        state: "bound",
        atoms: candidateItem.atoms
      });
      continue;
    }
    if (candidateItem.state === "deferred") {
      items.push({
        ...inventoryItem,
        importance: candidateItem.importance,
        state: "deferred",
        deferredByEvidenceIds: unique(candidateItem.evidenceBindings.map((binding) => binding.evidenceId))
      });
      continue;
    }
    items.push({
      ...inventoryItem,
      importance: candidateItem.importance,
      state: candidateItem.state,
      reason: candidateItem.reason
    });
  }
  return items;
}

export function expandSemanticInterpretationCandidate(
  candidateValue: unknown,
  sourceEvidenceIndex?: SourceEvidenceIndex,
): SemanticInterpretation {
  const candidate = SemanticInterpretationCandidateSchema.parse(candidateValue);
  const source = sourceEvidenceIndex === undefined
    ? undefined
    : SourceEvidenceIndexSchema.parse(sourceEvidenceIndex);
  const inventory = normalizedInventory(candidate, source);
  const projection = expandSemanticAtoms({
    inventory,
    items: resolutionItems(candidate, inventory)
  });
  return SemanticInterpretationSchema.parse({
    schemaVersion: CURRENT_SEMANTIC_INTERPRETATION_SCHEMA_VERSION,
    inventory,
    projection
  });
}

function allCandidateEvidenceBindings(
  candidate: SemanticInterpretationCandidate,
): z.infer<typeof SemanticEvidenceBindingSchema>[] {
  return candidate.items.flatMap((item) => [
    ...item.evidenceBindings,
    ...item.measurements.map((measurement) => ({
      evidenceId: measurement.literal.evidenceId,
      aspect: "structure" as const,
      support: "direct" as const
    }))
  ]);
}

export type SemanticAuthorizationFinding = {
  code:
    | "UNKNOWN_EVIDENCE_ID"
    | "DUPLICATE_EVIDENCE_BINDING"
    | "CONTEXT_AUTHORITY_FORBIDDEN"
    | "REFERENCE_OPERATION_UNAUTHORIZED"
    | "REFERENCE_ROLE_ACCOUNTING_MISMATCH"
    | "RELATIONSHIP_TARGET_INVALID"
    | "CONFLICT_PRECEDENCE_UNVERIFIED"
    | "MEASUREMENT_SPAN_UNVERIFIED"
    | "MEASUREMENT_TARGET_UNRESOLVED"
    | "SEMANTIC_ATOM_INVALID"
    | "REFERENCE_ROLE_ATOM_EXCLUDED"
    | "SEMANTIC_ATOM_EVIDENCE_ASPECT_MISSING"
    | "SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED"
    | "SEMANTIC_ATOM_INCOMPATIBLE";
  path: string;
};

function normalizeBoundItemsToReferenceRoles(input: {
  candidate: SemanticInterpretationCandidate;
  sourceEvidenceIndex: SourceEvidenceIndex;
}): {
  candidate: SemanticInterpretationCandidate;
  findings: SemanticAuthorizationFinding[];
} {
  const findings: SemanticAuthorizationFinding[] = [];
  const items = input.candidate.items.map((item, itemIndex) => {
    if (item.state !== "bound") return item;

    const retainedAtoms: SemanticAtom[] = [];
    const retainedBindings: EvidenceBinding[] = [];
    const excludedBindings: EvidenceBinding[] = [];
    const supportForEvidence = (evidenceId: string): "direct" | "inferred" =>
      item.evidenceBindings.some(
        (binding) => binding.evidenceId === evidenceId && binding.support === "direct",
      )
        ? "direct"
        : "inferred";
    const addBinding = (
      destination: EvidenceBinding[],
      evidenceId: string,
      aspect: "structure" | "surface",
    ): void => {
      if (destination.some((binding) =>
        binding.evidenceId === evidenceId && binding.aspect === aspect
      )) {
        return;
      }
      destination.push({
        evidenceId,
        aspect,
        support: supportForEvidence(evidenceId)
      });
    };

    for (const [atomIndex, atom] of item.atoms.entries()) {
      const aspect = semanticAtomRequiredAspect(atom);
      const evidenceIds = evidenceIdsForAtom(item, atom);
      const permittedEvidenceIds = evidenceIds.filter((evidenceId) =>
        referenceAllowsAspect(input.sourceEvidenceIndex, evidenceId, aspect) &&
        (atom.kind !== "primary-enclosure" ||
          item.evidenceBindings.some((binding) => binding.evidenceId === evidenceId))
      );
      const atomMustRemainStrict = atom.kind === "primary-enclosure";
      if (!atomMustRemainStrict && permittedEvidenceIds.length === 0) {
        findings.push({
          code: "REFERENCE_ROLE_ATOM_EXCLUDED",
          path: `items.${String(itemIndex)}.atoms.${String(atomIndex)}`
        });
        for (const evidenceId of evidenceIds) {
          addBinding(excludedBindings, evidenceId, aspect);
        }
        continue;
      }
      retainedAtoms.push(atom);
      for (const evidenceId of permittedEvidenceIds) {
        addBinding(retainedBindings, evidenceId, aspect);
      }
    }

    for (const measurement of item.measurements) {
      if (referenceAllowsAspect(
        input.sourceEvidenceIndex,
        measurement.literal.evidenceId,
        "structure",
      )) {
        addBinding(retainedBindings, measurement.literal.evidenceId, "structure");
      }
    }

    if (retainedAtoms.length === 0) {
      return {
        claim: item.claim,
        importance: item.importance,
        evidenceBindings: excludedBindings.length > 0
          ? excludedBindings
          : item.evidenceBindings,
        relationships: item.relationships,
        measurements: item.measurements,
        state: "deferred" as const
      };
    }

    return {
      ...item,
      evidenceBindings: retainedBindings.length > 0
        ? retainedBindings
        : item.evidenceBindings,
      atoms: retainedAtoms
    };
  });
  return {
    candidate: SemanticInterpretationCandidateSchema.parse({
      ...input.candidate,
      items
    }),
    findings
  };
}

function semanticFindings(input: {
  candidate: SemanticInterpretationCandidate;
  sourceEvidenceIndex: SourceEvidenceIndex;
}): SemanticAuthorizationFinding[] {
  const findings: SemanticAuthorizationFinding[] = [];
  const authorized = authorizedEvidenceIds(input.sourceEvidenceIndex);
  for (const binding of allCandidateEvidenceBindings(input.candidate)) {
    if (!authorized.has(binding.evidenceId)) {
      findings.push({ code: "UNKNOWN_EVIDENCE_ID", path: binding.evidenceId });
    }
  }
  for (const [candidateItemIndex, candidateItem] of input.candidate.items.entries()) {
    const path = `items.${String(candidateItemIndex)}`;
    const bindingFingerprints = candidateItem.evidenceBindings.map((binding) =>
      `${binding.evidenceId}:${binding.aspect}:${binding.support}`
    );
    if (new Set(bindingFingerprints).size !== bindingFingerprints.length) {
      findings.push({ code: "DUPLICATE_EVIDENCE_BINDING", path: `${path}.evidenceBindings` });
    }
    if (candidateItem.state === "context" &&
        candidateItem.evidenceBindings.some((binding) => binding.aspect !== "context")) {
      findings.push({ code: "CONTEXT_AUTHORITY_FORBIDDEN", path });
    }
    if (candidateItem.evidenceBindings.some((binding) =>
      evidenceClass(input.sourceEvidenceIndex, binding.evidenceId) === "reference" &&
      binding.aspect === "operation"
    )) {
      findings.push({ code: "REFERENCE_OPERATION_UNAUTHORIZED", path });
    }
    const authorityBindings = normalizedAtomEvidenceBindings(
      candidateItem,
      input.sourceEvidenceIndex,
    );
    const excludedBindings = authorityBindings.filter((binding) =>
      !referenceAllowsAspect(input.sourceEvidenceIndex, binding.evidenceId, binding.aspect)
    );
    const allBindingsExcluded = excludedBindings.length === authorityBindings.length;
    if ((candidateItem.state === "deferred") !== allBindingsExcluded) {
      findings.push({ code: "REFERENCE_ROLE_ACCOUNTING_MISMATCH", path });
    }
    for (const [relationshipIndex, relationship] of candidateItem.relationships.entries()) {
      const targetIndex = relationship.targetItemOrdinal - 1;
      if (targetIndex === candidateItemIndex || input.candidate.items[targetIndex] === undefined) {
        findings.push({
          code: "RELATIONSHIP_TARGET_INVALID",
          path: `${path}.relationships.${String(relationshipIndex)}`
        });
      }
    }
    for (const [measurementIndex, measurement] of candidateItem.measurements.entries()) {
      const measurementPath = `${path}.measurements.${String(measurementIndex)}`;
      const span = input.sourceEvidenceIndex.spans.find(
        (entry) => entry.evidenceId === measurement.literal.evidenceId,
      );
      if (measurement.literal.end <= measurement.literal.start ||
          span === undefined ||
          measurement.literal.start < span.start ||
          measurement.literal.end > span.end) {
        findings.push({ code: "MEASUREMENT_SPAN_UNVERIFIED", path: measurementPath });
      }
      if (measurement.target.subject === "object") {
        try {
          objectIdForMeasurement(input.candidate, measurement.target.objectRole);
        } catch {
          findings.push({ code: "MEASUREMENT_TARGET_UNRESOLVED", path: measurementPath });
        }
      }
    }
    if (candidateItem.state === "bound") {
      const atomFingerprints = candidateItem.atoms.map((atom) => JSON.stringify(atom));
      if (new Set(atomFingerprints).size !== atomFingerprints.length) {
        findings.push({ code: "SEMANTIC_ATOM_INVALID", path: `${path}.atoms` });
      }
      for (const [atomIndex, atom] of candidateItem.atoms.entries()) {
        const parsedAtom = SemanticAtomSchema.safeParse(atom);
        if (!parsedAtom.success) {
          findings.push({ code: "SEMANTIC_ATOM_INVALID", path: `${path}.atoms.${String(atomIndex)}` });
          continue;
        }
        if (parsedAtom.data.kind === "primary-enclosure") {
          const selectedEvidenceIds = new Set(
            candidateItem.evidenceBindings.map((binding) => binding.evidenceId),
          );
          for (const [slot, evidenceIds] of [
            ["enclosure", parsedAtom.data.enclosure.evidenceIds],
            ["access", parsedAtom.data.access.evidenceIds],
            ["space", parsedAtom.data.space.evidenceIds]
          ] as const) {
            if (new Set(evidenceIds).size !== evidenceIds.length ||
                evidenceIds.some((evidenceId) =>
                  !selectedEvidenceIds.has(evidenceId) ||
                  !referenceAllowsAspect(input.sourceEvidenceIndex, evidenceId, "structure")
                )) {
              findings.push({
                code: "SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED",
                path: `${path}.atoms.${String(atomIndex)}.${slot}.evidenceIds`
              });
            }
          }
        }
        const requiredAspect = semanticAtomRequiredAspect(parsedAtom.data);
        if (!candidateItem.evidenceBindings.some((binding) =>
          referenceAllowsAspect(
            input.sourceEvidenceIndex,
            binding.evidenceId,
            requiredAspect,
          )
        )) {
          findings.push({
            code: "SEMANTIC_ATOM_EVIDENCE_ASPECT_MISSING",
            path: `${path}.atoms.${String(atomIndex)}`
          });
        }
      }
    }
  }
  if (!findings.some((finding) =>
    finding.code === "RELATIONSHIP_TARGET_INVALID" ||
    finding.code === "MEASUREMENT_TARGET_UNRESOLVED"
  )) {
    const inventory = normalizedInventory(input.candidate, input.sourceEvidenceIndex);
    for (const relationship of inventory.relationships) {
      if (relationship.kind !== "contradicts" || relationship.resolution !== "unresolved") continue;
      const fromIndex = Number(relationship.fromItemId.split("-").at(-1)) - 1;
      const toIndex = Number(relationship.toItemId.split("-").at(-1)) - 1;
      const from = input.candidate.items[fromIndex];
      const to = input.candidate.items[toIndex];
      if (from?.state === "bound" || to?.state === "bound") {
        findings.push({ code: "CONFLICT_PRECEDENCE_UNVERIFIED", path: relationship.id });
      }
    }
  }
  return findings;
}

const NON_FATAL_AUTHORIZATION_FINDINGS =
  new Set<SemanticAuthorizationFinding["code"]>([
    "MEASUREMENT_SPAN_UNVERIFIED",
    "REFERENCE_ROLE_ATOM_EXCLUDED"
  ]);

export function authorizeSemanticInterpretation(input: {
  interpretation: unknown;
  sourceEvidenceIndex: SourceEvidenceIndex;
}): {
  success: true;
  candidate: SemanticInterpretationCandidate;
  interpretation: SemanticInterpretation;
  findings: SemanticAuthorizationFinding[];
} | {
  success: false;
  candidate: null;
  interpretation: null;
  findings: SemanticAuthorizationFinding[];
  schemaIssues: string[];
} {
  const index = SourceEvidenceIndexSchema.parse(input.sourceEvidenceIndex);
  const providerBoundSchema = semanticInterpretationCandidateSchema(index);
  const parsedCandidate = providerBoundSchema.safeParse(input.interpretation);
  if (!parsedCandidate.success) {
    return {
      success: false,
      candidate: null,
      interpretation: null,
      findings: [],
      schemaIssues: parsedCandidate.error.issues.map(
        (issue) => `${issue.path.join(".")}:${issue.message}`,
      )
    };
  }
  const normalized = normalizeBoundItemsToReferenceRoles({
    candidate: SemanticInterpretationCandidateSchema.parse(parsedCandidate.data),
    sourceEvidenceIndex: index
  });
  const candidate = normalized.candidate;
  const findings = [
    ...normalized.findings,
    ...semanticFindings({ candidate, sourceEvidenceIndex: index })
  ];
  if (findings.some((finding) => !NON_FATAL_AUTHORIZATION_FINDINGS.has(finding.code))) {
    return {
      success: false,
      candidate: null,
      interpretation: null,
      findings,
      schemaIssues: []
    };
  }
  try {
    return {
      success: true,
      candidate,
      interpretation: expandSemanticInterpretationCandidate(candidate, index),
      findings
    };
  } catch (error) {
    return {
      success: false,
      candidate: null,
      interpretation: null,
      findings: [{
        code: "SEMANTIC_ATOM_INCOMPATIBLE",
        path: error instanceof Error ? error.message : "SEMANTIC_ATOM_EXPANSION_FAILED"
      }],
      schemaIssues: []
    };
  }
}

export function candidateStructuralChoices(
  candidateValue: unknown,
): SemanticInterpretationCandidate {
  return SemanticInterpretationCandidateSchema.parse(candidateValue);
}

export function candidateSemanticAtoms(
  candidateValue: unknown,
): readonly SemanticAtom[] {
  const candidate = candidateStructuralChoices(candidateValue);
  return candidate.items.flatMap((item) => item.state === "bound" ? item.atoms : []);
}
