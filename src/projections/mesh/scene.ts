import {
  SceneProjectionSchema,
  type SceneProjection,
  type DesignDocumentV1,
  type SheetPart
} from "../../domain/contracts.js";

import { umToMm } from "../../domain/units.js";
import { extrudePartMesh } from "./extrude.js";
import { buildStockMesh } from "./stock.js";

type UnitVector3 = SheetPart["assembledFrame"]["xAxis"];
type Frame = SheetPart["assembledFrame"];

function frameAxisAngle(frame: Frame): { axis: UnitVector3; degrees: number } {
  const { xAxis, yAxis, zAxis } = frame;
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

type Quaternion = { x: number; y: number; z: number; w: number };

function axisAngleQuaternion(axis: UnitVector3, degrees: number): Quaternion {
  const half = degrees * Math.PI / 360;
  const sine = Math.sin(half);
  return { x: axis.x * sine, y: axis.y * sine, z: axis.z * sine, w: Math.cos(half) };
}

function multiplyQuaternion(left: Quaternion, right: Quaternion): Quaternion {
  return {
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z
  };
}

function quaternionAxisAngle(quaternion: Quaternion): { axis: UnitVector3; degrees: number } {
  const magnitude = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
  const normalized = {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
  const half = Math.acos(Math.max(-1, Math.min(1, normalized.w)));
  const sine = Math.sin(half);
  if (Math.abs(sine) < 1e-10) {
    return { axis: { x: 0, y: 0, z: 1 }, degrees: 0 };
  }
  const axis = {
    x: normalized.x / sine,
    y: normalized.y / sine,
    z: normalized.z / sine
  };
  const axisMagnitude = Math.hypot(axis.x, axis.y, axis.z) || 1;
  return {
    axis: {
      x: Math.max(-1, Math.min(1, axis.x / axisMagnitude)),
      y: Math.max(-1, Math.min(1, axis.y / axisMagnitude)),
      z: Math.max(-1, Math.min(1, axis.z / axisMagnitude))
    },
    degrees: half * 360 / Math.PI
  };
}

function rotateAroundAxis(
  point: { xMm: number; yMm: number; zMm: number },
  origin: { xMm: number; yMm: number; zMm: number },
  axis: UnitVector3,
  degrees: number,
): { xMm: number; yMm: number; zMm: number } {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.xMm - origin.xMm;
  const y = point.yMm - origin.yMm;
  const z = point.zMm - origin.zMm;
  const dot = x * axis.x + y * axis.y + z * axis.z;
  return {
    xMm: origin.xMm + x * cosine + (axis.y * z - axis.z * y) * sine + axis.x * dot * (1 - cosine),
    yMm: origin.yMm + y * cosine + (axis.z * x - axis.x * z) * sine + axis.y * dot * (1 - cosine),
    zMm: origin.zMm + z * cosine + (axis.x * y - axis.y * x) * sine + axis.z * dot * (1 - cosine)
  };
}

export async function buildSceneProjection(
  document: DesignDocumentV1,
  sourceDocumentHash: string,
): Promise<SceneProjection> {
  const { parts } = document;
  const meshes = await Promise.all(parts.map(async (part) => extrudePartMesh(part, sourceDocumentHash)));
  const stockMeshes = await Promise.all(
    (document.externalStock ?? []).map(async (item) => buildStockMesh(item, sourceDocumentHash)),
  );
  const revolute = document.motionConstraints.find((constraint) => constraint.kind === "revolute");
  const prismatic = document.motionConstraints.find((constraint) => constraint.kind === "prismatic");
  const movable = revolute ?? prismatic;
  const movingPartIds = new Set(movable?.bodyPartIds ?? []);
  const motionAxis = revolute === undefined
    ? null
    : {
        originMm: {
          xMm: umToMm(revolute.axis.origin.xUm),
          yMm: umToMm(revolute.axis.origin.yUm),
          zMm: umToMm(revolute.axis.origin.zUm)
        },
        direction: revolute.axis.direction,
        maximumDegrees: revolute.range.maximum,
        rotationSign: revolute.revolute?.rotationSign ?? -1
      };
  const state = (kind: "assembled" | "exploded" | "closed" | "open" | "removal") => ({
    id: kind,
    kind,
    instances: [
      ...parts.map((part) => {
      const rotation = frameAxisAngle(part.assembledFrame);
      const removalRetainer = kind === "removal" &&
        prismatic?.prismatic?.states.removal.retainerPartIds.includes(part.id) === true;
      const offset = kind === "exploded" || removalRetainer
        ? part.explodedOffset
        : { xUm: 0, yUm: 0, zUm: 0 };
      const baseTranslation = {
        xMm: umToMm(part.assembledFrame.origin.xUm + offset.xUm),
        yMm: umToMm(part.assembledFrame.origin.yUm + offset.yUm),
        zMm: umToMm(part.assembledFrame.origin.zUm + offset.zUm)
      };
      const open = kind === "open" && motionAxis !== null && movingPartIds.has(part.id);
      const translated = prismatic !== undefined &&
        (kind === "open" || kind === "removal") &&
        movingPartIds.has(part.id);
      const travelMm = kind === "removal"
        ? umToMm(prismatic?.prismatic?.states.removal.positionUm ?? 0)
        : umToMm(prismatic?.prismatic?.states.fullyOpenUm ?? 0);
      const composedRotation = open
        ? quaternionAxisAngle(
            multiplyQuaternion(
              axisAngleQuaternion(
                motionAxis.direction,
                motionAxis.maximumDegrees * motionAxis.rotationSign,
              ),
              axisAngleQuaternion(rotation.axis, rotation.degrees),
            ),
          )
        : rotation;
      return {
        id: `${kind}-${part.id}`,
        partId: part.id,
        meshId: `${part.id}-mesh`,
        translationMm: open
          ? rotateAroundAxis(
              baseTranslation,
              motionAxis.originMm,
              motionAxis.direction,
              motionAxis.maximumDegrees * motionAxis.rotationSign,
            )
          : translated
          ? {
              xMm: baseTranslation.xMm + prismatic.axis.direction.x * travelMm,
              yMm: baseTranslation.yMm + prismatic.axis.direction.y * travelMm,
              zMm: baseTranslation.zMm + prismatic.axis.direction.z * travelMm
            }
          : baseTranslation,
        rotationAxis: composedRotation.axis,
        rotationDegrees: composedRotation.degrees
      };
      }),
      ...(document.externalStock ?? []).map((item) => {
        const rotation = frameAxisAngle(item.pose);
        const removedRetainer = kind === "removal" &&
          prismatic?.prismatic?.states.removal.retainerPartIds.includes(item.id) === true;
        const explodedDistanceUm = kind === "exploded" || removedRetainer
          ? -item.retention.installationClearanceUm
          : 0;
        return {
          id: `${kind}-${item.id}`,
          partId: item.id,
          meshId: `${item.id}-mesh`,
          translationMm: {
            xMm: umToMm(item.pose.origin.xUm) + item.retention.insertionDirection.x * umToMm(explodedDistanceUm),
            yMm: umToMm(item.pose.origin.yUm) + item.retention.insertionDirection.y * umToMm(explodedDistanceUm),
            zMm: umToMm(item.pose.origin.zUm) + item.retention.insertionDirection.z * umToMm(explodedDistanceUm)
          },
          rotationAxis: rotation.axis,
          rotationDegrees: rotation.degrees
        };
      })
    ]
  });

  return SceneProjectionSchema.parse({
    schemaVersion: "1.0",
    sourceDocumentHash,
    meshes: [...meshes, ...stockMeshes],
    states: [
      state("assembled"),
      state("exploded"),
      ...(revolute === undefined ? [] : [state("open")]),
      ...(prismatic === undefined
        ? []
        : [state("closed"), state("open"), state("removal")])
    ],
    ...(revolute?.revolute !== undefined
      ? {
          motions: [
            {
              id: `${revolute.id}-scene-motion`,
              constraintId: revolute.id,
              kind: "revolute",
              bodyPartIds: revolute.bodyPartIds,
              axis: {
                originMm: motionAxis!.originMm,
                direction: revolute.axis.direction
              },
              rangeDegrees: {
                minimum: revolute.range.minimum,
                maximum: revolute.range.maximum
              },
              rotationSign: revolute.revolute.rotationSign,
              animationSampleMaximumDegrees:
                revolute.revolute.proofModel.animationSampleMaximumDegrees
            }
          ]
        }
      : prismatic?.prismatic !== undefined
      ? {
          motions: [
            {
              id: `${prismatic.id}-scene-motion`,
              constraintId: prismatic.id,
              kind: "prismatic" as const,
              bodyPartIds: prismatic.bodyPartIds,
              axis: {
                originMm: {
                  xMm: umToMm(prismatic.axis.origin.xUm),
                  yMm: umToMm(prismatic.axis.origin.yUm),
                  zMm: umToMm(prismatic.axis.origin.zUm)
                },
                direction: prismatic.axis.direction
              },
              rangeMm: {
                minimum: prismatic.range.minimum,
                maximum: prismatic.range.maximum
              },
              removalPositionMm: umToMm(prismatic.prismatic.states.removal.positionUm),
              removableRetainerPartIds:
                prismatic.prismatic.states.removal.retainerPartIds,
              animationSampleMaximumMm: 1 as const
            }
          ]
        }
      : {})
  });
}
