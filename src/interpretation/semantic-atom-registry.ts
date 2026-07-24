import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/primitives.js";
import {
  CAPABILITY_CATALOG,
  RegisteredMotifPrimitiveSchema
} from "./capability-catalog.js";
import {
  ClosedSemanticProjectionSchema,
  type ClosedSemanticProjection,
  type OpenSemanticInventory,
  type SemanticInventoryItem
} from "./semantic-interpretation.js";

export const CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION = "5.0.0" as const;

const PrioritySchema = z.enum(["must", "prefer"]);
const TargetBodyRoleSchema = z.enum(["primary-enclosure", "support"]);
const TargetObjectRoleSchema = z.enum(["contained", "supported"]);
const AxisSchema = z.enum(["width", "depth", "height"]);

const QuantizedUmCandidateSchema = z.number().int().positive().max(1_000_000);

const ScaleRangeCandidateSchema = z.object({
  minimumUm: QuantizedUmCandidateSchema,
  maximumUm: QuantizedUmCandidateSchema
}).strict();

function primaryAuthorityFields(evidenceIdSchema: z.ZodType<string>) {
  return {
    priority: PrioritySchema,
    evidenceIds: z.array(evidenceIdSchema).min(1).max(8)
  };
}

function primaryEnclosureAtomSchemas(evidenceIdSchema: z.ZodType<string>) {
  const authority = primaryAuthorityFields(evidenceIdSchema);
  const common = {
    kind: z.literal("primary-enclosure"),
    enclosure: z.object({
      quantity: z.number().int().positive().max(64).nullable(),
      ...authority
    }).strict(),
    access: z.object({
      kind: z.enum([
        "unspecified",
        "open-top",
        "open-front",
        "covered-top",
        "covered-front"
      ]),
      ...authority
    }).strict()
  };
  return [
    z.object({
      ...common,
      space: z.object({ layout: z.literal("unspecified"), ...authority }).strict()
    }).strict(),
    z.object({
      ...common,
      space: z.object({
        layout: z.literal("explicit-single-space"),
        ...authority
      }).strict()
    }).strict(),
    z.object({
      ...common,
      space: z.object({ layout: z.literal("minimum-separated"), ...authority }).strict()
    }).strict(),
    z.object({
      ...common,
      space: z.object({
        layout: z.literal("count"),
        desiredSpaceCount: z.number().int().min(2).max(12),
        ...authority
      }).strict()
    }).strict(),
    z.object({
      ...common,
      space: z.object({
        layout: z.literal("grid"),
        rows: z.literal(1),
        columns: z.number().int().min(2).max(6),
        ...authority
      }).strict()
    }).strict(),
    z.object({
      ...common,
      space: z.object({
        layout: z.literal("grid"),
        rows: z.number().int().min(2).max(6),
        columns: z.number().int().min(1).max(6),
        ...authority
      }).strict()
    }).strict()
  ] as const;
}

const PartialSupportAtomSchema = z.object({
  kind: z.literal("partial-support"),
  priority: PrioritySchema,
  quantity: z.number().int().positive().max(64).nullable()
}).strict();

const OpenAccessAtomCandidateSchema = z.object({
  kind: z.literal("open-access"),
  targetBodyRole: z.literal("support"),
  accessKind: z.enum(["open-top", "open-front"]),
  priority: PrioritySchema
}).strict();

const RetainedRevoluteCoverAtomSchema = z.object({
  kind: z.literal("retained-revolute-cover"),
  axis: z.literal("width"),
  priority: PrioritySchema
}).strict();

const CapturedPrismaticCoverAtomSchema = z.object({
  kind: z.literal("captured-prismatic-cover"),
  axis: z.literal("depth"),
  priority: PrioritySchema
}).strict();

const OrganizationAtomCandidateSchemas = [
  z.object({
    kind: z.literal("organization"),
    targetBodyRole: z.literal("support"),
    layout: z.literal("count"),
    desiredSpaceCount: z.number().int().min(2).max(12),
    priority: PrioritySchema
  }).strict(),
  z.object({
    kind: z.literal("organization"),
    targetBodyRole: z.literal("support"),
    layout: z.literal("minimum-separated"),
    priority: PrioritySchema
  }).strict(),
  z.object({
    kind: z.literal("organization"),
    targetBodyRole: z.literal("support"),
    layout: z.literal("grid"),
    rows: z.literal(1),
    columns: z.number().int().min(2).max(6),
    priority: PrioritySchema
  }).strict(),
  z.object({
    kind: z.literal("organization"),
    targetBodyRole: z.literal("support"),
    layout: z.literal("grid"),
    rows: z.number().int().min(2).max(6),
    columns: z.number().int().min(1).max(6),
    priority: PrioritySchema
  }).strict()
] as const;

const QualitativeProportionAtomCandidateSchema = z.object({
  kind: z.literal("qualitative-proportion"),
  targetBodyRole: TargetBodyRoleSchema,
  numeratorAxis: AxisSchema,
  denominatorAxis: AxisSchema,
  strength: z.enum(["moderate", "strong", "extreme"]),
  priority: PrioritySchema,
  confidence: z.enum(["low", "medium", "high"])
}).strict();

