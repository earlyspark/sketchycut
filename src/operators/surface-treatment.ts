import type { PartFeature, SheetPart } from "../domain/contracts.js";

import { rectangleContour } from "./orthogonal-model.js";

export const SURFACE_TREATMENT_OPERATOR = {
  id: "surface-treatment",
  version: "2.0.0"
} as const;

export class SurfaceTreatmentConstructionError extends Error {
  readonly code = "TREATMENT_SAFE_REGION_UNAVAILABLE";
  readonly partId: string;
  readonly treatmentId: string;

  constructor(part: SheetPart, treatment: TreatmentInput) {
    super(
      `Treatment ${treatment.id} has no safe region on ${part.id} at the measured ` +
      `${(part.thicknessUm / 1_000).toFixed(2)} mm thickness. The measurement was preserved; ` +
      "remove or reduce the nonessential treatment, or increase the panel dimensions.",
    );
    this.name = "SurfaceTreatmentConstructionError";
    this.partId = part.id;
    this.treatmentId = treatment.id;
  }
}

type TreatmentInput = {
  id: string;
  partId: string;
  primitive: "parallel-lines" | "inset-frame" | "corner-ticks";
  operation: "score";
  insetUm: number;
  count: number;
};

function labelFeatures(part: SheetPart): PartFeature[] {
  const outer = part.nominalRegion.outer.points;
  const maxXUm = Math.max(...outer.map((point) => point.xUm));
  const minYUm = Math.min(...outer.map((point) => point.yUm));
  const maxYUm = Math.max(...outer.map((point) => point.yUm));
  const insetUm = Math.max(5_000, part.thicknessUm * 2);
  const markingNumber = Number.parseInt(part.markingCode?.replaceAll(/\D/g, "") ?? "1", 10);
  const barCount = Number.isFinite(markingNumber) ? Math.max(1, Math.min(9, markingNumber)) : 1;
  const barSpacingUm = 1_500;
  const totalHeightUm = (barCount - 1) * barSpacingUm;
  const centerYUm = Math.round((minYUm + maxYUm) / 2);
  const startYUm = centerYUm - Math.round(totalHeightUm / 2);
  return Array.from({ length: barCount }, (_, index) => ({
    id: `${part.id}-label-${String(index + 1)}`,
    kind: "part-label" as const,
    operation: "score" as const,
    fitClass: null,
    jointId: null,
    region: null,
    path: {
      id: `${part.id}-label-${String(index + 1)}-path`,
      closed: false,
      points: [
        { xUm: maxXUm - insetUm - 8_000, yUm: startYUm + index * barSpacingUm },
        { xUm: maxXUm - insetUm, yUm: startYUm + index * barSpacingUm }
      ]
    },
    parametersUm: { markingCode: markingNumber, barIndex: index + 1 }
  }));
}

function treatmentFeatures(part: SheetPart, treatment: TreatmentInput): PartFeature[] {
  const outer = part.nominalRegion.outer.points;
  const minXUm = Math.min(...outer.map((point) => point.xUm)) + treatment.insetUm;
  const maxXUm = Math.max(...outer.map((point) => point.xUm)) - treatment.insetUm;
  const minYUm = Math.min(...outer.map((point) => point.yUm)) + treatment.insetUm;
  const maxYUm = Math.max(...outer.map((point) => point.yUm)) - treatment.insetUm;
  if (maxXUm - minXUm < 8_000 || maxYUm - minYUm < 8_000) {
    throw new SurfaceTreatmentConstructionError(part, treatment);
  }
  const labelKeepoutWidthUm = Math.min(16_000, Math.floor((maxXUm - minXUm) / 4));
  const safeMaxXUm = maxXUm - labelKeepoutWidthUm - 2_000;
  const safeRegionId = `${treatment.id}-safe-region`;
  const features: PartFeature[] = [{
    id: safeRegionId,
    kind: "safe-treatment-region",
    operation: "none",
    fitClass: null,
    jointId: null,
    region: {
      outer: rectangleContour(
        `${safeRegionId}-contour`,
        minXUm,
        minYUm,
        safeMaxXUm - minXUm,
        maxYUm - minYUm,
      ),
      holes: []
    },
    path: null,
    parametersUm: { edgeInset: treatment.insetUm }
  }];

  if (treatment.primitive === "parallel-lines") {
    for (let index = 0; index < treatment.count; index += 1) {
      const yUm = minYUm + Math.floor(((index + 1) * (maxYUm - minYUm)) / (treatment.count + 1));
      features.push({
        id: `${treatment.id}-line-${String(index + 1)}`,
        kind: "treatment",
        operation: treatment.operation,
        fitClass: null,
        jointId: null,
        region: null,
        path: {
          id: `${treatment.id}-line-${String(index + 1)}-path`,
          closed: false,
          points: [{ xUm: minXUm, yUm }, { xUm: safeMaxXUm, yUm }]
        },
        parametersUm: { primitiveIndex: index }
      });
    }
  } else if (treatment.primitive === "inset-frame") {
    features.push({
      id: `${treatment.id}-frame`,
      kind: "treatment",
      operation: treatment.operation,
      fitClass: null,
      jointId: null,
      region: null,
      path: rectangleContour(
        `${treatment.id}-frame-path`,
        minXUm,
        minYUm,
        safeMaxXUm - minXUm,
        maxYUm - minYUm,
      ),
      parametersUm: {}
    });
  } else {
    const lengthUm = Math.min(6_000, Math.floor((maxYUm - minYUm) / 3));
    const corners = [
      [minXUm, minYUm, 1, 1],
      [safeMaxXUm, minYUm, -1, 1],
      [minXUm, maxYUm, 1, -1],
      [safeMaxXUm, maxYUm, -1, -1]
    ] as const;
    for (const [index, [xUm, yUm, xDirection, yDirection]] of corners.entries()) {
      features.push({
        id: `${treatment.id}-tick-${String(index + 1)}`,
        kind: "treatment",
        operation: treatment.operation,
        fitClass: null,
        jointId: null,
        region: null,
        path: {
          id: `${treatment.id}-tick-${String(index + 1)}-path`,
          closed: false,
          points: [
            { xUm: xUm + xDirection * lengthUm, yUm },
            { xUm, yUm },
            { xUm, yUm: yUm + yDirection * lengthUm }
          ]
        },
        parametersUm: { primitiveIndex: index }
      });
    }
  }
  return features;
}

export function applySurfaceTreatments(
  parts: readonly SheetPart[],
  treatments: readonly TreatmentInput[],
): SheetPart[] {
  const treatmentsByPart = new Map<string, TreatmentInput[]>();
  for (const treatment of treatments) {
    const current = treatmentsByPart.get(treatment.partId) ?? [];
    current.push(treatment);
    treatmentsByPart.set(treatment.partId, current);
  }
  return parts.map((part) => ({
    ...part,
    features: [
      ...part.features,
      ...labelFeatures(part),
      ...(treatmentsByPart.get(part.id) ?? []).flatMap((treatment) => treatmentFeatures(part, treatment))
    ]
  }));
}
