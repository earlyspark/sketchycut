import type { SceneProjection } from "../../domain/contracts.js";

type Point3 = { x: number; y: number; z: number };
type Point2 = { x: number; y: number };

const COLORS = ["#d9aa63", "#c98d45", "#e7c78c", "#b77534", "#f0d9aa"];

function rotatePoint(point: Point3, axis: Point3, degrees: number): Point3 {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = point.x * axis.x + point.y * axis.y + point.z * axis.z;
  return {
    x:
      point.x * cosine +
      (axis.y * point.z - axis.z * point.y) * sine +
      axis.x * dot * (1 - cosine),
    y:
      point.y * cosine +
      (axis.z * point.x - axis.x * point.z) * sine +
      axis.y * dot * (1 - cosine),
    z:
      point.z * cosine +
      (axis.x * point.y - axis.y * point.x) * sine +
      axis.z * dot * (1 - cosine)
  };
}

function project(point: Point3): Point2 {
  return {
    x: (point.x - point.y) * Math.cos(Math.PI / 6),
    y: (point.x + point.y) * 0.5 - point.z
  };
}

export function renderSceneSvg(
  scene: SceneProjection,
  stateId: "assembled" | "exploded",
  width = 1_000,
  height = 700,
): string {
  const state = scene.states.find((candidate) => candidate.id === stateId);
  if (state === undefined) {
    throw new Error(`Scene state ${stateId} does not exist.`);
  }
  const meshById = new Map(scene.meshes.map((mesh) => [mesh.id, mesh]));
  const faces: {
    partId: string;
    depth: number;
    points: Point2[];
    color: string;
  }[] = [];
  const allPoints: Point2[] = [];

  for (const [instanceIndex, instance] of state.instances.entries()) {
    const mesh = meshById.get(instance.meshId);
    if (mesh === undefined) {
      throw new Error(`Scene instance references unknown mesh ${instance.meshId}.`);
    }
    const transformed = mesh.verticesMm.map((vertex) => {
      const rotated = rotatePoint(
        { x: vertex.xMm, y: vertex.yMm, z: vertex.zMm },
        instance.rotationAxis,
        instance.rotationDegrees,
      );
      return {
        x: rotated.x + instance.translationMm.xMm,
        y: rotated.y + instance.translationMm.yMm,
        z: rotated.z + instance.translationMm.zMm
      };
    });
    for (const triangle of mesh.triangles) {
      const world = triangle.map((index) => transformed[index]!) as [Point3, Point3, Point3];
      const points = world.map(project);
      allPoints.push(...points);
      faces.push({
        partId: instance.partId,
        depth: world.reduce((sum, point) => sum + point.x + point.y + point.z, 0) / 3,
        points,
        color: COLORS[instanceIndex % COLORS.length]!
      });
    }
  }

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const margin = 50;
  const scale = Math.min((width - margin * 2) / Math.max(1, maxX - minX), (height - margin * 2) / Math.max(1, maxY - minY));
  const mapPoint = (point: Point2): Point2 => ({
    x: margin + (point.x - minX) * scale,
    y: height - margin - (point.y - minY) * scale
  });

  const polygons = faces
    .sort((left, right) => left.depth - right.depth || left.partId.localeCompare(right.partId))
    .map((face, index) => {
      const points = face.points
        .map(mapPoint)
        .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
        .join(" ");
      return `<polygon id="face-${String(index)}" data-part-id="${face.partId}" points="${points}" fill="${face.color}" fill-opacity="0.97" stroke="#3d2b1f" stroke-opacity="0.18" stroke-width="0.35"/>`;
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="0 0 ${String(width)} ${String(height)}">`,
    '<rect width="100%" height="100%" fill="#f7f3eb"/>',
    `<g id="scene-${stateId}">${polygons}</g>`,
    `<text x="28" y="38" font-family="system-ui, sans-serif" font-size="20" fill="#2a211a">${stateId === "assembled" ? "Assembled" : "Exploded"} — interactive simulation, not a physical test</text>`,
    "</svg>",
    ""
  ].join("\n");
}
