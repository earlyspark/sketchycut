import {
  ExplicitSizingConstraintV1Schema,
  SIZING_FIXED_POINT_UM,
  SizingParserFindingV1Schema,
  targetKey,
  type ExplicitSizingConstraintV1,
  type SizingParserFindingV1
} from "./explicit-sizing.js";
import {
  SemanticInterpretationSchema,
  type SemanticInterpretation
} from "./semantic-interpretation.js";
import { SourceEvidenceIndexSchema, type SourceEvidenceIndex } from "./source-evidence.js";

export const EVIDENCE_BOUND_MEASUREMENT_POLICY_VERSION =
  "evidence-bound-measurement-current" as const;

const UNIT_TO_MM = {
  mm: 1,
  cm: 10,
  in: 25.4,
  inch: 25.4,
  inches: 25.4
} as const;

const literalPattern = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch|inches)\s*$/iu;

function ignoredFinding(input: {
  start: number;
  end: number;
  target: SemanticInterpretation["inventory"]["measurementTargets"][number]["target"];
  code: "SIZING_MEASUREMENT_IGNORED" | "SIZING_MEASUREMENT_AMBIGUOUS" | "SIZING_MEASUREMENT_UNVERIFIABLE";
  blocking: boolean;
  reason: "approximate" | "range" | "ambiguous-target" | "unsupported-form" |
    "unsupported-unit" | "invalid-evidence-span" | "nonessential-target" | "duplicate-target";
}): SizingParserFindingV1 {
  return SizingParserFindingV1Schema.parse(input);
}

export function bindEvidenceMeasurements(input: {
  semanticBrief: string;
  sourceEvidenceIndex: SourceEvidenceIndex;
  interpretation: SemanticInterpretation;
}): {
  parsedConstraints: ExplicitSizingConstraintV1[];
  parserFindings: SizingParserFindingV1[];
  blockingInventoryItemIds: string[];
} {
  const source = SourceEvidenceIndexSchema.parse(input.sourceEvidenceIndex);
  const interpretation = SemanticInterpretationSchema.parse(input.interpretation);
  const itemById = new Map(interpretation.inventory.items.map((item) => [item.id, item]));
  const measurements = interpretation.inventory.measurementTargets;
  const targetCounts = new Map<string, number>();
  for (const measurement of measurements) {
    const key = targetKey(measurement.target);
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  const parsedConstraints: ExplicitSizingConstraintV1[] = [];
  const parserFindings: SizingParserFindingV1[] = [];
  const blockingInventoryItemIds = new Set<string>();
  const addFinding = (measurement: typeof measurements[number], finding: SizingParserFindingV1): void => {
    parserFindings.push(finding);
    if (finding.blocking) blockingInventoryItemIds.add(measurement.inventoryItemId);
  };
  for (const measurement of measurements) {
    const { start, end, evidenceId } = measurement.literal;
    const span = source.spans.find((candidate) => candidate.evidenceId === evidenceId);
    const target = measurement.target;
    if (span === undefined || start < span.start || end > span.end || end > input.semanticBrief.length) {
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: "SIZING_MEASUREMENT_UNVERIFIABLE",
        blocking: true,
        reason: "invalid-evidence-span"
      }));
      continue;
    }
    if ((targetCounts.get(targetKey(target)) ?? 0) > 1) {
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: "SIZING_MEASUREMENT_AMBIGUOUS",
        blocking: true,
        reason: "duplicate-target"
      }));
      continue;
    }
    const item = itemById.get(measurement.inventoryItemId)!;
    if (item.importance !== "essential") {
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: "SIZING_MEASUREMENT_IGNORED",
        blocking: false,
        reason: "nonessential-target"
      }));
      continue;
    }
    if (measurement.interpretation !== "exact") {
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: measurement.interpretation === "ambiguous"
          ? "SIZING_MEASUREMENT_AMBIGUOUS"
          : "SIZING_MEASUREMENT_IGNORED",
        blocking: measurement.interpretation === "ambiguous",
        reason: measurement.interpretation === "approximate"
          ? "approximate"
          : measurement.interpretation === "range"
            ? "range"
            : "ambiguous-target"
      }));
      continue;
    }
    const literal = input.semanticBrief.slice(start, end);
    const match = literalPattern.exec(literal);
    if (match === null) {
      const hasNumber = /\d/u.test(literal);
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: "SIZING_MEASUREMENT_UNVERIFIABLE",
        blocking: true,
        reason: hasNumber ? "unsupported-unit" : "unsupported-form"
      }));
      continue;
    }
    const unit = match[2]!.toLowerCase() as keyof typeof UNIT_TO_MM;
    const valueUm = Math.round(Number(match[1]) * UNIT_TO_MM[unit] * 1_000);
    if (!Number.isFinite(valueUm) || valueUm <= 0 || valueUm % SIZING_FIXED_POINT_UM !== 0) {
      addFinding(measurement, ignoredFinding({
        start,
        end,
        target,
        code: "SIZING_MEASUREMENT_UNVERIFIABLE",
        blocking: true,
        reason: "unsupported-form"
      }));
      continue;
    }
    parsedConstraints.push(ExplicitSizingConstraintV1Schema.parse({
      constraintId: `brief-measurement-${measurement.id}`,
      source: "brief",
      target,
      valueUm,
      sourceEvidenceId: evidenceId,
      markerStart: start,
      markerEnd: end,
      status: "active",
      findingCode: null
    }));
  }
  return {
    parsedConstraints,
    parserFindings,
    blockingInventoryItemIds: [...blockingInventoryItemIds].sort()
  };
}
