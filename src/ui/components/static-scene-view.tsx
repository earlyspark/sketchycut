import type { SceneProjection } from "../../domain/contracts";

type Vector = { x: number; y: number; z: number };

function rotate(vector: Vector, axis: Vector, degrees: number): Vector {
  const radians = degrees * Math.PI / 180;
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const unit = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dot = vector.x * unit.x + vector.y * unit.y + vector.z * unit.z;
  return {
    x: vector.x * cosine + (unit.y * vector.z - unit.z * vector.y) * sine + unit.x * dot * (1 - cosine),
    y: vector.y * cosine + (unit.z * vector.x - unit.x * vector.z) * sine + unit.y * dot * (1 - cosine),
    z: vector.z * cosine + (unit.x * vector.y - unit.y * vector.x) * sine + unit.z * dot * (1 - cosine)
  };
}

function project(vector: Vector): { x: number; y: number; depth: number } {
  return {
    x: (vector.x - vector.y) * 0.78,
    y: (vector.x + vector.y) * 0.34 - vector.z * 0.92,
    depth: vector.x + vector.y + vector.z
  };
}

export function StaticSceneView(props: {
  scene: SceneProjection;
  stateKind: "assembled" | "exploded";
  selectedPartId: string | null;
  onSelectPart?: (partId: string) => void;
}) {
  const state = props.scene.states.find((candidate) => candidate.kind === props.stateKind);
  const faces = (state?.instances ?? []).flatMap((instance) => {
    const mesh = props.scene.meshes.find((candidate) => candidate.id === instance.meshId);
    if (mesh === undefined) return [];
    const vertices = mesh.verticesMm.map((vertex) => {
      const rotated = rotate(
        { x: vertex.xMm, y: vertex.yMm, z: vertex.zMm },
        instance.rotationAxis,
        instance.rotationDegrees,
      );
      return project({
        x: rotated.x + instance.translationMm.xMm,
        y: rotated.y + instance.translationMm.yMm,
        z: rotated.z + instance.translationMm.zMm
      });
    });
    return mesh.triangles.map((triangle, index) => ({
      id: `${instance.id}-${String(index)}`,
      partId: instance.partId,
      points: triangle.map((vertexIndex) => vertices[vertexIndex]!),
      depth: triangle.reduce((sum, vertexIndex) => sum + vertices[vertexIndex]!.depth, 0) / 3,
      external: mesh.itemKind === "external-stock"
    }));
  }).sort((left, right) => left.depth - right.depth);
  const points = faces.flatMap((face) => face.points);
  const minX = Math.min(...points.map((point) => point.x), 0);
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const minY = Math.min(...points.map((point) => point.y), 0);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const scale = Math.min(540 / Math.max(1, maxX - minX), 310 / Math.max(1, maxY - minY));
  const offsetX = 300 - (minX + maxX) * scale / 2;
  const offsetY = 180 - (minY + maxY) * scale / 2;
  return (
    <svg className="static-scene-svg" viewBox="0 0 600 360" role="img" aria-label={`${props.stateKind} canonical assembly`}>
      <rect width="600" height="360" rx="12" className="static-scene-background" />
      {faces.map((face) => (
        <polygon
          key={face.id}
          points={face.points.map((point) => `${String(point.x * scale + offsetX)},${String(point.y * scale + offsetY)}`).join(" ")}
          className={`static-scene-face${face.external ? " external" : ""}${props.selectedPartId === face.partId ? " selected" : ""}`}
          data-part-id={face.partId}
          onClick={props.onSelectPart === undefined ? undefined : () => props.onSelectPart?.(face.partId)}
        />
      ))}
    </svg>
  );
}
