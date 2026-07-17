import {
  DesignDocumentV1Schema,
  type DesignDocumentV1,
  type FabricationContext,
  type FitProfile,
  type InputPolicyEvaluation,
  type MachineProfile,
  type MaterialProfile,
  type ProcessRecipe,
  type PartFeature,
  type SheetPart
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";
import {
  evaluateStockInputs,
  quantizeHundredthMm,
  requirePolicyEvaluationMatchesProfiles,
  requireSupportedStockInputs,
  stockInputFromProfiles
} from "../domain/input-policy.js";
import { mmToUm } from "../domain/units.js";
import { validateParts } from "../validation/geometry.js";

import { rectangleContour } from "./orthogonal-model.js";

export const ACCUMULATED_KERF_GAUGE_OPERATOR = {
  id: "accumulated-kerf-gauge",
  version: "1.0.0"
} as const;

export const ACCUMULATED_KERF_GAUGE_PIECE_COUNT = 10;
export const ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM = 12_000;
export const ACCUMULATED_KERF_GAUGE_PIECE_HEIGHT_UM = 10_000;
export const ACCUMULATED_KERF_GAUGE_PACKED_X_UM =
  ACCUMULATED_KERF_GAUGE_PIECE_COUNT * ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM;
export const ACCUMULATED_KERF_GAUGE_PACKED_Y_UM =
  ACCUMULATED_KERF_GAUGE_PIECE_COUNT * ACCUMULATED_KERF_GAUGE_PIECE_HEIGHT_UM;

export type AccumulatedKerfGaugeProfiles = {
  material: MaterialProfile;
  machine: MachineProfile;
  processRecipe: ProcessRecipe;
  fabricationContext: FabricationContext;
  fit: FitProfile;
};

function gaugePiece(
  index: number,
  profiles: AccumulatedKerfGaugeProfiles,
): SheetPart {
  const number = String(index + 1).padStart(2, "0");
  const id = `kerf-gauge-piece-${number}`;
  const outer = rectangleContour(
    `${id}-outer`,
    0,
    0,
    ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM,
    ACCUMULATED_KERF_GAUGE_PIECE_HEIGHT_UM,
  );
  const marker: PartFeature = {
    id: `${id}-orientation-marker`,
    kind: "score-label",
    operation: "score",
    toolpathCompensation: "none",
    fitClass: null,
    jointId: null,
    region: null,
    path: {
      id: `${id}-orientation-marker-path`,
      closed: false,
      points: [
        { xUm: 1_500, yUm: 8_500 },
        { xUm: 1_500, yUm: 6_500 },
        { xUm: 3_500, yUm: 6_500 }
      ]
    },
    parametersUm: {
      markerCornerTopLeft: 1,
      pieceIndex: index + 1
    }
  };
  return {
    schemaVersion: "1.0",
    id,
    name: `Accumulated kerf gauge piece ${number}`,
    role: "generic-panel",
    markingCode: `p${number}`,
    materialProfileId: profiles.material.id,
    thicknessUm: mmToUm(profiles.material.measuredThicknessMm),
    grainVector: { x: 1, y: 0 },
    nominalRegion: { outer, holes: [] },
    features: [
      {
        id: `${id}-boundary`,
        kind: "outer-boundary",
        operation: "cut",
        toolpathCompensation: "none",
        fitClass: null,
        jointId: null,
        region: { outer, holes: [] },
        path: null,
        parametersUm: {
          nominalWidth: ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM,
          nominalHeight: ACCUMULATED_KERF_GAUGE_PIECE_HEIGHT_UM,
          pieceCount: ACCUMULATED_KERF_GAUGE_PIECE_COUNT
        }
      },
      marker
    ],
    assembledFrame: {
      origin: {
        xUm: index * ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM,
        yUm: 0,
        zUm: 0
      },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { x: 0, y: 0, z: 1 }
    },
    explodedOffset: {
      xUm: 0,
      yUm: (index % 2 === 0 ? -1 : 1) * 12_000,
      zUm: index * 1_000
    },
    assemblyDependencyPartIds: [],
    sourceOperator: ACCUMULATED_KERF_GAUGE_OPERATOR
  };
}

export function accumulatedKerfFromPackedSpanMm(
  nominalPackedSpanMm: number,
  measuredPackedSpanMm: number,
  pieceCount = ACCUMULATED_KERF_GAUGE_PIECE_COUNT,
): number {
  if (!Number.isInteger(pieceCount) || pieceCount <= 0) {
    throw new RangeError("Accumulated kerf piece count must be a positive integer.");
  }
  if (!Number.isFinite(nominalPackedSpanMm) || !Number.isFinite(measuredPackedSpanMm)) {
    throw new RangeError("Accumulated kerf spans must be finite.");
  }
  return quantizeHundredthMm((nominalPackedSpanMm - measuredPackedSpanMm) / pieceCount);
}

export async function compileAccumulatedKerfGauge(
  profiles: AccumulatedKerfGaugeProfiles,
  inputPolicyEvaluation?: InputPolicyEvaluation,
): Promise<DesignDocumentV1> {
  const policyEvaluation = requireSupportedStockInputs(
    inputPolicyEvaluation ??
      evaluateStockInputs(stockInputFromProfiles(profiles.material, profiles.processRecipe)),
  );
  requirePolicyEvaluationMatchesProfiles(
    policyEvaluation,
    profiles.material,
    profiles.processRecipe,
  );
  const parts = Array.from(
    { length: ACCUMULATED_KERF_GAUGE_PIECE_COUNT },
    (_, index) => gaugePiece(index, profiles),
  );
  const pieceIds = parts.map((part) => part.id);
  const parameterHash = await hashCanonical({
    operator: ACCUMULATED_KERF_GAUGE_OPERATOR,
    materialKind: profiles.material.materialKind,
    measuredThicknessUm: mmToUm(profiles.material.measuredThicknessMm),
    pieceCount: ACCUMULATED_KERF_GAUGE_PIECE_COUNT,
    pieceWidthUm: ACCUMULATED_KERF_GAUGE_PIECE_WIDTH_UM,
    pieceHeightUm: ACCUMULATED_KERF_GAUGE_PIECE_HEIGHT_UM,
    toolpathCompensation: "none",
    orientationMarker: "scored-top-left-corner"
  });
  const inputDigest = await hashCanonical({ profiles });
  return DesignDocumentV1Schema.parse({
    schemaVersion: "1.0",
    projectId: `m2-1-kerf-gauge-${profiles.material.id}`,
    request: {
      schemaVersion: "1.0",
      requestId: `m2-1-kerf-gauge-request-${profiles.material.id}`,
      title: "Accumulated full-kerf measurement fixture",
      description:
        "Ten uncompensated pieces for software-validated X/Y packed-span measurement; physical verification required.",
      units: "mm",
      envelopeMm: { x: 120, y: 100, z: profiles.material.measuredThicknessMm },
      materialProfileId: profiles.material.id,
      machineProfileId: profiles.machine.id,
      fitProfileId: profiles.fit.id,
      referenceIds: []
    },
    intent: {
      schemaVersion: "1.0",
      fixtureId: "accumulated-kerf-gauge-intent",
      title: "Accumulated full-kerf measurement fixture",
      coreIntent:
        "Accumulate twenty parallel uncompensated boundary edges per packed axis, equal to ten full-kerf losses, so packed-span caliper measurements can estimate directional full cut width.",
      requirements: [
        {
          id: "uncompensated-pieces",
          priority: "must",
          statement:
            "Generate ten separate, orientation-marked pieces whose cut geometry is independent of the provisional kerf profile.",
          evidence: [
            {
              evidenceId: "offline-gauge-operator",
              source: "text",
              referenceId: null,
              statement: "Pinned deterministic operator; no runtime model call."
            }
          ]
        }
      ],
      topology: {
        bodies: parts.map((part) => ({
          id: part.id,
          role: "connector" as const,
          quantity: 1,
          shapeClass: "planar" as const
        })),
        interfaces: []
      },
      assumptions: [
        {
          id: "provisional-measurement-fixture",
          statement:
            "The fixture is software-validated only; process variation, beam taper, char, packing gaps, and measurement technique remain unverified.",
          source: "preset"
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
      processRecipe: profiles.processRecipe,
      fabricationContext: profiles.fabricationContext,
      fit: profiles.fit,
      hardwarePolicy: {
        glueAllowed: false,
        permittedKinds: ["sheet-part"]
      }
    },
    operatorProgram: [
      {
        operatorId: ACCUMULATED_KERF_GAUGE_OPERATOR.id,
        operatorVersion: ACCUMULATED_KERF_GAUGE_OPERATOR.version,
        parameterHash
      }
    ],
    parts,
    joints: [],
    motionConstraints: [
      {
        schemaVersion: "1.0",
        id: "kerf-gauge-packed-row",
        kind: "fixed",
        bodyPartIds: pieceIds,
        axis: {
          origin: { xUm: 0, yUm: 0, zUm: 0 },
          direction: { x: 0, y: 0, z: 1 }
        },
        range: { minimum: 0, maximum: 0, unit: "mm" }
      }
    ],
    assemblyPlan: [
      {
        schemaVersion: "1.0",
        id: "align-kerf-gauge-pieces",
        order: 0,
        action: "align",
        partIds: pieceIds,
        jointIds: [],
        direction: null,
        dependsOnActionIds: [],
        instructionKey: "align-kerf-gauge-markers"
      },
      {
        schemaVersion: "1.0",
        id: "measure-kerf-gauge-packs",
        order: 1,
        action: "verify",
        partIds: pieceIds,
        jointIds: [],
        direction: null,
        dependsOnActionIds: ["align-kerf-gauge-pieces"],
        instructionKey: "measure-packed-x-and-y"
      }
    ],
    calibrationMeasurements: [
      {
        schemaVersion: "1.0",
        id: "accumulated-full-kerf",
        operatorId: ACCUMULATED_KERF_GAUGE_OPERATOR.id,
        operatorVersion: ACCUMULATED_KERF_GAUGE_OPERATOR.version,
        kind: "accumulated-full-kerf",
        pieceIds,
        pieceCount: ACCUMULATED_KERF_GAUGE_PIECE_COUNT,
        nominalPackedSpanUm: {
          x: ACCUMULATED_KERF_GAUGE_PACKED_X_UM,
          y: ACCUMULATED_KERF_GAUGE_PACKED_Y_UM
        },
        resultResolutionUm: 10,
        semantics: "full-cut-width",
        formulaVersion: "1.0.0",
        orientationMarker: "scored-top-left-corner",
        confidence: "provisional-preset"
      }
    ],
    validation: validateParts(parts),
    provenance: {
      inputDigest,
      modelId: null,
      promptVersion: null,
      operatorVersions: {
        [ACCUMULATED_KERF_GAUGE_OPERATOR.id]: ACCUMULATED_KERF_GAUGE_OPERATOR.version
      },
      deterministicSeed: "accumulated-kerf-gauge-v1",
      runtimeApplicationApiCalls: 0,
      inputPolicyEvaluation: policyEvaluation
    }
  });
}
