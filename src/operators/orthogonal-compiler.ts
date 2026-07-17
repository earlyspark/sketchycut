import {
  DesignDocumentV1Schema,
  OrthogonalPanelProgramV1Schema,
  type DesignDocumentV1,
  type FitProfile,
  type InputPolicyEvaluation,
  type MachineProfile,
  type MaterialProfile,
  type OrthogonalPanelProgramV1,
  type ValidationReport
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  evaluateStockInputs,
  requirePolicyEvaluationMatchesProfiles,
  requireSupportedStockInputs,
  stockInputFromProfiles
} from "../domain/input-policy.js";
import { mmToUm, umToMm } from "../domain/units.js";
import { validateOrthogonalAssembly } from "../validation/assembly.js";
import { validateParts } from "../validation/geometry.js";

import { applyEdgeFingerMates, EDGE_FINGER_MATE_OPERATOR } from "./edge-finger-mate.js";
import {
  ORTHOGONAL_PANEL_LAYOUT_OPERATOR,
  applyOrthogonalPanelLayout
} from "./orthogonal-panel-layout.js";
import { panelToSheetPart } from "./orthogonal-model.js";
import {
  PANEL_TAB_SLOT_MATE_OPERATOR,
  applyPanelTabSlotMates
} from "./panel-tab-slot-mate.js";
import {
  SURFACE_TREATMENT_OPERATOR,
  applySurfaceTreatments
} from "./surface-treatment.js";

export type OrthogonalCompileProfiles = {
  material: MaterialProfile;
  machine: MachineProfile;
  fit: FitProfile;
};

function mergeReports(...reports: readonly ValidationReport[]): ValidationReport {
  const findings = reports.flatMap((report) => report.findings);
  return {
    schemaVersion: "1.0",
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    findings
  };
}

function envelopeMm(program: OrthogonalPanelProgramV1): { x: number; y: number; z: number } {
  const origins = program.panels.map((panel) => panel.frame.origin);
  const maximumWidthUm = Math.max(...program.panels.map((panel) => panel.widthUm));
  const maximumHeightUm = Math.max(...program.panels.map((panel) => panel.heightUm));
  return {
    x: umToMm(Math.max(...origins.map((origin) => origin.xUm)) - Math.min(...origins.map((origin) => origin.xUm)) + maximumWidthUm),
    y: umToMm(Math.max(...origins.map((origin) => origin.yUm)) - Math.min(...origins.map((origin) => origin.yUm)) + maximumWidthUm),
    z: umToMm(Math.max(...origins.map((origin) => origin.zUm)) - Math.min(...origins.map((origin) => origin.zUm)) + maximumHeightUm)
  };
}