const ObjectClearanceAtomSchema = z.object({
  kind: z.literal("object-clearance"),
  targetObjectRole: TargetObjectRoleSchema,
  clearance: z.enum(["close", "ordinary-access", "easy-access"]),
  priority: PrioritySchema
}).strict();

const ObjectScaleAtomSchema = z.object({
  kind: z.literal("object-scale"),
  targetObjectRole: TargetObjectRoleSchema,
  long: ScaleRangeCandidateSchema,
  short: ScaleRangeCandidateSchema,
  height: ScaleRangeCandidateSchema,
  confidence: z.enum(["low", "medium", "high"])
}).strict();

const RankedGoalAtomSchema = z.object({
  kind: z.literal("ranked-goal"),
  goal: z.enum(["compactness", "capacity", "accessibility", "low-part-count"]),
  rank: z.number().int().positive().max(8)
}).strict();

const SurfaceTreatmentAtomCandidateSchema = z.object({
  kind: z.literal("registered-surface-treatment"),
  composition: z.enum(["border", "field", "focal", "repeated"]),
  density: z.enum(["sparse", "balanced", "dense"]),
  symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
  primitiveFamilies: z.array(RegisteredMotifPrimitiveSchema).min(1).max(6),
  preferredOperations: z.array(z.enum(["engrave", "score"])).min(1).max(2),
  preferredBodyRoles: z.array(z.enum(["primary-enclosure", "support", "cover"])).min(1).max(3)
}).strict();

const StructuralApertureAtomCandidateSchema = z.object({
  kind: z.literal("structural-aperture"),
  targetBodyRole: z.literal("primary-enclosure"),
  targetFaceRoles: z.array(z.enum(["rear", "left", "right", "front", "cover", "all"])).min(1).max(6),
  patternFamily: z.enum(["lattice-grid", "radial-rosette", "circle-field", "ring-aperture"]),
  purpose: z.enum([
    "access",
    "illumination",
    "ventilation",
    "ornament",
    "illumination-ventilation",
    "illumination-ornament",
    "ventilation-ornament"
  ]),
  density: z.enum(["sparse", "balanced", "dense"]),
  symmetry: z.enum(["none", "bilateral", "radial", "translational"]),
  repetition: z.enum(["single-face", "matched-faces", "all-eligible-faces"]),
  priority: PrioritySchema
}).strict();

export function semanticAtomCandidateSchemaForEvidenceId(
  evidenceIdSchema: z.ZodType<string>,
) {
  return z.union([
    ...primaryEnclosureAtomSchemas(evidenceIdSchema),
    PartialSupportAtomSchema,
    OpenAccessAtomCandidateSchema,
    RetainedRevoluteCoverAtomSchema,
    CapturedPrismaticCoverAtomSchema,
    ...OrganizationAtomCandidateSchemas,
    QualitativeProportionAtomCandidateSchema,
    ObjectClearanceAtomSchema,
    ObjectScaleAtomSchema,
    RankedGoalAtomSchema,
    SurfaceTreatmentAtomCandidateSchema,
    StructuralApertureAtomCandidateSchema
  ]);
}

export const SemanticAtomCandidateSchema =
  semanticAtomCandidateSchemaForEvidenceId(StableIdSchema);

export type SemanticAtom = z.infer<typeof SemanticAtomCandidateSchema>;
export type SemanticAtomKind = SemanticAtom["kind"];

export const SemanticAtomSchema = SemanticAtomCandidateSchema.superRefine((atom, context) => {
  if (atom.kind === "primary-enclosure" &&
      atom.space.layout === "grid" &&
      atom.space.rows * atom.space.columns < 2) {
    context.addIssue({
      code: "custom",
      message: "A primary-enclosure grid requires at least two total spaces."
    });
  }
  if (atom.kind === "qualitative-proportion" &&
      atom.numeratorAxis === atom.denominatorAxis) {
    context.addIssue({ code: "custom", message: "A qualitative proportion must relate distinct axes." });
  }
  if (atom.kind === "object-scale") {
    for (const range of [atom.long, atom.short, atom.height]) {
      if (range.minimumUm % 10 !== 0 || range.maximumUm % 10 !== 0) {
        context.addIssue({ code: "custom", message: "Semantic atom scale ranges use the registered 0.01 mm increment." });
      }
      if (range.maximumUm < range.minimumUm) {
        context.addIssue({ code: "custom", message: "Scale range maximum must not precede minimum." });
      }
    }
  }
  if (atom.kind === "registered-surface-treatment") {
    for (const values of [atom.primitiveFamilies, atom.preferredOperations, atom.preferredBodyRoles]) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Registered surface-treatment selections must be unique." });
      }
    }
  }
  if (atom.kind === "structural-aperture") {
    if (new Set(atom.targetFaceRoles).size !== atom.targetFaceRoles.length) {
      context.addIssue({ code: "custom", message: "Structural-aperture face roles must be unique." });
    }
  }
  if (atom.kind === "organization" &&
      atom.layout === "grid" &&
      atom.rows * atom.columns < 2) {
    context.addIssue({
      code: "custom",
      message: "Explicit organization requires at least two total spaces."
    });
  }
});

