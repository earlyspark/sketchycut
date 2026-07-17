import { describe, expect, it } from "vitest";

import { CAPABILITY_CATALOG_V1 } from "../../src/interpretation/capability-catalog.js";
import { IntentGraphV1Schema, type IntentGraphV1 } from "../../src/interpretation/intent-graph.js";
import { mapIntentGraph } from "../../src/interpretation/mapper.js";

function evidence(id: string, statement: string) {
  return { evidenceId: id, source: "text" as const, referenceId: null, statement };
}

function rigidIntent(title = "Planar object"): IntentGraphV1 {
  return IntentGraphV1Schema.parse({
    schemaVersion: "1.0",
    title,
    coreIntent: "Hold an object in a rigid orthogonal sheet assembly.",
    requirements: [{
      id: "rigid-function",
      priority: "must",
      kind: "rigid-assembly",
      statement: "The assembly must remain rigid without added glue.",
      evidence: [evidence("brief-rigid", "The brief explicitly asks for a rigid assembly.")]
    }],
    references: [],
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
          id: "back-body",
          role: "support",
          quantity: 1,
          shapeClass: "planar",
          attachmentRole: "side",
          orientationRole: "vertical"
        }
      ],
      interfaces: [{
        id: "base-back-interface",
        between: ["base-body", "back-body"],
        behavior: "rigid",
        relativeOrientation: "orthogonal",
        axisRole: "unspecified",
        function: "Hold the two supporting planes together."
      }]
    },
    motif: null,
    conflicts: [],
    assumptions: [],
    capabilityAssessment: { coreIntentRepresentable: true, unresolvedNeeds: [] }
  });
}

function withRequirement(
  intent: IntentGraphV1,
  requirement: IntentGraphV1["requirements"][number],
): IntentGraphV1 {
  return IntentGraphV1Schema.parse({
    ...intent,
    requirements: [...intent.requirements, requirement]
  });
}