export async function compileOrthogonalPanelProgram(
  programInput: OrthogonalPanelProgramV1,
  profiles: OrthogonalCompileProfiles,
  inputPolicyEvaluation?: InputPolicyEvaluation,
): Promise<DesignDocumentV1> {
  const program = OrthogonalPanelProgramV1Schema.parse(programInput);
  const policyEvaluation = requireSupportedStockInputs(
    inputPolicyEvaluation ??
      evaluateStockInputs(stockInputFromProfiles(profiles.material, profiles.machine)),
  );
  requirePolicyEvaluationMatchesProfiles(
    policyEvaluation,
    profiles.material,
    profiles.machine,
  );
  if (
    program.materialProfileId !== profiles.material.id ||
    program.machineProfileId !== profiles.machine.id ||
    program.fitProfileId !== profiles.fit.id
  ) {
    throw new Error("Panel program profile IDs must match the resolved deterministic profiles.");
  }
  const work = applyEdgeFingerMates(
    applyPanelTabSlotMates(
      applyOrthogonalPanelLayout(program, profiles.material),
      profiles.fit,
    ),
  );
  const structuralParts = [...work.panels.values()]
    .map((panel) => panelToSheetPart(panel, profiles.material.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const parts = applySurfaceTreatments(structuralParts, program.treatments);
  const inputDigest = await hashCanonical({ program, profiles });
  const operators = [
    ORTHOGONAL_PANEL_LAYOUT_OPERATOR,
    PANEL_TAB_SLOT_MATE_OPERATOR,
    EDGE_FINGER_MATE_OPERATOR,
    SURFACE_TREATMENT_OPERATOR
  ] as const;
  const operatorProgram = await Promise.all(
    operators.map(async (operator) => ({
      operatorId: operator.id,
      operatorVersion: operator.version,
      parameterHash: await hashCanonical({
        operator,
        program: operator.id === ORTHOGONAL_PANEL_LAYOUT_OPERATOR.id
          ? program.panels
          : operator.id === PANEL_TAB_SLOT_MATE_OPERATOR.id
            ? program.tabSlotMates
            : operator.id === EDGE_FINGER_MATE_OPERATOR.id
              ? program.edgeMates
              : program.treatments
      })
    })),
  );
  const provisionalDocument = {
    schemaVersion: "1.0" as const,
    projectId: program.projectId,
    request: {
      schemaVersion: "1.0" as const,
      requestId: `${program.projectId}-request`,
      title: program.title,
      description: program.description,
      units: "mm" as const,
      envelopeMm: envelopeMm(program),
      materialProfileId: profiles.material.id,
      machineProfileId: profiles.machine.id,
      fitProfileId: profiles.fit.id,
      referenceIds: []
    },
    intent: {
      schemaVersion: "1.0" as const,
      fixtureId: `${program.programId}-intent`,
      title: program.title,
      coreIntent: "Compose rigid orthogonal panels through deterministic realized mates and linked fabrication projections.",
      requirements: [
        {
          id: "orthogonal-composition",
          priority: "must" as const,
          statement: "All exact geometry, fits, joints, assembly actions, validation, and projections are compiler-owned.",
          evidence: [
            {
              evidenceId: "offline-program",
              source: "text" as const,
              referenceId: null,
              statement: "Pinned operator-program fixture compiled without a runtime model call."
            }
          ]
        }
      ],
      topology: {
        bodies: parts.map((part) => ({
          id: part.id,
          role: part.id === program.tabSlotMates[0]?.openingPartId ? "support" as const : "enclosure" as const,
          quantity: 1,
          shapeClass: "planar" as const
        })),
        interfaces: work.joints.map((joint) => ({
          id: `${joint.id}-interface`,
          between: [joint.between[0].partId, joint.between[1].partId] as [string, string],
          behavior: "rigid" as const,
          function: joint.kind === "panel-tab-slot"
            ? "Insert tabs seat into matching through-slots."
            : "Complementary edge intervals occupy one shared corner band."
        }))
      },
      assumptions: [
        {
          id: "provisional-fit",
          statement: "Fit and kerf remain provisional until a same-sheet coupon is selected.",
          source: "preset" as const
        }
      ],
      capabilityAssessment: {
        coreIntentRepresentable: true,
        unresolvedNeeds: []
      }
    },
    resolvedInputs: {
      material: profiles.material,
      machine: profiles.machine,
      fit: profiles.fit,
      hardwarePolicy: {
        glueAllowed: false as const,
        permittedKinds: ["sheet-part" as const]
      }
    },
    operatorProgram,
    parts,
    joints: work.joints.sort((left, right) => left.id.localeCompare(right.id)),
    motionConstraints: [
      {
        schemaVersion: "1.0" as const,
        id: "rigid-assembly",
        kind: "fixed" as const,
        bodyPartIds: parts.map((part) => part.id),
        axis: {
          origin: { xUm: 0, yUm: 0, zUm: 0 },
          direction: { x: 0, y: 0, z: 1 }
        },
        range: { minimum: 0, maximum: 0, unit: "mm" as const }
      }
    ],
    assemblyPlan: program.assemblyGroups.map((group) => ({
      schemaVersion: "1.0" as const,
      id: group.id,
      order: group.order,
      action: group.action,
      partIds: group.partIds,
      jointIds: group.jointIds,
      direction: group.direction,
      dependsOnActionIds: group.dependsOnActionIds,
      instructionKey: group.instructionKey
    })),
    validation: {
      schemaVersion: "1.0" as const,
      status: "pass" as const,
      findings: []
    },
    provenance: {
      inputDigest,
      modelId: null,
      promptVersion: null,
      operatorVersions: Object.fromEntries(operators.map((operator) => [operator.id, operator.version])),
      deterministicSeed: program.deterministicSeed,
      runtimeApplicationApiCalls: 0 as const,
      inputPolicyEvaluation: policyEvaluation
    }
  };
  const parsedProvisional = DesignDocumentV1Schema.parse(provisionalDocument);
  const validation = mergeReports(
    validateParts(parts, {
      minimumWebUm: mmToUm(profiles.machine.minimumFeatureMm),
      compensationXUm: Math.round(mmToUm(profiles.machine.kerfMm.x) / 2),
      compensationYUm: Math.round(mmToUm(profiles.machine.kerfMm.y) / 2)
    }),
    validateOrthogonalAssembly(parsedProvisional),
  );
  return DesignDocumentV1Schema.parse({ ...parsedProvisional, validation });
}