type RegisteredTemplate = {
  version: typeof CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION;
  requiredAspect: "structure" | "surface";
  capabilityIds: readonly string[];
  projectionRecords: readonly string[];
  selectionDescription?: string;
};

export const SEMANTIC_ATOM_TEMPLATES: Readonly<Record<SemanticAtomKind, RegisteredTemplate>> = Object.freeze({
  "primary-enclosure": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["requirement", "body", "object", "access", "organization", "accounting"],
    selectionDescription: "One complete primary-enclosure topology choice with independently prioritized, structure-evidenced enclosure, access, and space subchoices. Access is unspecified, open-top, open-front, covered-top, or covered-front. Space layout is unspecified, explicitly single-space, minimum-separated, an exact count from two through twelve, or an exact registered grid with each axis from one through six except one-by-one. Unspecified access and space use deterministic registered defaults with normalized provenance."
  },
  "partial-support": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["requirement", "body", "object", "accounting"]
  },
  "open-access": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["requirement", "body", "access", "accounting"]
  },
  "retained-revolute-cover": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly", "single-axis-retained-revolute"],
    projectionRecords: ["requirement", "body", "interface", "accounting"],
    selectionDescription: "Requires the complete primary-enclosure atom to select covered-top access."
  },
  "captured-prismatic-cover": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly", "single-axis-captured-prismatic"],
    projectionRecords: ["requirement", "body", "interface", "accounting"],
    selectionDescription: "Requires the complete primary-enclosure atom to select covered-top access."
  },
  organization: {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["requirement", "body", "organization", "accounting"],
    selectionDescription: "Support-body organization only. Primary-enclosure space layout belongs exclusively to the complete primary-enclosure atom."
  },
  "qualitative-proportion": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["body", "proportion", "accounting"]
  },
  "object-clearance": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["object", "clearance", "accounting"]
  },
  "object-scale": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["object", "scale", "accounting"]
  },
  "ranked-goal": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly"],
    projectionRecords: ["goal", "accounting"]
  },
  "registered-surface-treatment": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "surface",
    capabilityIds: ["safe-procedural-surface-treatment"],
    projectionRecords: ["requirement", "motif", "accounting"]
  },
  "structural-aperture": {
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    requiredAspect: "structure",
    capabilityIds: ["rigid-orthogonal-sheet-assembly", "registered-cut-through-treatment"],
    projectionRecords: ["requirement", "body", "cut-through", "accounting"]
  }
});

const registeredCapabilityIds = new Set(CAPABILITY_CATALOG.capabilities.map((item) => item.capabilityId));
for (const template of Object.values(SEMANTIC_ATOM_TEMPLATES)) {
  for (const capabilityId of template.capabilityIds) {
    if (!registeredCapabilityIds.has(capabilityId)) {
      throw new Error(`SEMANTIC_ATOM_TEMPLATE_CAPABILITY_UNREGISTERED:${capabilityId}`);
    }
  }
}

export async function semanticAtomTemplateRegistryHash(): Promise<string> {
  return hashCanonical({
    version: CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
    templates: SEMANTIC_ATOM_TEMPLATES
  });
}

export type SemanticAtomItemResolution =
  | { state: "bound"; atoms: SemanticAtom[] }
  | { state: "deferred"; deferredByEvidenceIds: string[] }
  | {
      state: "unbound" | "uncertain";
      reason: "CAPABILITY_NOT_REGISTERED" | "EVIDENCE_INSUFFICIENT" | "EVIDENCE_CONFLICT" | "PROJECTION_COVERAGE_MISMATCH";
      unsupportedSignatureIds: (
        "kerf-flexure-corner-construction"
      )[];
    };

export type SemanticAtomInventoryItem = SemanticInventoryItem & (
  | { state: "bound"; atoms: SemanticAtom[] }
  | { state: "deferred"; deferredByEvidenceIds: string[] }
  | {
      state: "unbound" | "uncertain";
      reason: "CAPABILITY_NOT_REGISTERED" | "EVIDENCE_INSUFFICIENT" | "EVIDENCE_CONFLICT" | "PROJECTION_COVERAGE_MISMATCH";
      unsupportedSignatureIds: (
        "kerf-flexure-corner-construction"
      )[];
    }
  | { importance: "context"; state?: undefined }
);

type Authority = { inventoryItemIds: string[]; evidenceIds: string[] };
type ItemAccounting = {
  requirementIds: string[];
  bodyIds: string[];
  interfaceIds: string[];
  capabilityIds: string[];
};
type BodyRecord = {
  id: string;
  role: "primary-enclosure" | "support" | "cover";
  shapeClass: "orthogonal-shell" | "planar";
  requirementIds: Set<string>;
  inventoryItemIds: Set<string>;
  evidenceIds: Set<string>;
};
type ObjectRecord = {
  id: string;
  role: "contained" | "supported";
  engagement: "full-envelope" | "partial-support";
  quantity: number | null;
  authority: Authority;
};

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function semanticAtomCoordinate(itemId: string, atomIndex: number, slot: string): string {
  return StableIdSchema.parse(`atom-${itemId}-${String(atomIndex + 1)}-${slot}`);
}

