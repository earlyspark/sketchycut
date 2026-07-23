import { describe, expect, it } from "vitest";

import {
  createPublicFabricationSetup,
  createStarterPinSetup,
  resolveFabricationSetup
} from "../../src/domain/fabrication-setup.js";
import { planIntentConditionedConstruction } from "../../src/interpretation/construction-planner.js";
import { reconcileExplicitSizingConstraints } from "../../src/interpretation/explicit-sizing.js";
import { evaluateRequirementRealization } from "../../src/interpretation/realization-ledger.js";
import type { ClosedSemanticProjection } from "../../src/interpretation/semantic-interpretation.js";
import { closedProjectionForTest } from "../helpers/closed-semantic-projection.js";

function fixedApertureEnclosureIntent(): ClosedSemanticProjection {
  const requirements = [
    { id: "containment-required", priority: "must", kind: "containment", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"] },
    { id: "covered-access-required", priority: "must", kind: "access", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"] },
    { id: "wall-lattice-required", priority: "must", kind: "cut-through-treatment", inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"] }
  ];
  return closedProjectionForTest({
    schemaVersion: "2.4",
    title: "Fixed-aperture display enclosure",
    purpose: "Build a glue-free fixed-top enclosure with registered access and patterned apertures.",
    requirements,
    constructionBodies: [{
      id: "primary-body",
      role: "primary-enclosure",
      shapeClass: "orthogonal-shell",
      requirementIds: requirements.map((item) => item.id),
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"]
    }],
    objects: [],
    interfaces: [],
    access: [{
      bodyId: "primary-body",
      kind: "covered",
      direction: "top",
      priority: "must",
      requirementId: "covered-access-required",
      inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"]
    }],
    organization: [],
    scaleEvidence: [],
    proportions: [],
    clearance: [],
    rankedGoals: [{ id: "compactness-goal", kind: "compactness", rank: 1, inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"] }],
    motif: null,
    cutThrough: [
      {
        id: "top-access-application",
        bodyId: "primary-body",
        targetFaceRoles: ["cover"],
        patternFamily: "ring-aperture",
        purpose: "access",
        density: "sparse",
        symmetry: "radial",
        repetition: "single-face",
        fixedTopAccess: true,
        priority: "must",
        requirementId: "covered-access-required",
        inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"]
      },
      {
        id: "wall-lattice-application",
        bodyId: "primary-body",
        targetFaceRoles: ["rear", "left", "right", "front"],
        patternFamily: "lattice-grid",
        purpose: "illumination-ventilation",
        density: "dense",
        symmetry: "translational",
        repetition: "matched-faces",
        fixedTopAccess: false,
        priority: "must",
        requirementId: "wall-lattice-required",
        inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["brief-evidence"]
      }
    ],
    referenceBrief: [{
      referenceEvidenceId: "reference-evidence",
      relationship: "reproduce",
      observations: [
        {
          id: "pictured-lattice",
          kind: "ornament",
          value: "lattice",
          targetBodyRole: "primary-enclosure",
          targetFaceRole: "all",
          salience: "dominant",
          confidence: "high",
          visibility: "visible",
          inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["reference-evidence"]
        },
        {
          id: "pictured-cut-through",
          kind: "operation-character",
          value: "cut-through-visible",
          targetBodyRole: "primary-enclosure",
          targetFaceRole: "all",
          salience: "dominant",
          confidence: "high",
          visibility: "visible",
          inventoryItemIds: ["inventory-containment-required"], evidenceIds: ["reference-evidence"]
        }
      ]
    }],
    assumptions: [],
    conflicts: [],
    unresolvedNeeds: []
  });
}

async function plan(projection: ClosedSemanticProjection) {
  const setup = resolveFabricationSetup(createPublicFabricationSetup());
  const explicitSizing = await reconcileExplicitSizingConstraints({
    advancedSizing: { basis: "auto" },
    parsedConstraints: [],
    parserFindings: []
  });
  const planning = await planIntentConditionedConstruction({
    projection,
    explicitConstraints: explicitSizing,
    profiles: {
      material: setup.material,
      machine: setup.machine,
      processRecipe: setup.processRecipe,
      fabricationContext: setup.fabricationContext,
      fit: setup.fit
    },
    inputPolicyEvaluation: setup.inputPolicyEvaluation,
    pin: createStarterPinSetup()
  });
  return { planning, explicitSizing };
}

describe("intent-conditioned cut-through planning", () => {
  it("selects a fixed-top zero-DOF construction and deterministically reduces density to the Studio budget", async () => {
    const intent = fixedApertureEnclosureIntent();
    const { planning } = await plan(intent);
    expect(planning.kind, JSON.stringify(planning)).toBe("planned");
    if (planning.kind !== "planned") throw new Error("fixed-aperture enclosure not planned");
    const selected = planning.selected;
    const compiled = selected.compiled;
    if (compiled === null) throw new Error("fixed-aperture enclosure did not compile");
    const document = compiled.compiled.document;
    const accessApplication = document.cutThroughApplications?.find((item) =>
      item.id === "top-access-application"
    );
    const lattice = document.cutThroughApplications?.find((item) => item.id === "wall-lattice-application");
    const accessRealization = compiled.requirementRealization.records.find((item) =>
      item.requirementId === "covered-access-required"
    );
    expect(selected.plan?.topology.mechanism).toBe("fixed-top-frame");
    expect(selected.plan?.mates.filter((mate) => mate.kind === "fixed-top-frame")).toHaveLength(4);
    expect(intent.requirements.filter((item) =>
      item.kind === "access" || item.kind === "functional-aperture"
    )).toEqual([
      expect.objectContaining({ id: "covered-access-required", kind: "access" })
    ]);
    expect(accessApplication).toMatchObject({
      purpose: "access",
      sourceRequirementIds: ["covered-access-required"]
    });
    expect(accessRealization).toMatchObject({
      requirementKind: "access",
      state: "realized"
    });
    expect(accessRealization?.evidenceLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "canonical-feature",
        sourceId: "top-access-application"
      }),
      expect.objectContaining({
        kind: "registered-operator",
        sourceId: "cut-through-treatment"
      })
    ]));
    expect(compiled.requirementRealization.records.filter((item) =>
      item.requirementKind === "functional-aperture"
    )).toHaveLength(0);
    const withoutAccessApplication = structuredClone(document);
    withoutAccessApplication.cutThroughApplications = (
      withoutAccessApplication.cutThroughApplications ?? []
    ).filter((item) => item.id !== "top-access-application");
    const coverOnlyRealization = evaluateRequirementRealization({
      projection: intent,
      plan: selected.plan,
      document: withoutAccessApplication,
      motifReport: compiled.motifReport
    });
    expect(coverOnlyRealization.records.find((item) =>
      item.requirementId === "covered-access-required"
    )).toMatchObject({
      requirementKind: "access",
      state: "unsupported",
      evidenceLinks: []
    });
    expect(document.motionConstraints).toEqual([
      expect.objectContaining({ kind: "fixed", range: { minimum: 0, maximum: 0, unit: "mm" } })
    ]);
    expect(lattice).toMatchObject({
      requestedDensity: "dense",
      realizedDensity: "sparse",
      simplificationDisclosure: "Pattern density was reduced by deterministic import-complexity policy."
    });
    expect(compiled.importComplexity.every((item) => item.withinCurrentLimit)).toBe(true);
    expect(document.applicationLimitations).toEqual([]);
    expect(compiled.requirementRealization.records.find((item) =>
      item.requirementId === "wall-lattice-required"
    )).toMatchObject({ state: "simplified" });
  });
});
