import { describe, expect, it, vi } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "../../src/interpretation/intent-graph.js";
import { mapIntentGraph } from "../../src/interpretation/mapper.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import {
  DEFAULT_GENERATED_CONTROLS,
  compileGeneratedProject
} from "../../src/ui/content/generated-projects.js";

function intent(
  behavior: "rigid" | "revolute" | "prismatic",
  withMotif = false,
): IntentGraphV1 {
  const moving = behavior === "rigid" ? [] : [{
    id: "moving-body",
    role: "moving-panel" as const,
    quantity: 1,
    shapeClass: "planar" as const,
    attachmentRole: "top" as const,
    orientationRole: "horizontal" as const
  }];
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title: "Reference-inspired container",
    coreIntent: behavior === "rigid"
      ? "Make a rigid orthogonal sheet container."
      : `Make a container with one ${behavior} moving panel.`,
    requirements: [
      {
        id: "rigid-function",
        priority: "must",
        kind: "rigid-assembly",
        statement: "The support assembly must remain rigid.",
        evidence: [{
          evidenceId: "brief-rigid",
          source: "text",
          referenceId: null,
          statement: "The brief requires a rigid support."
        }]
      },
      ...(behavior === "rigid" ? [] : [{
        id: "motion-function",
        priority: "must" as const,
        kind: behavior === "revolute" ? "revolute-motion" as const : "prismatic-motion" as const,
        statement: `The moving panel must use ${behavior} motion.`,
        evidence: [{
          evidenceId: "brief-motion",
          source: "text" as const,
          referenceId: null,
          statement: "The brief explicitly requires one moving panel."
        }]
      }]),
      ...(withMotif ? [{
        id: "visual-treatment",
        priority: "must" as const,
        kind: "visual-treatment" as const,
        statement: "Apply a visible geometric treatment without cutting through.",
        evidence: [{
          evidenceId: "reference-motif",
          source: "reference" as const,
          referenceId: "reference-one",
          statement: "The reference shows a repeated geometric surface rhythm."
        }]
      }] : [])
    ],
    references: [{
      referenceId: "reference-one",
      inferredRoles: withMotif ? ["structure", "motif"] : ["structure"],
      structuralObservations: [{
        evidenceId: "reference-structure",
        source: "reference",
        referenceId: "reference-one",
        statement: "The reference shows planar orthogonal support surfaces."
      }],
      motifObservations: withMotif ? [{
        evidenceId: "reference-motif-observation",
        source: "reference",
        referenceId: "reference-one",
        statement: "A repeated dot rhythm is visible."
      }] : [],
      confidence: "medium"
    }],
    topology: {
      bodies: [
        {
          id: "base-body",
          role: "support",
          quantity: 1,
          shapeClass: "planar",
          attachmentRole: "base",
          orientationRole: "horizontal"
        },
        {
          id: "wall-body",
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
          id: "support-interface",
          between: ["base-body", "wall-body"],
          behavior: "rigid",
          relativeOrientation: "orthogonal",
          axisRole: "unspecified",
          function: "Retain the support shell."
        },
        ...(behavior === "rigid" ? [] : [{
          id: "moving-interface",
          between: ["wall-body", "moving-body"] as [string, string],
          behavior,
          relativeOrientation: behavior === "revolute" ? "coaxial" as const : "parallel" as const,
          axisRole: behavior === "revolute" ? "width" as const : "depth" as const,
          function: "Provide the requested single-axis movement."
        }])
      ]
    },
    motif: withMotif ? {
      vocabulary: ["dots", "rhythm"],
      composition: "repeated",
      density: "balanced",
      symmetry: "translational",
      primitiveFamilies: ["filled-dot-repeat"],
      preferredOperations: ["engrave"],
      preferredPartRoles: ["enclosure", "moving-panel"]
    } : null,
    conflicts: [],
    assumptions: [],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

const semanticRequest = normalizeSemanticGenerationRequest({
  brief: "Build a reference-inspired container.",
  references: [{
    referenceId: "reference-one",
    sha256: "a".repeat(64),
    mediaType: "image/png",
    width: 900,
    height: 600
  }],
  roleConstraints: [],
  modelConfiguration: {
    modelId: "candidate-model",
    reasoningEffort: "low",
    maxOutputTokens: 4_000,
    serviceTier: "default",
    store: false
  }
});

async function compile(behavior: "rigid" | "revolute" | "prismatic", withMotif = false) {
  const interpreted = intent(behavior, withMotif);
  const mapping = await mapIntentGraph(interpreted);
  if (mapping.kind === "concept-only") throw new Error("Expected fabrication mapping.");
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  return compileGeneratedProject({
    requestId: `generated-${behavior}`,
    semanticRequest,
    intent: interpreted,
    mapping,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup(),
    controls: DEFAULT_GENERATED_CONTROLS,
    cacheResult: "miss"
  });
}

describe("deterministic generated-project compilation", () => {
  it("maps and compiles rigid, revolute, and prismatic replay semantics through registered graphs", async () => {
    const [rigid, revolute, prismatic] = await Promise.all([
      compile("rigid"),
      compile("revolute"),
      compile("prismatic")
    ]);
    expect(rigid.document.motionConstraints.every((item) => item.kind === "fixed")).toBe(true);
    expect(revolute.document.motionConstraints.some((item) => item.kind === "revolute")).toBe(true);
    expect(prismatic.document.motionConstraints.some((item) => item.kind === "prismatic")).toBe(true);
    for (const project of [rigid, revolute, prismatic]) {
      expect(project.document.validation.status).toBe("pass");
      expect(project.document.provenance.runtimeApplicationApiCalls).toBe(1);
      expect(project.document.provenance.requirementEvidence?.length).toBeGreaterThan(0);
      expect(project.bundle.fabrication.sheets.length).toBeGreaterThan(0);
      expect(project.svgs).toHaveLength(project.bundle.fabrication.sheets.length);
    }
  });

  it("carries a material reference motif into closed Engrave geometry and import complexity", async () => {
    const project = await compile("rigid", true);
    expect(project.motifReport?.status).toBe("applied");
    expect(project.motifReport?.engraveFeatureCount).toBeGreaterThan(0);
    expect(project.document.operatorProgram.at(-1)).toMatchObject({
      operatorId: "procedural-surface-treatment",
      operatorVersion: "1.0.0"
    });
    const engravePaths = project.bundle.fabrication.sheets.flatMap((sheet) =>
      sheet.paths.filter((path) => path.operation === "engrave")
    );
    expect(engravePaths.length).toBeGreaterThan(0);
    expect(engravePaths.every((path) => path.closed)).toBe(true);
    expect(project.document.provenance.motifRecipeHash).toBe(project.motifReport?.recipeHash);
  });

  it("applies dimensions and motif placement locally without a model-network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const interpreted = intent("rigid", true);
    const mapping = await mapIntentGraph(interpreted);
    if (mapping.kind === "concept-only") throw new Error("Expected fabrication mapping.");
    const setup = resolveFabricationSetup(createPublicFabricationSetup());
    const common = {
      semanticRequest,
      intent: interpreted,
      mapping,
      profiles: {
        material: setup.material,
        machine: setup.machine,
        processRecipe: setup.processRecipe,
        fabricationContext: setup.fabricationContext,
        fit: setup.fit
      },
      inputPolicyEvaluation: setup.inputPolicyEvaluation,
      pin: createStarterPinSetup(),
      cacheResult: "hit" as const
    };
    const baseline = await compileGeneratedProject({
      ...common,
      requestId: "local-baseline",
      controls: DEFAULT_GENERATED_CONTROLS
    });
    const edited = await compileGeneratedProject({
      ...common,
      requestId: "local-edited",
      controls: {
        ...DEFAULT_GENERATED_CONTROLS,
        dimensionsMm: { width: 130, depth: 96, height: 62 },
        scaleSource: "user-specified",
        motifPlacement: {
          ...DEFAULT_GENERATED_CONTROLS.motifPlacement,
          offsetXPermille: 100
        }
      }
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(edited.geometryHash).not.toBe(baseline.geometryHash);
    expect(edited.document.provenance.runtimeApplicationApiCalls).toBe(0);
    expect(edited.scaleDisclosure).toBeNull();
    fetchSpy.mockRestore();
  });
});
