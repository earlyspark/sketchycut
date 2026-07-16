import {
  InputPolicyEvaluationSchema,
  ThicknessMeasurementSummarySchema,
  type InputPolicyEvaluation,
  type InputPolicyFinding,
  type MachineProfile,
  type MaterialProfile,
  type ThicknessMeasurementSummary
} from "./contracts.js";

export type StockInputPolicy = {
  id: string;
  version: string;
  confidence: "provisional-preset" | "physically-verified";
  supportedMaterialKinds: readonly MaterialProfile["materialKind"][];
  nominalThicknessMm: number;
  thickness: {
    hardMinimumMm: number;
    hardMaximumMm: number;
    provisionalMinimumMm: number;
    provisionalMaximumMm: number;
    spreadAdvisoryMm: number;
    resolutionUm: 10;
    recommendedSampleCount: number;
  };
  kerf: {
    hardMinimumMm: number;
    hardMaximumMm: number;
    provisionalMinimumMm: number;
    provisionalMaximumMm: number;
    resolutionUm: 10;
    semantics: "full-cut-width";
  };
};

export const NOMINAL_3MM_LASER_PLYWOOD_POLICY: StockInputPolicy = {
  id: "nominal-three-millimetre-laser-plywood",
  version: "1.0.0",
  confidence: "provisional-preset",
  supportedMaterialKinds: ["basswood-plywood", "birch-plywood"],
  nominalThicknessMm: 3,
  thickness: {
    hardMinimumMm: 2.5,
    hardMaximumMm: 3.6,
    provisionalMinimumMm: 2.6,
    provisionalMaximumMm: 3.4,
    spreadAdvisoryMm: 0.15,
    resolutionUm: 10,
    recommendedSampleCount: 3
  },
  kerf: {
    hardMinimumMm: 0.05,
    hardMaximumMm: 0.4,
    provisionalMinimumMm: 0.08,
    provisionalMaximumMm: 0.25,
    resolutionUm: 10,
    semantics: "full-cut-width"
  }
};

export type StockMeasurementInput = {
  materialKind: MaterialProfile["materialKind"];
  thicknessSamplesMm: readonly number[];
  kerfXmm: number;
  kerfYmm?: number;
  kerfConfidence?: "provisional-preset" | "coupon-selected";
};

export class InputPolicyViolationError extends Error {
  readonly evaluation: InputPolicyEvaluation;

  constructor(evaluation: InputPolicyEvaluation) {
    const message = evaluation.findings
      .filter((finding) => finding.severity === "error")
      .map((finding) => finding.message)
      .join(" ");
    super(message.length > 0 ? message : "Measured inputs are outside the supported policy.");
    this.name = "InputPolicyViolationError";
    this.evaluation = evaluation;
  }
}

export function quantizeHundredthMm(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("Measured millimetres must be finite.");
  }
  const normalizedUm = Math.round(value * 1_000 / 10) * 10;
  return normalizedUm / 1_000;
}

export function summarizeThicknessSamples(
  samplesMm: readonly number[],
): ThicknessMeasurementSummary {
  if (samplesMm.length === 0) {
    throw new RangeError("At least one stock-thickness measurement is required.");
  }
  const samples = samplesMm.map(quantizeHundredthMm).sort((left, right) => left - right);
  if (samples.some((sample) => sample <= 0)) {
    throw new RangeError("Stock-thickness measurements must be positive.");
  }
  const middle = Math.floor(samples.length / 2);
  const rawMedian = samples.length % 2 === 1
    ? samples[middle]!
    : (samples[middle - 1]! + samples[middle]!) / 2;
  const representativeThicknessMm = quantizeHundredthMm(rawMedian);
  const minimumThicknessMm = samples[0]!;
  const maximumThicknessMm = samples.at(-1)!;
  return ThicknessMeasurementSummarySchema.parse({
    samplesMm: samples,
    representativeThicknessMm,
    minimumThicknessMm,
    maximumThicknessMm,
    spreadMm: quantizeHundredthMm(maximumThicknessMm - minimumThicknessMm),
    method: "median",
    resolutionUm: 10
  });
}

function thicknessFindings(
  summary: ThicknessMeasurementSummary,
  policy: StockInputPolicy,
): InputPolicyFinding[] {
  const findings: InputPolicyFinding[] = [];
  const outsideHardEnvelope = summary.samplesMm.some(
    (sample) =>
      sample < policy.thickness.hardMinimumMm ||
      sample > policy.thickness.hardMaximumMm,
  );
  if (outsideHardEnvelope) {
    findings.push({
      code: "STOCK_MEASUREMENT_OUT_OF_SUPPORTED_ENVELOPE",
      severity: "error",
      message:
        `A measured thickness is outside the supported nominal-${policy.nominalThicknessMm.toFixed(0)} mm ` +
        `envelope of ${policy.thickness.hardMinimumMm.toFixed(2)}–${policy.thickness.hardMaximumMm.toFixed(2)} mm.`
    });
  } else if (
    summary.samplesMm.some(
      (sample) =>
        sample < policy.thickness.provisionalMinimumMm ||
        sample > policy.thickness.provisionalMaximumMm,
    )
  ) {
    findings.push({
      code: "STOCK_MEASUREMENT_OUTSIDE_PROVISIONAL_BAND",
      severity: "warning",
      message:
        `A measured thickness is outside the provisional ${policy.thickness.provisionalMinimumMm.toFixed(2)}–` +
        `${policy.thickness.provisionalMaximumMm.toFixed(2)} mm band; verify the stock class and measurements.`
    });
  }
  if (summary.spreadMm > policy.thickness.spreadAdvisoryMm) {
    findings.push({
      code: "STOCK_THICKNESS_VARIATION_HIGH",
      severity: "warning",
      message:
        `Thickness spread is ${summary.spreadMm.toFixed(2)} mm, above the provisional ` +
        `${policy.thickness.spreadAdvisoryMm.toFixed(2)} mm advisory threshold; fit confidence is reduced.`
    });
  }
  return findings;
}

