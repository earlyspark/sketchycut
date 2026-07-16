import {
  SceneProjectionSchema,
  type SceneProjection,
  type SheetPart
} from "../../domain/contracts.js";

import { umToMm } from "../../domain/units.js";
import { extrudePartMesh } from "./extrude.js";

type UnitVector3 = SheetPart["assembledFrame"]["xAxis"];

function frameAxisAngle(part: SheetPart): { axis: UnitVector3; degrees: number } {
  const { xAxis, yAxis, zAxis } = part.assembledFrame;
  const trace = xAxis.x + yAxis.y + zAxis.z;
  const radians = Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
  if (Math.abs(radians) < 1e-12) {
    return { axis: { x: 0, y: 0, z: 1 }, degrees: 0 };
  }
  const sin = Math.sin(radians);
  if (Math.abs(sin) < 1e-9) {
    const signedRoot = (value: number, signSource: number): number =>
      (signSource < 0 ? -1 : 1) * Math.sqrt(Math.max(0, value));
    const x = Math.sqrt(Math.max(0, (xAxis.x + 1) / 2));
    const y = signedRoot((yAxis.y + 1) / 2, xAxis.y + yAxis.x);
    const z = signedRoot((zAxis.z + 1) / 2, xAxis.z + zAxis.x);
    const magnitude = Math.hypot(x, y, z) || 1;
    return { axis: { x: x / magnitude, y: y / magnitude, z: z / magnitude }, degrees: 180 };
  }
  return {
    axis: {
      x: (yAxis.z - zAxis.y) / (2 * sin),
      y: (zAxis.x - xAxis.z) / (2 * sin),
      z: (xAxis.y - yAxis.x) / (2 * sin)
    },
    degrees: (radians * 180) / Math.PI
  };
}

export async function buildSceneProjection(
  parts: readonly SheetPart[],
  sourceDocumentHash: string,
): Promise<SceneProjection> {
  const meshes = await Promise.all(parts.map(async (part) => extrudePartMesh(part, sourceDocumentHash)));
  const state = (kind: "assembled" | "exploded") => ({
    id: kind,
    kind,
    instances: parts.map((part) => {
      const rotation = frameAxisAngle(part);
      const offset = kind === "exploded" ? part.explodedOffset : { xUm: 0, yUm: 0, zUm: 0 };
      return {
        id: `${kind}-${part.id}`,
        partId: part.id,
        meshId: `${part.id}-mesh`,
        translationMm: {
          xMm: umToMm(part.assembledFrame.origin.xUm + offset.xUm),
          yMm: umToMm(part.assembledFrame.origin.yUm + offset.yUm),
          zMm: umToMm(part.assembledFrame.origin.zUm + offset.zUm)
        },
        rotationAxis: rotation.axis,
        rotationDegrees: rotation.degrees
      };
    })
  });

  return SceneProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    meshes,
    states: [state("assembled"), state("exploded")]
  });
}