describe("strict IntentGraphV1", () => {
  it("round-trips nullable motif, literal unions, and nested arrays while rejecting unknown fields", () => {
    const intent = rigidIntent();
    expect(IntentGraphV1Schema.parse(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
    expect(IntentGraphV1Schema.safeParse({ ...intent, rawSvg: "<svg/>" }).success).toBe(false);
    expect(IntentGraphV1Schema.safeParse({
      ...intent,
      topology: { ...intent.topology, bodies: [] }
    }).success).toBe(false);
  });

  it("publishes capabilities and exclusions rather than named product choices", () => {
    const serialized = JSON.stringify(CAPABILITY_CATALOG_V1).toLowerCase();
    expect(CAPABILITY_CATALOG_V1.capabilities).toHaveLength(4);
    expect(serialized).not.toMatch(/basic box|hinged-lid box|sliding-lid box/);
    expect(serialized).toContain("single-axis-retained-revolute");
    expect(serialized).toContain("reference tracing or vectorization");
  });
});

describe("topology and capability mapper fixtures", () => {
  it("maps birdhouse-like and phone-stand-like rigid topology without a family selector", async () => {
    for (const title of ["Small bird shelter", "Angled phone support"]) {
      const outcome = await mapIntentGraph(rigidIntent(title));
      expect(outcome.kind).toBe("supported");
      expect(outcome.operatorGraph?.graphId).toBe("rigid-panel-composition");
    }
  });

  it("withholds a blocky car instead of silently replacing requested wheel motion", async () => {
    const base = rigidIntent("Blocky car");
    const candidate = withRequirement(IntentGraphV1Schema.parse({
      ...base,
      topology: {
        bodies: [
          ...base.topology.bodies,
          {
            id: "axle-body",
            role: "connector",
            quantity: 2,
            shapeClass: "rod",
            attachmentRole: "internal",
            orientationRole: "axial"
          },
          {
            id: "wheel-body",
            role: "moving-panel",
            quantity: 4,
            shapeClass: "planar",
            attachmentRole: "side",
            orientationRole: "vertical"
          }
        ],
        interfaces: [
          ...base.topology.interfaces,
          {
            id: "chassis-axle-interface",
            between: ["base-body", "axle-body"],
            behavior: "revolute",
            relativeOrientation: "coaxial",
            axisRole: "width",
            function: "Allow the axles and wheels to rotate."
          },
          {
            id: "axle-wheel-interface",
            between: ["axle-body", "wheel-body"],
            behavior: "rigid",
            relativeOrientation: "coaxial",
            axisRole: "width",
            function: "Carry rotating wheels."
          }
        ]
      }
    }), {
      id: "rolling-motion",
      priority: "must",
      kind: "compound-motion",
      statement: "All wheels must roll on retained axles.",
      evidence: [evidence("brief-rolling", "The brief requires rolling wheels.")]
    });
    const outcome = await mapIntentGraph(candidate);
    expect(outcome.kind).toBe("concept-only");
    expect(outcome.findings.map((item) => item.code)).toContain("COMPOUND_MOTION_UNSUPPORTED");
    expect(outcome.operatorGraph).toBeNull();
  });

  it("returns typed concept-only outcomes for multiple moving panels, contradictions, disconnection, empty topology, and unsatisfied needs", async () => {
    const base = rigidIntent();
    const multiple = IntentGraphV1Schema.parse({
      ...base,
      topology: {
        ...base.topology,
        bodies: base.topology.bodies.map((body) =>
          body.id === "back-body"
            ? { ...body, role: "moving-panel", quantity: 2 }
            : body,
        ),
        interfaces: [{
          ...base.topology.interfaces[0],
          behavior: "revolute",
          relativeOrientation: "coaxial"
        }]
      }
    });
    const contradictory = IntentGraphV1Schema.parse({
      ...base,
      topology: {
        ...base.topology,
        interfaces: [
          base.topology.interfaces[0],
          {
            ...base.topology.interfaces[0],
            id: "second-interface",
            behavior: "prismatic",
            axisRole: "depth"
          }
        ]
      }
    });
    const disconnected = IntentGraphV1Schema.parse({
      ...base,
      topology: {
        bodies: [...base.topology.bodies, {
          id: "orphan-body",
          role: "cover",
          quantity: 1,
          shapeClass: "planar",
          attachmentRole: "free",
          orientationRole: "horizontal"
        }],
        interfaces: base.topology.interfaces
      }
    });
    const unsatisfied = withRequirement(base, {
      id: "curved-profile",
      priority: "must",
      kind: "specific-profile",
      statement: "The silhouette must follow a freeform bird outline.",
      evidence: [evidence("brief-profile", "The brief requires an exact freeform outline.")]
    });
    const cases: unknown[] = [multiple, contradictory, disconnected, {
      ...base,
      topology: { bodies: [], interfaces: [] }
    }, unsatisfied];
    for (const candidate of cases) {
      const outcome = await mapIntentGraph(candidate);
      expect(outcome.kind).toBe("concept-only");
      expect(outcome.operatorGraph).toBeNull();
    }
  });

  it("allows a disclosed preferred omission without weakening a must requirement", async () => {
    const candidate = withRequirement(rigidIntent(), {
      id: "curved-preference",
      priority: "prefer",
      kind: "specific-profile",
      statement: "A curved silhouette would be nice.",
      evidence: [evidence("brief-curved-preference", "The profile is explicitly optional.")]
    });
    const outcome = await mapIntentGraph(candidate);
    expect(outcome.kind).toBe("simplified");
    expect(outcome.disclosures[0]).toContain("Preferred request omitted");
    expect(outcome.requirementEvidence.map((item) => item.requirementId)).toEqual([
      "rigid-function"
    ]);
  });

  it("maps a mandatory permitted-sheet-stock requirement through the rigid sheet capability", async () => {
    const candidate = withRequirement(rigidIntent(), {
      id: "permitted-sheet-stock",
      priority: "must",
      kind: "permitted-stock",
      statement: "Use permitted sheet stock for the rigid assembly.",
      evidence: [evidence("brief-permitted-stock", "The brief requires permitted sheet stock.")]
    });
    const outcome = await mapIntentGraph(candidate);
    expect(outcome.kind).toBe("supported");
    expect(outcome.requirementEvidence).toContainEqual(expect.objectContaining({
      requirementId: "permitted-sheet-stock",
      capabilityIds: ["rigid-orthogonal-sheet-assembly"]
    }));
  });

  it("is invariant to IDs, ordering, and prose paraphrase but responds to relevant behavior", async () => {
    const first = rigidIntent("Phone stand");
    const renamed = IntentGraphV1Schema.parse({
      ...first,
      title: "Support for a mobile device",
      coreIntent: "Keep a handheld display upright.",
      requirements: [{
        ...first.requirements[0],
        id: "mandatory-support",
        statement: "The two planes must be joined rigidly.",
        evidence: [evidence("reworded-brief", "A rigid support is mandatory.")]
      }],
      topology: {
        bodies: [
          { ...first.topology.bodies[1], id: "upright" },
          { ...first.topology.bodies[0], id: "foot" }
        ],
        interfaces: [{
          ...first.topology.interfaces[0],
          id: "join",
          between: ["upright", "foot"]
        }]
      }
    });
    const [originalOutcome, renamedOutcome] = await Promise.all([
      mapIntentGraph(first),
      mapIntentGraph(renamed)
    ]);
    expect(originalOutcome.operatorGraph).toEqual(renamedOutcome.operatorGraph);

    const changed = IntentGraphV1Schema.parse({
      ...first,
      requirements: [{
        ...first.requirements[0],
        kind: "prismatic-motion",
        statement: "The upright must slide along the base."
      }],
      topology: {
        ...first.topology,
        bodies: first.topology.bodies.map((body) =>
          body.id === "back-body" ? { ...body, role: "moving-panel" } : body,
        ),
        interfaces: [{
          ...first.topology.interfaces[0],
          behavior: "prismatic",
          relativeOrientation: "parallel",
          axisRole: "depth"
        }]
      }
    });
    const changedOutcome = await mapIntentGraph(changed);
    expect(changedOutcome.kind).toBe("supported");
    expect(changedOutcome.operatorGraph?.graphId).toBe("single-prismatic-panel");
  });
});
