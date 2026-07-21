import type {
  InputPolicyEvaluation,
  InputPolicyFinding,
  MaterialProfile,
  ThicknessBasis
} from "../domain/contracts.js";
import {
  NOMINAL_3MM_LASER_PLYWOOD_POLICY,
  evaluateStockInputs,
  quantizeHundredthMm
} from "../domain/input-policy.js";
import {
  ACCUMULATED_KERF_GAUGE_OPERATOR,
  ACCUMULATED_KERF_GAUGE_PACKED_X_UM,
  ACCUMULATED_KERF_GAUGE_PACKED_Y_UM,
  ACCUMULATED_KERF_GAUGE_PIECE_COUNT
} from "./accumulated-kerf-gauge.js";

const DESIGNED_ROW_MM = ACCUMULATED_KERF_GAUGE_PACKED_X_UM / 1_000;
const DESIGNED_COLUMN_MM = ACCUMULATED_KERF_GAUGE_PACKED_Y_UM / 1_000;

export type PackedSpanCalibrationInput = {
  materialKind: MaterialProfile["materialKind"];
  thicknessBasis: ThicknessBasis;
  effectiveThicknessMm?: number;
  thicknessSamplesMm?: readonly number[];
  packedRowWidthMm: number | null;
  packedColumnHeightMm: number | null;
  fixtureArtifactHash: string;
};

export type PackedSpanCalibrationResult =
  | {
      status: "invalid";
      findings: InputPolicyFinding[];
      rawDerivedFullCutWidthMm?: { x: number; y: number };
    }
  | {
      status: "valid";
      evaluation: InputPolicyEvaluation;
      rawDerivedFullCutWidthMm: { x: number; y: number };
    };

function stableDecimal(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function rawCutWidth(designedSpanMm: number, enteredSpanMm: number): number {
  return stableDecimal(
    (designedSpanMm - enteredSpanMm) / ACCUMULATED_KERF_GAUGE_PIECE_COUNT,
  );
}

function invalidSpan(message: string): PackedSpanCalibrationResult {
  return {
    status: "invalid",
    findings: [{
      code: "FIXTURE_PACKED_SPAN_INVALID",
      severity: "error",
      message
    }]
  };
}

function rawEnvelopeFinding(
  value: number,
  axis: "X" | "Y" | "X/Y",
): InputPolicyFinding {
  return {
    code: "KERF_OUT_OF_SUPPORTED_ENVELOPE",
    severity: "error",
    message:
      `${axis} raw derived full cut width ${value.toFixed(3)} mm is outside the supported ` +
      `${NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMinimumMm.toFixed(2)}–` +
      `${NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf.hardMaximumMm.toFixed(2)} mm envelope before rounding.`
  };
}

export function evaluatePackedSpanCalibration(
  input: PackedSpanCalibrationInput,
): PackedSpanCalibrationResult {
  const { packedRowWidthMm, packedColumnHeightMm } = input;
  if (packedRowWidthMm === null || packedColumnHeightMm === null) {
    return {
      status: "invalid",
      findings: [{
        code: "FIXTURE_PACKED_SPAN_INCOMPLETE",
        severity: "error",
        message: "Enter both packed row width and packed column height."
      }]
    };
  }
  if (
    !Number.isFinite(packedRowWidthMm) ||
    !Number.isFinite(packedColumnHeightMm) ||
    packedRowWidthMm <= 0 ||
    packedColumnHeightMm <= 0
  ) {
    return invalidSpan("Packed fixture spans must be finite positive measurements.");
  }
  if (packedRowWidthMm >= DESIGNED_ROW_MM) {
    return invalidSpan(
      `Packed row width must be less than the designed ${DESIGNED_ROW_MM.toFixed(2)} mm span.`,
    );
  }
  if (packedColumnHeightMm >= DESIGNED_COLUMN_MM) {
    return invalidSpan(
      `Packed column height must be less than the designed ${DESIGNED_COLUMN_MM.toFixed(2)} mm span.`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.fixtureArtifactHash)) {
    return invalidSpan("The calibration fixture artifact hash is unavailable or invalid.");
  }

  const raw = {
    x: rawCutWidth(DESIGNED_ROW_MM, packedRowWidthMm),
    y: rawCutWidth(DESIGNED_COLUMN_MM, packedColumnHeightMm)
  };
  const { hardMinimumMm, hardMaximumMm } = NOMINAL_3MM_LASER_PLYWOOD_POLICY.kerf;
  const xOutside = raw.x < hardMinimumMm || raw.x > hardMaximumMm;
  const yOutside = raw.y < hardMinimumMm || raw.y > hardMaximumMm;
  if (xOutside || yOutside) {
    const findings: InputPolicyFinding[] = [];
    if (xOutside && yOutside && raw.x === raw.y) {
      findings.push(rawEnvelopeFinding(raw.x, "X/Y"));
    } else {
      if (xOutside) findings.push(rawEnvelopeFinding(raw.x, "X"));
      if (yOutside) findings.push(rawEnvelopeFinding(raw.y, "Y"));
    }
    return {
      status: "invalid",
      findings,
      rawDerivedFullCutWidthMm: raw
    };
  }

  const normalized = {
    x: quantizeHundredthMm(raw.x),
    y: quantizeHundredthMm(raw.y)
  };
  const fixtureEvidence = {
    method: "accumulated-packed-span" as const,
    fixtureOperatorId: ACCUMULATED_KERF_GAUGE_OPERATOR.id,
    fixtureOperatorVersion: ACCUMULATED_KERF_GAUGE_OPERATOR.version,
    fixtureArtifactHash: input.fixtureArtifactHash,
    designedPackedSpanMm: { x: DESIGNED_ROW_MM, y: DESIGNED_COLUMN_MM },
    enteredPackedSpanMm: {
      row: packedRowWidthMm,
      column: packedColumnHeightMm
    },
    rawDerivedFullCutWidthMm: raw,
    normalizedFullCutWidthMm: normalized,
    formulaVersion: "1.0.0" as const,
    orientationProcessEvidenceState: "user-reported-unreviewed" as const
  };
  return {
    status: "valid",
    rawDerivedFullCutWidthMm: raw,
    evaluation: evaluateStockInputs({
      materialKind: input.materialKind,
      thicknessBasis: input.thicknessBasis,
      ...(input.thicknessBasis === "nominal-preset"
        ? input.effectiveThicknessMm === undefined
          ? {}
          : { effectiveThicknessMm: input.effectiveThicknessMm }
        : input.thicknessSamplesMm === undefined
          ? {}
          : { thicknessSamplesMm: input.thicknessSamplesMm }),
      kerfXmm: normalized.x,
      kerfYmm: normalized.y,
      kerfSource: "fixture-derived",
      kerfFixtureEvidence: fixtureEvidence
    })
  };
}

export const ACCUMULATED_KERF_VALID_PACKED_SPANS_MM = Object.freeze({
  row: { minimum: 116, maximum: 119.5 },
  column: { minimum: 96, maximum: 99.5 }
});