export function semanticAtomRequiredAspect(
  atom: SemanticAtom,
): "structure" | "surface" {
  return atom.kind === "structural-aperture" && atom.purpose !== "access"
    ? "surface"
    : SEMANTIC_ATOM_TEMPLATES[atom.kind].requiredAspect;
}

function authorityForPrimaryChoice(input: {
  item: SemanticAtomInventoryItem;
  slot: "enclosure" | "access" | "space";
  evidenceIds: string[];
}): Authority {
  const authorized = new Set(input.item.evidenceBindings
    .filter((binding) => binding.aspect === "structure")
    .map((binding) => binding.evidenceId));
  if (new Set(input.evidenceIds).size !== input.evidenceIds.length ||
      input.evidenceIds.some((evidenceId) => !authorized.has(evidenceId))) {
    throw new Error(
      `SEMANTIC_ATOM_EVIDENCE_BINDING_UNAUTHORIZED:${input.item.id}:primary-enclosure:${input.slot}`,
    );
  }
  return {
    inventoryItemIds: [input.item.id],
    evidenceIds: unique(input.evidenceIds)
  };
}

function authorityForAtom(item: SemanticAtomInventoryItem, atom: SemanticAtom): Authority {
  if (atom.kind === "primary-enclosure") {
    return authorityForPrimaryChoice({
      item,
      slot: "enclosure",
      evidenceIds: atom.enclosure.evidenceIds
    });
  }
  const aspect = semanticAtomRequiredAspect(atom);
  const evidenceIds = unique(item.evidenceBindings
    .filter((binding) => binding.aspect === aspect)
    .map((binding) => binding.evidenceId));
  if (evidenceIds.length === 0) {
    throw new Error(`SEMANTIC_ATOM_EVIDENCE_ASPECT_MISSING:${item.id}:${atom.kind}:${aspect}`);
  }
  return { inventoryItemIds: [item.id], evidenceIds };
}

function addAccounting(accounting: Map<string, ItemAccounting>, itemId: string, field: keyof ItemAccounting, value: string): void {
  const record = accounting.get(itemId)!;
  record[field].push(value);
}

function mergeAuthority(record: BodyRecord, authority: Authority): void {
  for (const id of authority.inventoryItemIds) record.inventoryItemIds.add(id);
  for (const id of authority.evidenceIds) record.evidenceIds.add(id);
}

function combineAuthorities(authorities: readonly Authority[]): Authority {
  return {
    inventoryItemIds: unique(authorities.flatMap((authority) => authority.inventoryItemIds)),
    evidenceIds: unique(authorities.flatMap((authority) => authority.evidenceIds))
  };
}

