import type { IntentGraphV1, ReferenceRole } from "./intent-graph.js";
import { IntentGraphV1Schema } from "./intent-graph.js";
import type { SemanticGenerationRequestV1 } from "./semantic-request.js";

export type FixtureScenario = {
  id: string;
  brief: string;
  behavior: "rigid" | "revolute" | "prismatic";
  expectedOutcome: "supported" | "simplified" | "concept-only" | "schema-failure";
  defaultRoles: readonly ReferenceRole[];
  motif: null | {
    composition: "border" | "field" | "focal" | "repeated";
    density: "sparse" | "balanced" | "dense";
    symmetry: "none" | "bilateral" | "radial" | "translational";
    primitiveFamilies: readonly (
      | "parallel-line-field"
      | "inset-score-frame"
      | "corner-score-ticks"
      | "filled-dot-repeat"
      | "filled-diamond-focal"
    )[];
  };
  missingScale?: true;
  conflict?: true;
  preferredUnsupported?: true;
  requiredUnsupported?: true;
};

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = Object.freeze([
  {
    id: "rigid-structure",
    brief: "Make a small rigid container using the reference for structure.",
    behavior: "rigid",
    expectedOutcome: "supported",
    defaultRoles: ["structure"],
    motif: null
  },
  {
    id: "revolute-proof",
    brief: "Make a container with one retained hinged cover.",
    behavior: "revolute",
    expectedOutcome: "supported",
    defaultRoles: ["structure"],
    motif: null
  },
  {
    id: "prismatic-proof",
    brief: "Make a container with one captured sliding cover.",
    behavior: "prismatic",
    expectedOutcome: "supported",
    defaultRoles: ["structure"],
    motif: null
  },
  {
    id: "missing-scale",
    brief: "Make this rigid reference as a useful desktop container; no dimensions are shown.",
    behavior: "rigid",
    expectedOutcome: "supported",
    defaultRoles: ["structure"],
    motif: null,
    missingScale: true
  },
  {
    id: "text-image-conflict",
    brief: "Make a rigid container; the reference shape is useful but its moving wheel is not.",
    behavior: "rigid",
    expectedOutcome: "supported",
    defaultRoles: ["structure"],
    motif: null,
    conflict: true
  },
  {
    id: "motif-role",
    brief: "Use the reference only for a sparse bilateral score border on a rigid container.",
    behavior: "rigid",
    expectedOutcome: "supported",
    defaultRoles: ["motif"],
    motif: {
      composition: "border",
      density: "sparse",
      symmetry: "bilateral",
      primitiveFamilies: ["inset-score-frame", "corner-score-ticks"]
    }
  },
  {
    id: "both-role",
    brief: "Use the reference for a hinged structure and a dense repeated dot treatment.",
    behavior: "revolute",
    expectedOutcome: "supported",
    defaultRoles: ["structure", "motif"],
    motif: {
      composition: "repeated",
      density: "dense",
      symmetry: "translational",
      primitiveFamilies: ["filled-dot-repeat"]
    }
  },
  {
    id: "focal-motif",
    brief: "Make a rigid container with one balanced radial diamond focal treatment.",
    behavior: "rigid",
    expectedOutcome: "supported",
    defaultRoles: ["motif"],
    motif: {
      composition: "focal",
      density: "balanced",
      symmetry: "radial",
      primitiveFamilies: ["filled-diamond-focal"]
    }
  },
  {
    id: "allowed-simplification",
    brief: "Make a rigid container; a sculpted oval silhouette is preferred but not essential.",
    behavior: "rigid",
    expectedOutcome: "simplified",
    defaultRoles: ["structure"],
    motif: null,
    preferredUnsupported: true
  },
  {
    id: "unsupported-core",
    brief: "Make a required compound-motion automaton with two independently moving panels.",
    behavior: "rigid",
    expectedOutcome: "concept-only",
    defaultRoles: ["structure"],
    motif: null,
    requiredUnsupported: true
  },
  {
    id: "invalid-output",
    brief: "Interpret an intentionally invalid structured fixture.",
    behavior: "rigid",
    expectedOutcome: "schema-failure",
    defaultRoles: ["structure"],
    motif: null
  }
]);

export function findFixtureScenario(brief: string): FixtureScenario | null {
  return FIXTURE_SCENARIOS.find((scenario) => scenario.brief === brief) ?? null;
}

function constrainedRoles(
  request: SemanticGenerationRequestV1,
  referenceId: string,
  defaults: readonly ReferenceRole[],
): ReferenceRole[] {
  const constraint = request.roleConstraints.find((item) => item.referenceId === referenceId);
  return [...(constraint?.roles ?? defaults)];
}

