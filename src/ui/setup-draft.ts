import type { InputPolicyEvaluation, InputPolicyFinding } from "../domain/contracts";
import {
  type AppliedFabricationSetup,
  appliedSetupThicknessInput,
  resolveFabricationSetup
} from "../domain/fabrication-setup";
import {
  InputPolicyViolationError,
  evaluateStockInputs,
  quantizeHundredthMm
} from "../domain/input-policy";
import { resolveNominalStockPreset } from "../domain/stock-catalog";
import { evaluatePackedSpanCalibration } from "../operators/accumulated-kerf-calibration";

import type { FabricationSetupDraft } from "./hooks/use-applied-fabrication-setup";

export type DraftSetupEvaluation =
  | {
      status: "invalid";
      message: string;
      findings: InputPolicyFinding[];
      policyEvaluation?: InputPolicyEvaluation;
    }
  | {
      status: "valid";
      applied: AppliedFabricationSetup;
      policyEvaluation: InputPolicyEvaluation;
    };

function parseRequired(value: string, label: string): number {
  if (value.trim().length === 0) {
    throw new RangeError(`${label} is required.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
  return parsed;
}

function invalid(message: string, findings: InputPolicyFinding[] = []): DraftSetupEvaluation {
  return { status: "invalid", message, findings };
}

export function evaluateFabricationSetupDraft(
  draft: FabricationSetupDraft,
  options: {
    requireAdditionalThicknessReadings: boolean;
    fixtureArtifactHash: string | null;
  },
): DraftSetupEvaluation {
  try {
    const stock = resolveNominalStockPreset(draft.stockPresetId);
    let thickness: AppliedFabricationSetup["thickness"];
    if (draft.thickness.basis === "nominal-preset") {
      thickness = {
        basis: "nominal-preset",
        effectiveThicknessMm: stock.defaultEffectiveThicknessMm
      };
    } else {
      const first = parseRequired(draft.thickness.readings[0], "Sheet thickness");
      const secondEntered = draft.thickness.readings[1].trim().length > 0;
      const thirdEntered = draft.thickness.readings[2].trim().length > 0;
      if (
        options.requireAdditionalThicknessReadings &&
        (!secondEntered || !thirdEntered)
      ) {
        return invalid("Complete both additional readings, or use one reading only.");
      }
      if (secondEntered !== thirdEntered) {
        return invalid("Complete both additional readings, or use one reading only.");
      }
      thickness = secondEntered && thirdEntered
        ? {
            basis: "user-reported-caliper",
            readingsMm: [
              first,
              parseRequired(draft.thickness.readings[1], "Middle of opposite edge"),
              parseRequired(draft.thickness.readings[2], "Middle of another edge")
            ]
          }
        : {
            basis: "user-reported-caliper",
            readingsMm: [first]
          };
    }

    const pinDiameter = draft.pin.basis === "nominal-preset"
      ? 3
      : quantizeHundredthMm(parseRequired(draft.pin.diameter, "Actual pin diameter"));
    if (pinDiameter <= 0) {
      return invalid("Actual pin diameter must be a positive caliper reading.");
    }

    let cutWidth: AppliedFabricationSetup["cutWidth"];
    if (draft.cutWidth.source === "provisional-preset") {
      cutWidth = {
        source: "provisional-preset",
        xMm: stock.defaultFullCutWidthMm,
        yMm: stock.defaultFullCutWidthMm
      };
    } else if (draft.cutWidth.source === "user-reported-manual") {
      cutWidth = {
        source: "user-reported-manual",
        xMm: parseRequired(draft.cutWidth.manualX, "Full cut width X"),
        yMm: parseRequired(draft.cutWidth.manualY, "Full cut width Y")
      };
    } else {
      if (options.fixtureArtifactHash === null) {
        return invalid("The independent cut-width fixture is still being prepared.");
      }
      const provisionalSetup: AppliedFabricationSetup = {
        stockPresetId: stock.id,
        thickness,
        cutWidth: {
          source: "provisional-preset",
          xMm: stock.defaultFullCutWidthMm,
          yMm: stock.defaultFullCutWidthMm
        },
        pin: { basis: draft.pin.basis, effectiveDiameterMm: pinDiameter }
      };
      const result = evaluatePackedSpanCalibration({
        ...appliedSetupThicknessInput(provisionalSetup),
        packedRowWidthMm: draft.cutWidth.packedRow.trim().length === 0
          ? null
          : Number(draft.cutWidth.packedRow),
        packedColumnHeightMm: draft.cutWidth.packedColumn.trim().length === 0
          ? null
          : Number(draft.cutWidth.packedColumn),
        fixtureArtifactHash: options.fixtureArtifactHash
      });
      if (result.status === "invalid") {
        return invalid(result.findings.map((finding) => finding.message).join(" "), result.findings);
      }
      if (result.evaluation.kerf.fixtureEvidence === undefined) {
        return invalid("Fixture-derived cut width is missing its raw evidence.");
      }
      cutWidth = {
        source: "fixture-derived",
        xMm: result.evaluation.kerf.xMm,
        yMm: result.evaluation.kerf.yMm,
        fixtureEvidence: result.evaluation.kerf.fixtureEvidence
      };
    }

    const applied: AppliedFabricationSetup = {
      stockPresetId: stock.id,
      thickness,
      cutWidth,
      pin: { basis: draft.pin.basis, effectiveDiameterMm: pinDiameter }
    };
    const profileInput = appliedSetupThicknessInput(applied);
    const evaluation = evaluateStockInputs({
      ...profileInput,
      kerfXmm: cutWidth.xMm,
      kerfYmm: cutWidth.yMm,
      kerfSource: cutWidth.source,
      ...(cutWidth.fixtureEvidence === undefined
        ? {}
        : { kerfFixtureEvidence: cutWidth.fixtureEvidence })
    });
    if (evaluation.status === "fail") {
      return {
        status: "invalid",
        message: evaluation.findings
          .filter((finding) => finding.severity === "error")
          .map((finding) => finding.message)
          .join(" "),
        findings: evaluation.findings,
        policyEvaluation: evaluation
      };
    }
    resolveFabricationSetup(applied);
    return { status: "valid", applied, policyEvaluation: evaluation };
  } catch (error) {
    if (error instanceof InputPolicyViolationError) {
      return {
        status: "invalid",
        message: error.message,
        findings: error.evaluation.findings,
        policyEvaluation: error.evaluation
      };
    }
    return invalid(error instanceof Error ? error.message : "Fabrication setup is invalid.");
  }
}