export function expandSemanticAtoms(input: {
  inventory: OpenSemanticInventory;
  items: readonly SemanticAtomInventoryItem[];
}): ClosedSemanticProjection {
  const inventory = input.inventory;
  const items = input.items;
  const accounting = new Map<string, ItemAccounting>();
  for (const item of items) {
    if (item.importance !== "context") {
      accounting.set(item.id, { requirementIds: [], bodyIds: [], interfaceIds: [], capabilityIds: [] });
    }
  }

  const requirements: ClosedSemanticProjection["requirements"] = [];
  const bodyByRole = new Map<BodyRecord["role"], BodyRecord>();
  const objects: ObjectRecord[] = [];
  const interfaces: ClosedSemanticProjection["interfaces"] = [];
  const access: ClosedSemanticProjection["access"] = [];
  const organization: ClosedSemanticProjection["organization"] = [];
  const scaleEvidence: ClosedSemanticProjection["scaleEvidence"] = [];
  const proportions: ClosedSemanticProjection["proportions"] = [];
  const clearance: ClosedSemanticProjection["clearance"] = [];
  const rankedGoals: ClosedSemanticProjection["rankedGoals"] = [];
  const cutThrough: ClosedSemanticProjection["cutThrough"] = [];
  let motif: ClosedSemanticProjection["motif"] = null;

  const ensureBody = (input: {
    role: BodyRecord["role"];
    itemId: string;
    atomIndex: number;
    authority: Authority;
    requirementIds: readonly string[];
  }): BodyRecord => {
    let body = bodyByRole.get(input.role);
    if (body === undefined) {
      body = {
        id: semanticAtomCoordinate(input.itemId, input.atomIndex, `body-${input.role}`),
        role: input.role,
        shapeClass: input.role === "primary-enclosure" ? "orthogonal-shell" : "planar",
        requirementIds: new Set(),
        inventoryItemIds: new Set(),
        evidenceIds: new Set()
      };
      bodyByRole.set(input.role, body);
    }
    for (const requirementId of input.requirementIds) body.requirementIds.add(requirementId);
    mergeAuthority(body, input.authority);
    addAccounting(accounting, input.itemId, "bodyIds", body.id);
    return body;
  };

  const addRequirement = (input: {
    item: SemanticAtomInventoryItem;
    atomIndex: number;
    slot: string;
    kind: ClosedSemanticProjection["requirements"][number]["kind"];
    priority: "must" | "prefer";
    authority: Authority;
  }): string => {
    const id = semanticAtomCoordinate(input.item.id, input.atomIndex, `requirement-${input.slot}`);
    requirements.push({ id, priority: input.priority, kind: input.kind, ...input.authority });
    addAccounting(accounting, input.item.id, "requirementIds", id);
    return id;
  };

  const boundAtoms: { item: SemanticAtomInventoryItem; atom: SemanticAtom; atomIndex: number; authority: Authority }[] = [];
  for (const item of items) {
    if (item.importance === "context") {
      if (item.state !== undefined) throw new Error(`SEMANTIC_ATOM_CONTEXT_BINDING_FORBIDDEN:${item.id}`);
      continue;
    }
    if (item.uncertainty.state === "uncertain" && item.state !== "uncertain") {
      throw new Error(`SEMANTIC_ATOM_UNCERTAIN_ITEM_MUST_BE_UNCERTAIN:${item.id}`);
    }
    if (item.state !== "bound") continue;
    if (item.atoms.length === 0) throw new Error(`SEMANTIC_ATOM_BOUND_EMPTY:${item.id}`);
    const seen = new Set<string>();
    for (const [atomIndex, atomValue] of item.atoms.entries()) {
      const atom = SemanticAtomSchema.parse(atomValue);
      const fingerprint = JSON.stringify(atom);
      if (seen.has(fingerprint)) throw new Error(`SEMANTIC_ATOM_DUPLICATE:${item.id}:${atom.kind}`);
      seen.add(fingerprint);
      const authority = authorityForAtom(item, atom);
      for (const capabilityId of SEMANTIC_ATOM_TEMPLATES[atom.kind].capabilityIds) {
        addAccounting(accounting, item.id, "capabilityIds", capabilityId);
      }
      boundAtoms.push({ item, atom, atomIndex, authority });
    }
  }

  const movingAtoms = boundAtoms.filter(({ atom }) =>
    atom.kind === "retained-revolute-cover" || atom.kind === "captured-prismatic-cover"
  );
  if (movingAtoms.length > 1) throw new Error("SEMANTIC_ATOM_INCOMPATIBLE_MULTIPLE_MOVING_COVERS");
  const primaryEnclosureAtoms = boundAtoms.filter(({ atom }) =>
    atom.kind === "primary-enclosure"
  );
  if (primaryEnclosureAtoms.length > 1) {
    throw new Error("SEMANTIC_ATOM_INCOMPATIBLE_MULTIPLE_PRIMARY_ENCLOSURES");
  }
  const requiresPrimaryEnclosure = boundAtoms.some(({ atom }) =>
    atom.kind === "retained-revolute-cover" ||
    atom.kind === "captured-prismatic-cover" ||
    atom.kind === "structural-aperture" ||
    (atom.kind === "qualitative-proportion" && atom.targetBodyRole === "primary-enclosure") ||
    (atom.kind === "object-clearance" && atom.targetObjectRole === "contained") ||
    (atom.kind === "object-scale" && atom.targetObjectRole === "contained") ||
    (atom.kind === "registered-surface-treatment" &&
      atom.preferredBodyRoles.includes("primary-enclosure"))
  );
  if (requiresPrimaryEnclosure && primaryEnclosureAtoms.length !== 1) {
    throw new Error("SEMANTIC_ATOM_PRIMARY_ENCLOSURE_TOPOLOGY_MISSING");
  }
  const primaryEnclosure = primaryEnclosureAtoms[0]?.atom;
  if (movingAtoms.length === 1 &&
      (primaryEnclosure?.kind !== "primary-enclosure" ||
       primaryEnclosure.access.kind !== "covered-top")) {
    throw new Error("SEMANTIC_ATOM_MOVING_COVER_REQUIRES_COVERED_TOP");
  }
  const mandatorySupportAccessKinds = unique(boundAtoms.flatMap(({ atom }) =>
    atom.kind === "open-access" && atom.priority === "must" ? [atom.accessKind] : []
  ));
  if (mandatorySupportAccessKinds.length > 1) {
    throw new Error("SEMANTIC_ATOM_INCOMPATIBLE_REQUIRED_SUPPORT_ACCESS");
  }
  if (boundAtoms.filter(({ atom }) => atom.kind === "registered-surface-treatment").length > 1) {
    throw new Error("SEMANTIC_ATOM_INCOMPATIBLE_MULTIPLE_SURFACE_TREATMENTS");
  }

  const expansionOrder = [
    ...boundAtoms.filter(({ atom }) =>
      atom.kind === "primary-enclosure" || atom.kind === "partial-support"
    ),
    ...boundAtoms.filter(({ atom }) =>
      atom.kind !== "primary-enclosure" && atom.kind !== "partial-support"
    )
  ];
  for (const { item, atom, atomIndex, authority } of expansionOrder) {
    if (atom.kind === "primary-enclosure") {
      const enclosureAuthority = authority;
      const accessAuthority = authorityForPrimaryChoice({
        item,
        slot: "access",
        evidenceIds: atom.access.evidenceIds
      });
      const spaceAuthority = authorityForPrimaryChoice({
        item,
        slot: "space",
        evidenceIds: atom.space.evidenceIds
      });
      const combinedAuthority = combineAuthorities([
        enclosureAuthority,
        accessAuthority,
        spaceAuthority
      ]);
      const containmentId = addRequirement({
        item,
        atomIndex,
        slot: "containment",
        kind: "containment",
        priority: atom.enclosure.priority,
        authority: enclosureAuthority
      });
      const rigidId = addRequirement({
        item,
        atomIndex,
        slot: "rigid-interface",
        kind: "rigid-interface",
        priority: atom.enclosure.priority,
        authority: enclosureAuthority
      });
      const accessId = addRequirement({
        item,
        atomIndex,
        slot: "access",
        kind: "access",
        priority: atom.access.priority,
        authority: accessAuthority
      });
      const closureId = atom.access.kind === "covered-top" ||
          atom.access.kind === "covered-front"
        ? addRequirement({
            item,
            atomIndex,
            slot: "closure",
            kind: "closure",
            priority: atom.access.priority,
            authority: accessAuthority
          })
        : null;
      const organizationId = addRequirement({
        item,
        atomIndex,
        slot: "organization",
        kind: "organization",
        priority: atom.space.priority,
        authority: spaceAuthority
      });
      const body = ensureBody({
        role: "primary-enclosure",
        itemId: item.id,
        atomIndex,
        authority: combinedAuthority,
        requirementIds: [
          containmentId,
          rigidId,
          accessId,
          organizationId,
          ...(closureId === null ? [] : [closureId])
        ]
      });
      objects.push({
        id: semanticAtomCoordinate(item.id, atomIndex, "object-contained"),
        role: "contained",
        engagement: "full-envelope",
        quantity: atom.enclosure.quantity,
        authority: enclosureAuthority
      });
      const accessKind = atom.access.kind === "open-front"
        ? "open-front" as const
        : atom.access.kind === "covered-top" || atom.access.kind === "covered-front"
          ? "covered" as const
          : "open-top" as const;
      const accessDirection = atom.access.kind === "open-front" ||
          atom.access.kind === "covered-front"
        ? "front" as const
        : "top" as const;
      const accessBasis = atom.access.kind === "unspecified"
        ? "default-open-top-policy" as const
        : atom.access.kind === "open-top"
          ? "explicit-open-top" as const
          : atom.access.kind === "open-front"
            ? "explicit-open-front" as const
            : atom.access.kind === "covered-top"
              ? "explicit-covered-top" as const
              : "explicit-covered-front" as const;
      access.push({
        bodyId: body.id,
        kind: accessKind,
        direction: accessDirection,
        basis: accessBasis,
        priority: atom.access.priority,
        requirementId: accessId,
        ...accessAuthority
      });
      const desiredSpaceCount = atom.space.layout === "count"
        ? atom.space.desiredSpaceCount
        : atom.space.layout === "grid"
          ? atom.space.rows * atom.space.columns
          : atom.space.layout === "minimum-separated"
            ? 2
            : 1;
      const organizationBasis = atom.space.layout === "unspecified"
        ? "default-single-space-policy" as const
        : atom.space.layout === "explicit-single-space"
          ? "explicit-single-space" as const
          : atom.space.layout === "count"
            ? "explicit-count" as const
            : atom.space.layout === "grid"
              ? "explicit-grid" as const
              : "minimum-separated-policy" as const;
      organization.push({
        bodyId: body.id,
        desiredSpaceCount,
        rows: atom.space.layout === "grid" ? atom.space.rows : null,
        columns: atom.space.layout === "grid" ? atom.space.columns : null,
        basis: organizationBasis,
        priority: atom.space.priority,
        requirementId: organizationId,
        ...spaceAuthority
      });
      continue;
    }
    if (atom.kind === "partial-support") {
      const supportId = addRequirement({ item, atomIndex, slot: "support", kind: "support", priority: atom.priority, authority });
      const rigidId = addRequirement({ item, atomIndex, slot: "rigid-interface", kind: "rigid-interface", priority: atom.priority, authority });
      ensureBody({ role: "support", itemId: item.id, atomIndex, authority, requirementIds: [supportId, rigidId] });
      objects.push({
        id: semanticAtomCoordinate(item.id, atomIndex, "object-supported"),
        role: "supported",
        engagement: "partial-support",
        quantity: atom.quantity,
        authority
      });
      continue;
    }
    if (atom.kind === "open-access") {
      const requirementId = addRequirement({ item, atomIndex, slot: "access", kind: "access", priority: atom.priority, authority });
      const body = ensureBody({ role: atom.targetBodyRole, itemId: item.id, atomIndex, authority, requirementIds: [requirementId] });
      access.push({
        bodyId: body.id,
        kind: atom.accessKind,
        direction: atom.accessKind === "open-top" ? "top" : "front",
        basis: atom.accessKind === "open-top" ? "explicit-open-top" : "explicit-open-front",
        priority: atom.priority,
        requirementId,
        ...authority
      });
      continue;
    }
    if (atom.kind === "retained-revolute-cover" || atom.kind === "captured-prismatic-cover") {
      const behavior = atom.kind === "retained-revolute-cover" ? "revolute" as const : "prismatic" as const;
      const motionId = addRequirement({
        item,
        atomIndex,
        slot: behavior,
        kind: behavior === "revolute" ? "revolute-interface" : "prismatic-interface",
        priority: atom.priority,
        authority
      });
      const primary = bodyByRole.get("primary-enclosure");
      if (primary === undefined) {
        throw new Error(`SEMANTIC_ATOM_DEPENDENCY_MISSING:${item.id}:${atom.kind}:primary-enclosure`);
      }
      mergeAuthority(primary, authority);
      addAccounting(accounting, item.id, "bodyIds", primary.id);
      const cover = ensureBody({
        role: "cover",
        itemId: item.id,
        atomIndex,
        authority,
        requirementIds: [motionId]
      });
      const interfaceId = semanticAtomCoordinate(item.id, atomIndex, `interface-${behavior}`);
      interfaces.push({
        id: interfaceId,
        betweenBodyIds: [primary.id, cover.id],
        behavior,
        axis: atom.axis,
        requirementIds: [motionId],
        ...authority
      });
      addAccounting(accounting, item.id, "interfaceIds", interfaceId);
      continue;
    }
    if (atom.kind === "organization") {
      const requirementId = addRequirement({ item, atomIndex, slot: "organization", kind: "organization", priority: atom.priority, authority });
      const body = ensureBody({ role: atom.targetBodyRole, itemId: item.id, atomIndex, authority, requirementIds: [requirementId] });
      organization.push({
        bodyId: body.id,
        desiredSpaceCount: atom.layout === "count"
          ? atom.desiredSpaceCount
          : atom.layout === "grid"
            ? atom.rows * atom.columns
            : 2,
        rows: atom.layout === "grid" ? atom.rows : null,
        columns: atom.layout === "grid" ? atom.columns : null,
        basis: atom.layout === "count"
          ? "explicit-count"
          : atom.layout === "grid"
            ? "explicit-grid"
            : "minimum-separated-policy",
        priority: atom.priority,
        requirementId,
        ...authority
      });
      continue;
    }
    if (atom.kind === "qualitative-proportion") {
      const body = bodyByRole.get(atom.targetBodyRole);
      if (body === undefined) throw new Error(`SEMANTIC_ATOM_DEPENDENCY_MISSING:${item.id}:${atom.kind}:${atom.targetBodyRole}`);
      mergeAuthority(body, authority);
      addAccounting(accounting, item.id, "bodyIds", body.id);
      proportions.push({
        id: semanticAtomCoordinate(item.id, atomIndex, "proportion"),
        targetBodyId: body.id,
        numeratorAxis: atom.numeratorAxis,
        denominatorAxis: atom.denominatorAxis,
        strength: atom.strength,
        priority: atom.priority,
        confidence: atom.confidence,
        ...authority
      });
      continue;
    }
    if (atom.kind === "object-clearance" || atom.kind === "object-scale") {
      const matches = objects.filter((object) => object.role === atom.targetObjectRole);
      if (matches.length !== 1) throw new Error(`SEMANTIC_ATOM_OBJECT_DEPENDENCY_INVALID:${item.id}:${atom.kind}:${atom.targetObjectRole}`);
      const object = matches[0]!;
      if (atom.kind === "object-clearance") {
        clearance.push({ objectId: object.id, kind: atom.clearance, priority: atom.priority, ...authority });
      } else {
        scaleEvidence.push({
          id: semanticAtomCoordinate(item.id, atomIndex, "scale"),
          objectId: object.id,
          long: atom.long,
          short: atom.short,
          height: atom.height,
          confidence: atom.confidence,
          basis: "model-prior",
          ...authority
        });
      }
      continue;
    }
    if (atom.kind === "ranked-goal") {
      rankedGoals.push({
        id: semanticAtomCoordinate(item.id, atomIndex, "goal"),
        kind: atom.goal,
        rank: atom.rank,
        ...authority
      });
      continue;
    }
    if (atom.kind === "registered-surface-treatment") {
      const requirementId = addRequirement({ item, atomIndex, slot: "visual-treatment", kind: "visual-treatment", priority: item.importance === "essential" ? "must" : "prefer", authority });
      motif = {
        composition: atom.composition,
        density: atom.density,
        symmetry: atom.symmetry,
        primitiveFamilies: atom.primitiveFamilies,
        preferredOperations: atom.preferredOperations,
        preferredBodyRoles: atom.preferredBodyRoles,
        ...authority
      };
      void requirementId;
      continue;
    }
    const fixedTopAccess = atom.patternFamily === "ring-aperture" &&
      atom.purpose === "access" &&
      atom.targetFaceRoles.includes("cover");
    const primaryBody = bodyByRole.get("primary-enclosure");
    const matchingAccess = fixedTopAccess && primaryBody !== undefined
      ? access.find((candidate) =>
          candidate.bodyId === primaryBody.id &&
          candidate.kind === "covered" &&
          candidate.direction === "top"
        )
      : undefined;
    let requirementId: string;
    let body: BodyRecord;
    if (matchingAccess !== undefined && primaryBody !== undefined) {
      requirementId = matchingAccess.requirementId;
      const requirement = requirements.find((candidate) => candidate.id === requirementId);
      if (requirement?.kind !== "access") {
        throw new Error(`SEMANTIC_ATOM_ACCESS_REQUIREMENT_MISSING:${item.id}:${requirementId}`);
      }
      requirement.priority = requirement.priority === "must" || atom.priority === "must"
        ? "must"
        : "prefer";
      requirement.inventoryItemIds = unique([
        ...requirement.inventoryItemIds,
        ...authority.inventoryItemIds
      ]);
      requirement.evidenceIds = unique([
        ...requirement.evidenceIds,
        ...authority.evidenceIds
      ]);
      matchingAccess.priority = requirement.priority;
      matchingAccess.inventoryItemIds = unique([
        ...matchingAccess.inventoryItemIds,
        ...authority.inventoryItemIds
      ]);
      matchingAccess.evidenceIds = unique([
        ...matchingAccess.evidenceIds,
        ...authority.evidenceIds
      ]);
      body = primaryBody;
      body.requirementIds.add(requirementId);
      mergeAuthority(body, authority);
      addAccounting(accounting, item.id, "requirementIds", requirementId);
      addAccounting(accounting, item.id, "bodyIds", body.id);
    } else {
      requirementId = addRequirement({
        item,
        atomIndex,
        slot: atom.purpose === "access" ? "functional-aperture" : "cut-through-treatment",
        kind: atom.purpose === "access" ? "functional-aperture" : "cut-through-treatment",
        priority: atom.priority,
        authority
      });
      body = ensureBody({
        role: atom.targetBodyRole,
        itemId: item.id,
        atomIndex,
        authority,
        requirementIds: [requirementId]
      });
    }
    cutThrough.push({
      id: semanticAtomCoordinate(item.id, atomIndex, "cut-through"),
      bodyId: body.id,
      targetFaceRoles: atom.targetFaceRoles,
      patternFamily: atom.patternFamily,
      purpose: atom.purpose,
      density: atom.density,
      symmetry: atom.symmetry,
      repetition: atom.repetition,
      fixedTopAccess,
      priority: atom.priority,
      requirementId,
      ...authority
    });
  }

  const normalizedObjects: ClosedSemanticProjection["objects"] = objects.map((object) => ({
    id: object.id,
    role: object.role,
    engagement: object.engagement,
    quantity: object.quantity,
    ...object.authority
  }));
  const constructionBodies: ClosedSemanticProjection["constructionBodies"] = [...bodyByRole.values()].map((body) => ({
    id: body.id,
    role: body.role,
    shapeClass: body.shapeClass,
    requirementIds: unique([...body.requirementIds]),
    inventoryItemIds: unique([...body.inventoryItemIds]),
    evidenceIds: unique([...body.evidenceIds])
  }));
  const normalizedAccounting: ClosedSemanticProjection["accounting"] = [];
  for (const item of items) {
    if (item.importance === "context") continue;
    if (item.state === "bound") {
      const record = accounting.get(item.id)!;
      normalizedAccounting.push({
        itemId: item.id,
        state: "bound" as const,
        requirementIds: unique(record.requirementIds),
        bodyIds: unique(record.bodyIds),
        interfaceIds: unique(record.interfaceIds),
        relationIds: unique(inventory.relationships.flatMap((relationship) =>
          relationship.fromItemId === item.id || relationship.toItemId === item.id ? [relationship.id] : []
        )),
        capabilityIds: unique(record.capabilityIds),
        deferredByEvidenceIds: [],
        unsupportedSignatureIds: [],
        reason: null,
      });
      continue;
    }
    if (item.state === "deferred") {
      normalizedAccounting.push({
        itemId: item.id,
        state: "deferred" as const,
        requirementIds: [], bodyIds: [], interfaceIds: [], relationIds: [], capabilityIds: [],
        deferredByEvidenceIds: unique(item.deferredByEvidenceIds),
        unsupportedSignatureIds: [],
        reason: "REFERENCE_ROLE_DEFERRED" as const,
      });
      continue;
    }
    normalizedAccounting.push({
      itemId: item.id,
      state: item.state,
      requirementIds: [], bodyIds: [], interfaceIds: [], relationIds: [], capabilityIds: [],
      deferredByEvidenceIds: [],
      unsupportedSignatureIds: item.unsupportedSignatureIds,
      reason: item.reason
    });
  }

  for (const record of normalizedAccounting) {
    if (record.state === "bound" && (
      record.requirementIds.length + record.bodyIds.length + record.interfaceIds.length +
      record.relationIds.length + record.capabilityIds.length === 0
    )) {
      throw new Error(`SEMANTIC_ATOM_ACCOUNTING_EMPTY:${record.itemId}`);
    }
  }
  return ClosedSemanticProjectionSchema.parse({
    requirements,
    constructionBodies,
    objects: normalizedObjects,
    interfaces,
    access,
    organization,
    scaleEvidence,
    proportions,
    clearance,
    rankedGoals,
    motif,
    cutThrough,
    accounting: normalizedAccounting
  });
}

export function semanticAtomKinds(): readonly SemanticAtomKind[] {
  return Object.freeze(Object.keys(SEMANTIC_ATOM_TEMPLATES) as SemanticAtomKind[]);
}