export function buildFixtureIntent(
  request: SemanticGenerationRequestV1,
  scenario: FixtureScenario,
): unknown {
  if (scenario.expectedOutcome === "schema-failure") {
    return { schemaVersion: "1.0", title: "Invalid fixture output", unknownField: true };
  }
  const moving = scenario.behavior === "rigid" ? [] : [{
    id: "moving-panel-body",
    role: "moving-panel" as const,
    quantity: 1,
    shapeClass: "planar" as const,
    attachmentRole: "top" as const,
    orientationRole: "horizontal" as const
  }];
  const references = request.references.map((reference, index) => {
    const roles = constrainedRoles(request, reference.referenceId, scenario.defaultRoles);
    return {
      referenceId: reference.referenceId,
      inferredRoles: roles,
      structuralObservations: roles.includes("structure") ? [{
        evidenceId: `reference-${String(index + 1)}-structure`,
        source: "reference" as const,
        referenceId: reference.referenceId,
        statement: scenario.conflict
          ? "The reference includes a moving circular element that the brief explicitly rejects."
          : "The reference suggests planar connected support surfaces."
      }] : [],
      motifObservations: roles.includes("motif") ? [{
        evidenceId: `reference-${String(index + 1)}-motif`,
        source: "reference" as const,
        referenceId: reference.referenceId,
        statement: "The reference suggests a bounded geometric surface rhythm."
      }] : [],
      confidence: "medium" as const
    };
  });
  const requirements = [
    {
      id: "rigid-support-requirement",
      priority: "must" as const,
      kind: "rigid-assembly" as const,
      statement: "The support assembly must remain rigid.",
      evidence: [{
        evidenceId: "brief-rigid-evidence",
        source: "text" as const,
        referenceId: null,
        statement: "The maker asks for a buildable rigid support."
      }]
    },
    ...(scenario.behavior === "rigid" ? [] : [{
      id: "motion-requirement",
      priority: "must" as const,
      kind: scenario.behavior === "revolute"
        ? "revolute-motion" as const
        : "prismatic-motion" as const,
      statement: `One panel must provide ${scenario.behavior} motion.`,
      evidence: [{
        evidenceId: "brief-motion-evidence",
        source: "text" as const,
        referenceId: null,
        statement: "The brief explicitly requests one moving panel."
      }]
    }]),
    ...(scenario.motif === null ? [] : [{
      id: "visual-treatment-requirement",
      priority: "must" as const,
      kind: "visual-treatment" as const,
      statement: "Apply a visible non-cut-through geometric surface treatment.",
      evidence: [{
        evidenceId: "brief-treatment-evidence",
        source: "text" as const,
        referenceId: null,
        statement: "The brief asks for a visible reference-inspired treatment."
      }]
    }]),
    ...(scenario.preferredUnsupported ? [{
      id: "preferred-profile-requirement",
      priority: "prefer" as const,
      kind: "specific-profile" as const,
      statement: "A sculpted oval silhouette is preferred but is not part of the core function.",
      evidence: [{
        evidenceId: "brief-preferred-profile-evidence",
        source: "text" as const,
        referenceId: null,
        statement: "The brief marks the curved silhouette as optional."
      }]
    }] : []),
    ...(scenario.requiredUnsupported ? [{
      id: "required-compound-motion",
      priority: "must" as const,
      kind: "compound-motion" as const,
      statement: "Two independently moving panels are essential to the requested automaton.",
      evidence: [{
        evidenceId: "brief-compound-motion-evidence",
        source: "text" as const,
        referenceId: null,
        statement: "The brief makes compound motion essential."
      }]
    }] : [])
  ];
  const intent: IntentGraphV1 = {
    schemaVersion: "1.0",
    title: scenario.behavior === "rigid"
      ? "Reference-inspired rigid object"
      : "Reference-inspired moving-panel object",
    coreIntent: scenario.brief,
    requirements,
    references,
    topology: {
      bodies: [
        {
          id: "support-base-body",
          role: "support",
          quantity: 1,
          shapeClass: "planar",
          attachmentRole: "base",
          orientationRole: "horizontal"
        },
        {
          id: "enclosure-shell-body",
          role: "enclosure",
          quantity: 1,
          shapeClass: "shell",
          attachmentRole: "side",
          orientationRole: "vertical"
        },
        ...moving
      ],
      interfaces: [
        {
          id: "rigid-support-interface",
          between: ["support-base-body", "enclosure-shell-body"],
          behavior: "rigid",
          relativeOrientation: "orthogonal",
          axisRole: "unspecified",
          function: "Connect the rigid support surfaces."
        },
        ...(scenario.behavior === "rigid" ? [] : [{
          id: "moving-panel-interface",
          between: ["enclosure-shell-body", "moving-panel-body"] as [string, string],
          behavior: scenario.behavior,
          relativeOrientation: scenario.behavior === "revolute"
            ? "coaxial" as const
            : "parallel" as const,
          axisRole: scenario.behavior === "revolute" ? "width" as const : "depth" as const,
          function: "Provide the requested single-axis panel movement."
        }])
      ]
    },
    motif: scenario.motif === null ? null : {
      vocabulary: ["geometric", "reference rhythm"],
      composition: scenario.motif.composition,
      density: scenario.motif.density,
      symmetry: scenario.motif.symmetry,
      primitiveFamilies: [...scenario.motif.primitiveFamilies],
      preferredOperations: scenario.motif.primitiveFamilies.some((item) => item.startsWith("filled-"))
        ? ["engrave"]
        : ["score"],
      preferredPartRoles: ["enclosure", "moving-panel"]
    },
    conflicts: scenario.conflict && references[0]?.structuralObservations[0] !== undefined
      ? [{
          textEvidenceId: "brief-rigid-evidence",
          imageEvidenceId: references[0].structuralObservations[0].evidenceId,
          resolution: "text-wins"
        }]
      : [],
    assumptions: scenario.missingScale ? [{
      id: "registered-scale-preset-assumption",
      statement: "No reliable scale was supplied; apply the disclosed working-size preset.",
      source: "preset"
    }] : [],
    capabilityAssessment: {
      coreIntentRepresentable: !scenario.requiredUnsupported,
      unresolvedNeeds: scenario.requiredUnsupported
        ? ["The registered graph does not support essential compound motion."]
        : []
    }
  };
  return IntentGraphV1Schema.parse(intent);
}
