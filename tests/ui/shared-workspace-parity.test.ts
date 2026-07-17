import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { IntentGraphV1Schema } from "../../src/interpretation/intent-graph.js";
import { mapIntentGraph } from "../../src/interpretation/mapper.js";
import { normalizeSemanticGenerationRequest } from "../../src/interpretation/semantic-request.js";
import {
  DEFAULT_GENERATED_CONTROLS,
  compileGeneratedProject
} from "../../src/ui/content/generated-projects.js";
import {
  DEFAULT_GUIDED_EXAMPLE,
  buildGuidedProductCompileRequest
} from "../../src/ui/content/guided-examples.js";
import { compileProductRequest } from "../../src/workers/compile-service.js";

function withoutSourceHashes(candidate: unknown): unknown {
  if (Array.isArray(candidate)) return candidate.map(withoutSourceHashes);
  if (typeof candidate !== "object" || candidate === null) return candidate;
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([key]) => key !== "sourceDocumentHash")
      .map(([key, value]) => [key, withoutSourceHashes(value)]),
  );
}

function rigidIntent() {
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title: "Basic glue-free box",
    coreIntent: "Build a rigid orthogonal sheet container.",
    requirements: [{
      id: "rigid-assembly",
      priority: "must",
      kind: "rigid-assembly",
      statement: "The assembled support must remain rigid.",
      evidence: [{
        evidenceId: "brief-rigid",
        source: "text",
        referenceId: null,
        statement: "The brief explicitly requires a rigid assembly."
      }]
    }],
    references: [{
      referenceId: "reference-one",
      inferredRoles: ["structure"],
      structuralObservations: [{
        evidenceId: "reference-structure",
        source: "reference",
        referenceId: "reference-one",
        statement: "The reference shows an orthogonal container."
      }],
      motifObservations: [],
      confidence: "high"
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
          id: "wall-shell",
          role: "enclosure",
          quantity: 1,
          shapeClass: "shell",
          attachmentRole: "side",
          orientationRole: "vertical"
        }
      ],
      interfaces: [{
        id: "rigid-interface",
        between: ["base-body", "wall-shell"],
        behavior: "rigid",
        relativeOrientation: "orthogonal",
        axisRole: "unspecified",
        function: "Join the support and wall shell."
      }]
    },
    motif: null,
    conflicts: [],
    assumptions: [],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

describe("route-neutral canonical workspace parity", () => {
  it("keeps example and generated rigid geometry, IDs, projections, build data, validation, and export gates in parity", async () => {
    const setup = resolveFabricationSetup(createPublicFabricationSetup());
    const profiles = {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    };
    const guided = await compileProductRequest(buildGuidedProductCompileRequest(
      DEFAULT_GUIDED_EXAMPLE,
      {
        requestId: "shared-workspace-guided",
        presetId: "medium",
        profiles,
        inputPolicyEvaluation: setup.inputPolicyEvaluation,
        retainedPin: createStarterPinSetup()
      },
    ));
    const intent = rigidIntent();
    const mapping = await mapIntentGraph(intent);
    if (mapping.kind === "concept-only") throw new Error("Expected the rigid intent to map.");
    const generated = await compileGeneratedProject({
      requestId: "shared-workspace-generated",
      semanticRequest: normalizeSemanticGenerationRequest({
        brief: "Build a rigid orthogonal sheet container.",
        references: [{
          referenceId: "reference-one",
          sha256: "a".repeat(64),
          mediaType: "image/png",
          width: 640,
          height: 480
        }],
        roleConstraints: [{ referenceId: "reference-one", roles: ["structure"] }],
        modelConfiguration: {
          modelId: "m5-replay-fixture@1.0.0",
          reasoningEffort: "low",
          maxOutputTokens: 4_000,
          serviceTier: "default",
          store: false
        }
      }),
      intent,
      mapping,
      profiles,
      inputPolicyEvaluation: setup.inputPolicyEvaluation,
      pin: createStarterPinSetup(),
      controls: DEFAULT_GENERATED_CONTROLS,
      cacheResult: "miss",
      runtimeApplicationApiCalls: 0
    });

    expect(generated.geometryHash).toBe(guided.geometryHash);
    expect(generated.document.parts.map((part) => part.id)).toEqual(
      guided.document.parts.map((part) => part.id),
    );
    expect(generated.document.joints).toEqual(guided.document.joints);
    expect(generated.document.motionConstraints).toEqual(guided.document.motionConstraints);
    expect(generated.document.assemblyPlan).toEqual(guided.document.assemblyPlan);
    expect(generated.document.validation).toEqual(guided.document.validation);
    expect(withoutSourceHashes(generated.bundle)).toEqual(withoutSourceHashes(guided.bundle));
    expect(generated.bundle.fabrication.sheets.map((sheet) => sheet.placements)).toEqual(
      guided.bundle.fabrication.sheets.map((sheet) => sheet.placements),
    );
    expect(generated.bundle.bom).toBeDefined();
    expect(generated.bundle.legend).toBeDefined();
    expect(generated.bundle.instructions).toBeDefined();
    expect(generated.document.validation.status).toBe("pass");
    expect(generated.svgs.length).toBe(guided.svgs.length);
  });

  it("imports the same workspace component without an origin or layout-mode branch", async () => {
    const [guidedSource, generatedSource, workspaceSource] = await Promise.all([
      readFile(path.resolve("src/ui/components/guided-examples-controller.tsx"), "utf8"),
      readFile(path.resolve("src/ui/components/generated-project-controller.tsx"), "utf8"),
      readFile(path.resolve("src/ui/components/canonical-project-workspace.tsx"), "utf8")
    ]);
    expect(guidedSource).toContain("CanonicalProjectWorkspace");
    expect(generatedSource).toContain("CanonicalProjectWorkspace");
    expect(workspaceSource).not.toMatch(/layoutMode|originRoute|generatedMode|exampleMode/);
  });
});
