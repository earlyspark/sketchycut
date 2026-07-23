import {
  SceneSurfaceTreatmentSchema,
  type SceneSurfaceTreatment,
  type SheetPart
} from "../../domain/contracts.js";
import { hashCanonical } from "../../domain/hash.js";
import { umToMm } from "../../domain/units.js";
import { triangulateRegion } from "../../kernel/geometry/triangulate.js";

function treatmentZMm(part: SheetPart, surfaceSide: "front" | "back"): number {
  return surfaceSide === "front" ? umToMm(part.thicknessUm) : 0;
}

export async function projectSceneSurfaceTreatments(
  part: SheetPart,
): Promise<SceneSurfaceTreatment[]> {
  const treatments = part.features
    .filter((feature) => feature.kind === "treatment" && (
      feature.operation === "score" || feature.operation === "engrave"
    ))
    .sort((left, right) => left.id.localeCompare(right.id));

  return Promise.all(treatments.map(async (feature) => {
    const surfaceSide = feature.surfaceSide ?? "front";
    const zMm = treatmentZMm(part, surfaceSide);
    const common = {
      schemaVersion: "2.0" as const,
      id: `${part.id}-${feature.id}-scene`,
      partId: part.id,
      sourceFeatureId: feature.id,
      sourceFeatureHash: await hashCanonical(feature),
      surfaceSide
    };
    if (feature.operation === "score") {
      const path = feature.path!;
      const verticesMm = path.points.map((point) => ({
        xMm: umToMm(point.xUm),
        yMm: umToMm(point.yUm),
        zMm
      }));
      const segments: [number, number][] = Array.from(
        { length: path.points.length - 1 + Number(path.closed) },
        (_, index) => [index, (index + 1) % path.points.length],
      );
      return SceneSurfaceTreatmentSchema.parse({
        ...common,
        operation: "score",
        verticesMm,
        segments
      });
    }

    const triangulation = triangulateRegion(feature.region!);
    return SceneSurfaceTreatmentSchema.parse({
      ...common,
      operation: "engrave",
      verticesMm: triangulation.vertices.map((point) => ({
        xMm: umToMm(point.xUm),
        yMm: umToMm(point.yUm),
        zMm
      })),
      triangles: triangulation.triangles
    });
  }));
}
