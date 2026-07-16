import type {
  MachineProfile,
  ManufacturingPath,
  PartFeature,
  PolylineUm,
  SheetPart
} from "../../domain/contracts.js";
import { canonicalPartHash } from "../../compiler/canonical.js";
import {
  offsetRegionAnisotropic,
  orientPolyline
} from "../../kernel/geometry/clipper-adapter.js";
import { mmToUm } from "../../domain/units.js";

function findFeatureForContour(part: SheetPart, contourId: string): PartFeature | undefined {
  return part.features.find(
    (feature) =>
      feature.region?.outer.id === contourId ||
      feature.region?.holes.some((hole) => hole.id === contourId) === true ||
      feature.path?.id === contourId,
  );
}

function manufacturingPath(
  id: string,
  part: SheetPart,
  contour: PolylineUm,
  feature: PartFeature | undefined,
  sourceNominalHash: string,
  cuttingOrder: number,
): ManufacturingPath {
  return {
    id,
    partId: part.id,
    featureId: feature?.id ?? null,
    operation: feature?.operation === "score" || feature?.operation === "engrave" ? feature.operation : "cut",
    closed: contour.closed,
    contour,
    sourceNominalHash,
    cuttingOrder
  };
}

export async function projectManufacturingPaths(
  part: SheetPart,
  machine: MachineProfile,
): Promise<ManufacturingPath[]> {
  const sourceNominalHash = await canonicalPartHash(part);
  const halfKerfXUm = Math.round(mmToUm(machine.kerfMm.x) / 2);
  const halfKerfYUm = Math.round(mmToUm(machine.kerfMm.y) / 2);
  const profileCompensated = offsetRegionAnisotropic(
    part.nominalRegion,
    halfKerfXUm,
    halfKerfYUm,
    `${part.id}-manufacturing`,
  );

  const paths: ManufacturingPath[] = profileCompensated.holes.map((profileHole, index) => {
    const nominalHole = part.nominalRegion.holes[index]!;
    const feature = findFeatureForContour(part, nominalHole.id);
    const hole = feature?.toolpathCompensation === "none" ? nominalHole : profileHole;
    return manufacturingPath(
      `${part.id}-cut-hole-${String(index)}`,
      part,
      orientPolyline(hole, "cw"),
      feature,
      sourceNominalHash,
      10 + index,
    );
  });
  const outerFeature = findFeatureForContour(part, part.nominalRegion.outer.id);
  const outer = outerFeature?.toolpathCompensation === "none"
    ? part.nominalRegion.outer
    : profileCompensated.outer;
  paths.push(
    manufacturingPath(
      `${part.id}-cut-outer`,
      part,
      orientPolyline(outer, "ccw"),
      outerFeature,
      sourceNominalHash,
      100,
    ),
  );

  for (const feature of part.features) {
    if (
      (feature.operation === "cut" || feature.operation === "score" || feature.operation === "engrave") &&
      feature.path !== null
    ) {
      paths.push(
        manufacturingPath(
          `${part.id}-${feature.operation}-${feature.id}`,
          part,
          feature.path,
          feature,
          sourceNominalHash,
          feature.operation === "engrave" ? 0 : feature.operation === "score" ? 1 : 5,
        ),
      );
    }
  }

  return paths.sort((left, right) => left.cuttingOrder - right.cuttingOrder || left.id.localeCompare(right.id));
}
