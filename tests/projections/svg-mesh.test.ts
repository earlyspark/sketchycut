import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

import type {
  DesignDocumentV1,
  SheetPart,
  SheetPlacement
} from "../../src/domain/contracts.js";
import { hashCanonical } from "../../src/domain/hash.js";
import { buildProjectionBundle } from "../../src/projections/bundle.js";
import { renderSceneSvg } from "../../src/projections/mesh/render-svg.js";
import { validateParts } from "../../src/validation/geometry.js";

const zeroHash = "0".repeat(64);

function fixturePart(): SheetPart {
  return {
    schemaVersion: "1.0",
    id: "mesh-panel",
    name: "Mesh panel",
    role: "generic-panel",
    materialProfileId: "material",
    thicknessUm: 3_000,
    grainVector: { x: 1, y: 0 },
    nominalRegion: {
      outer: {
        id: "mesh-panel-outer",
        closed: true,
        points: [
          { xUm: 0, yUm: 0 },
          { xUm: 30_000, yUm: 0 },
          { xUm: 30_000, yUm: 20_000 },
          { xUm: 0, yUm: 20_000 }
        ]
      },
      holes: [
        {
          id: "mesh-panel-hole",
          closed: true,
          points: [
            { xUm: 10_000, yUm: 5_000 },
            { xUm: 10_000, yUm: 15_000 },
            { xUm: 20_000, yUm: 15_000 },
            { xUm: 20_000, yUm: 5_000 }
          ]
        }
      ]
    },
    features: [
      {
        id: "mesh-panel-boundary",
        kind: "outer-boundary",
        operation: "cut",
        fitClass: null,
        jointId: null,
        region: {
          outer: {
            id: "mesh-panel-outer",
            closed: true,
            points: [
              { xUm: 0, yUm: 0 },
              { xUm: 30_000, yUm: 0 },
              { xUm: 30_000, yUm: 20_000 },
              { xUm: 0, yUm: 20_000 }
            ]
          },
          holes: []
        },
        path: null,
        parametersUm: {}
      },
      {
        id: "mesh-panel-score",
        kind: "score-label",
        operation: "score",
        fitClass: null,
        jointId: null,
        region: null,
        path: {
          id: "mesh-panel-score-path",
          closed: false,
          points: [
            { xUm: 2_000, yUm: 2_000 },
            { xUm: 8_000, yUm: 2_000 }
          ]
        },
        parametersUm: {}
      }
    ],
    assembledFrame: {
      origin: { xUm: 5_000, yUm: 7_000, zUm: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: { xUm: 0, yUm: 0, zUm: 25_000 },
    assemblyDependencyPartIds: [],
    sourceOperator: { id: "fixture-operator", version: "1.0.0" }
  };
}

async function fixtureDocument(): Promise<DesignDocumentV1> {
  const part = fixturePart();
  return {
    schemaVersion: "1.0",
    projectId: "projection-fixture",
    request: {
      schemaVersion: "1.0",
      requestId: "projection-request",
      title: "Projection fixture",
      description: "Exercise linked M1 projections.",
      units: "mm",
      envelopeMm: { x: 30, y: 20, z: 3 },
      materialProfileId: "material",
      machineProfileId: "machine",
      fitProfileId: "fit",
      referenceIds: []
    },
    intent: {
      schemaVersion: "1.0",
      fixtureId: "projection-intent",
      title: "Projection fixture",
      coreIntent: "Exercise exact linked projections.",
      requirements: [
        {
          id: "linked-projections",
          priority: "must",
          statement: "Every projection shares one source.",
          evidence: [
            {
              evidenceId: "fixture-evidence",
              source: "text",
              referenceId: null,
              statement: "M1 fixture."
            }
          ]
        }
      ],
      topology: {
        bodies: [{ id: "mesh-panel", role: "support", quantity: 1, shapeClass: "planar" }],
        interfaces: []
      },
      assumptions: [],
      capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
    },
    resolvedInputs: {
      material: {
        schemaVersion: "1.0",
        id: "material",
        name: "Material",
        materialKind: "basswood-plywood",
        nominalThicknessMm: 3,
        measuredThicknessMm: 3,
        batchId: null,
        grainAxis: "x",
        physicalState: "provisional-preset"
      },
      machine: {
        schemaVersion: "1.0",
        id: "machine",
        name: "Machine",
        manufacturer: "xTool",
        model: "M2",
        module: "20W blue-light laser",
        processingMode: "flat-surface-lasering",
        processingEnvelopeMm: { width: 100, height: 80 },
        minimumFeatureMm: 0.5,
        exportFormat: "svg",
        downstreamApplication: "xTool Studio",
        minimumStudioDesktopVersion: "1.7.30",
        confidence: "vendor-documented-target"
      },
      processRecipe: {
        schemaVersion: "1.0",
        id: "process-unrecorded-k150-150",
        machineProfileId: "machine",
        materialProfileId: "material",
        materialBatchOrSheetId: null,
        processingMode: "flat-surface-lasering",
        studioDesktopVersion: null,
        firmwareVersion: null,
        materialPresetSource: null,
        powerPercent: null,
        speedMmPerSecond: null,
        passCount: null,
        focusMode: null,
        focusDescentMm: null,
        builtInAirPump: null,
        exhaustArrangement: null,
        sheetOrientation: null,
        supportArrangement: null,
        studioKerfOffsetMm: null,
        cutWidth: { xMm: 0.15, yMm: 0.15, semantics: "full-cut-width", source: "provisional-preset", recipeHash: null },
        recipeHash: null,
        evidenceStatus: "unrecorded"
      },
      fabricationContext: {
        stockFootprint: null,
        layoutPolicy: {
          id: "compact-compensated-bounds",
          version: "1.0.0",
          symmetricPaddingMm: 5,
          interPartSpacingMm: 2,
          purpose: "project-layout-padding-not-fixture-clearance"
        },
        placementConstraints: {
          mode: "manual-framing-required",
          fixtureKeepoutsModeled: false,
          magneticFixtureClearanceMm: 5,
          magneticFixtureClearanceSource: "manual-handoff-check"
        }
      },
      fit: {
        schemaVersion: "1.0",
        id: "fit",
        name: "Fit",
        deltaSemantics: "opening-size-minus-insert-size",
        press: { totalDeltaMm: -0.05, confidence: "provisional" },
        snug: { totalDeltaMm: 0, confidence: "provisional" },
        sliding: { totalDeltaMm: 0.2, confidence: "provisional" },
        rotating: { totalDeltaMm: 0.25, confidence: "provisional" },
        rod: { totalDeltaMm: 0.15, confidence: "provisional" }
      },
      hardwarePolicy: { glueAllowed: false, permittedKinds: ["sheet-part"] }
    },
    operatorProgram: [
      {
        operatorId: "fixture-operator",
        operatorVersion: "1.0.0",
        parameterHash: await hashCanonical({ fixture: true })
      }
    ],
    parts: [part],
    joints: [],
    motionConstraints: [
      {
        schemaVersion: "1.0",
        id: "fixed",
        kind: "fixed",
        bodyPartIds: ["mesh-panel"],
        axis: { origin: { xUm: 0, yUm: 0, zUm: 0 }, direction: { x: 0, y: 0, z: 1 } },
        range: { minimum: 0, maximum: 0, unit: "mm" }
      }
    ],
    assemblyPlan: [
      {
        schemaVersion: "1.0",
        id: "verify",
        order: 0,
        action: "verify",
        partIds: ["mesh-panel"],
        jointIds: [],
        direction: null,
        dependsOnActionIds: [],
        instructionKey: "verify"
      }
    ],
    validation: validateParts([part]),
    provenance: {
      inputDigest: zeroHash,
      modelId: null,
      promptVersion: null,
      operatorVersions: { "fixture-operator": "1.0.0" },
      deterministicSeed: "projection-fixture",
      runtimeApplicationApiCalls: 0
    }
  };
}

describe("SVG, mesh, scene, and BOM projection", () => {
  it("serializes millimetre SVG with stable operation/part IDs and parser round-trip scale", async () => {
    const placement: SheetPlacement = {
      id: "mesh-panel-placement",
      partId: "mesh-panel",
      xUm: 5_000,
      yUm: 5_000,
      rotationDegrees: 0
    };
    const { bundle, svg } = await buildProjectionBundle(await fixtureDocument(), [placement]);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parsed.documentElement!;

    expect(root.getAttribute("width")).toBe("40.15mm");
    expect(root.getAttribute("height")).toBe("30.15mm");
    expect(root.getAttribute("viewBox")).toBe("0 0 40.15 30.15");
    expect(parsed.getElementById("operation-cut")).not.toBeNull();
    expect(parsed.getElementById("operation-score--part-mesh-panel")).not.toBeNull();
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("transform=");
    expect(svg).toContain("L5 25.15");
    expect(bundle.fabrication.svgSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives every 2D part one matching mesh and BOM entry with the same source hash", async () => {
    const { bundle } = await buildProjectionBundle(await fixtureDocument(), [
      {
        id: "mesh-panel-placement",
        partId: "mesh-panel",
        xUm: 5_000,
        yUm: 5_000,
        rotationDegrees: 0
      }
    ]);
    const mesh = bundle.scene.meshes[0]!;
    const bom = bundle.bom.entries[0]!;
    expect(mesh.partId).toBe("mesh-panel");
    expect(bom.partId).toBe("mesh-panel");
    expect(mesh.sourcePartHash).toBe(bom.sourcePartHash);
    expect(mesh.sourceDocumentHash).toBe(bundle.sourceDocumentHash);
    expect(bundle.fabrication.sourceDocumentHash).toBe(bundle.sourceDocumentHash);
    expect(mesh.triangles.length).toBeGreaterThan(0);
  });

  it("renders assembled and exploded views from the exact projected meshes", async () => {
    const { bundle } = await buildProjectionBundle(await fixtureDocument(), [
      {
        id: "mesh-panel-placement",
        partId: "mesh-panel",
        xUm: 5_000,
        yUm: 5_000,
        rotationDegrees: 0
      }
    ]);
    const assembled = renderSceneSvg(bundle.scene, "assembled");
    const exploded = renderSceneSvg(bundle.scene, "exploded");
    expect(assembled).toContain('id="scene-assembled"');
    expect(exploded).toContain('id="scene-exploded"');
    expect(assembled).not.toBe(exploded);
    expect(assembled).toContain('data-part-id="mesh-panel"');
  });
});