function kerfFinding(
  value: number,
  axis: "X" | "Y" | "X/Y",
  policy: StockInputPolicy,
): InputPolicyFinding | null {
  if (value < policy.kerf.hardMinimumMm || value > policy.kerf.hardMaximumMm) {
    return {
      code: "KERF_OUT_OF_SUPPORTED_ENVELOPE",
      severity: "error",
      message:
        `${axis} full kerf ${value.toFixed(2)} mm is outside the supported ` +
        `${policy.kerf.hardMinimumMm.toFixed(2)}–${policy.kerf.hardMaximumMm.toFixed(2)} mm envelope.`
    };
  }
  if (value < policy.kerf.provisionalMinimumMm || value > policy.kerf.provisionalMaximumMm) {
    return {
      code: "KERF_OUTSIDE_PROVISIONAL_BAND",
      severity: "warning",
      message:
        `${axis} full kerf ${value.toFixed(2)} mm is outside the provisional ` +
        `${policy.kerf.provisionalMinimumMm.toFixed(2)}–${policy.kerf.provisionalMaximumMm.toFixed(2)} mm band; ` +
        "verify it with an uncompensated test cut."
    };
  }
  return null;
}

export function evaluateStockInputs(
  input: StockMeasurementInput,
  policy: StockInputPolicy = NOMINAL_3MM_LASER_PLYWOOD_POLICY,
): InputPolicyEvaluation {
  const thickness = summarizeThicknessSamples(input.thicknessSamplesMm);
  const kerfXmm = quantizeHundredthMm(input.kerfXmm);
  const kerfYmm = quantizeHundredthMm(input.kerfYmm ?? input.kerfXmm);
  if (kerfXmm <= 0 || kerfYmm <= 0) {
    throw new RangeError("Full kerf measurements must be positive.");
  }
  const findings = thicknessFindings(thickness, policy);
  if (!policy.supportedMaterialKinds.includes(input.materialKind)) {
    findings.unshift({
      code: "STOCK_MATERIAL_KIND_UNSUPPORTED",
      severity: "error",
      message:
        `${input.materialKind} is not supported by stock policy ${policy.id}@${policy.version}.`
    });
  }
  if (kerfXmm === kerfYmm) {
    const finding = kerfFinding(kerfXmm, "X/Y", policy);
    if (finding !== null) {
      findings.push(finding);
    }
  } else {
    const xFinding = kerfFinding(kerfXmm, "X", policy);
    const yFinding = kerfFinding(kerfYmm, "Y", policy);
    if (xFinding !== null) {
      findings.push(xFinding);
    }
    if (yFinding !== null) {
      findings.push(yFinding);
    }
  }
  return InputPolicyEvaluationSchema.parse({
    schemaVersion: "1.0",
    policyId: policy.id,
    policyVersion: policy.version,
    policyConfidence: policy.confidence,
    materialKind: input.materialKind,
    status: findings.some((finding) => finding.severity === "error") ? "fail" : "pass",
    thickness,
    kerf: {
      xMm: kerfXmm,
      yMm: kerfYmm,
      semantics: policy.kerf.semantics,
      resolutionUm: policy.kerf.resolutionUm,
      confidence: input.kerfConfidence ?? "provisional-preset"
    },
    findings
  });
}

export function requirePolicyEvaluationMatchesProfiles(
  evaluation: InputPolicyEvaluation,
  material: MaterialProfile,
  machine: MachineProfile,
): InputPolicyEvaluation {
  const expectedSamples =
    material.thicknessMeasurement?.samplesMm ?? [material.measuredThicknessMm];
  const samplesMatch =
    evaluation.thickness.samplesMm.length === expectedSamples.length &&
    evaluation.thickness.samplesMm.every(
      (sample, index) => sample === expectedSamples[index],
    );
  if (
    evaluation.materialKind !== material.materialKind ||
    evaluation.thickness.representativeThicknessMm !== material.measuredThicknessMm ||
    !samplesMatch ||
    evaluation.kerf.xMm !== machine.kerfMm.x ||
    evaluation.kerf.yMm !== machine.kerfMm.y
  ) {
    throw new Error(
      "Input-policy evaluation must describe the exact material and machine profiles being compiled.",
    );
  }
  return evaluation;
}

export function requireSupportedStockInputs(
  evaluation: InputPolicyEvaluation,
): InputPolicyEvaluation {
  if (evaluation.status === "fail") {
    throw new InputPolicyViolationError(evaluation);
  }
  return evaluation;
}
