"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

import type { SceneProjection } from "../../domain/contracts";

type SceneViewerProps = {
  scene: SceneProjection;
  stateKind: "assembled" | "exploded";
  motionDegrees: number;
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
};

function PartInstance({
  scene,
  instance,
  stateKind,
  motionDegrees,
  selectedPartId,
  onSelectPart
}: {
  scene: SceneProjection;
  instance: SceneProjection["states"][number]["instances"][number];
  stateKind: "assembled" | "exploded";
  motionDegrees: number;
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
}) {
  const mesh = scene.meshes.find((candidate) => candidate.id === instance.meshId);
  const geometry = useMemo(() => {
    if (mesh === undefined) {
      return null;
    }
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        mesh.verticesMm.flatMap((vertex) => [vertex.xMm, vertex.yMm, vertex.zMm]),
        3,
      ),
    );
    buffer.setIndex(mesh.triangles.flat());
    buffer.computeVertexNormals();
    return buffer;
  }, [mesh]);
  const transform = useMemo(() => {
    const radians = THREE.MathUtils.degToRad(instance.rotationDegrees);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(
        instance.rotationAxis.x,
        instance.rotationAxis.y,
        instance.rotationAxis.z,
      ),
      radians,
    );
    const position = new THREE.Vector3(
      instance.translationMm.xMm,
      instance.translationMm.yMm,
      instance.translationMm.zMm,
    );
    const motion = stateKind === "assembled"
      ? scene.motions?.find((candidate) => candidate.bodyPartIds.includes(instance.partId))
      : undefined;
    if (motion !== undefined) {
      const clampedDegrees = Math.max(
        motion.rangeDegrees.minimum,
        Math.min(motion.rangeDegrees.maximum, motionDegrees),
      );
      const motionQuaternion = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(
          motion.axis.direction.x,
          motion.axis.direction.y,
          motion.axis.direction.z,
        ),
        THREE.MathUtils.degToRad(clampedDegrees * motion.rotationSign),
      );
      const pivot = new THREE.Vector3(
        motion.axis.originMm.xMm,
        motion.axis.originMm.yMm,
        motion.axis.originMm.zMm,
      );
      position.sub(pivot).applyQuaternion(motionQuaternion).add(pivot);
      quaternion.premultiply(motionQuaternion);
    }
    return { position, quaternion };
  }, [instance, motionDegrees, scene.motions, stateKind]);
  if (mesh === undefined || geometry === null) {
    return null;
  }
  const selected = selectedPartId === instance.partId;
  return (
    <mesh
      geometry={geometry}
      position={transform.position}
      quaternion={transform.quaternion}
      onClick={(event) => {
        event.stopPropagation();
        onSelectPart(instance.partId);
      }}
    >
      <meshStandardMaterial
        color={selected ? "#ff8c42" : mesh.itemKind === "external-stock" ? "#9a6a3a" : "#d8b37b"}
        emissive={selected ? "#5f2600" : "#000000"}
        roughness={0.72}
        metalness={0.03}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function SceneViewer({
  scene,
  stateKind,
  motionDegrees,
  selectedPartId,
  onSelectPart
}: SceneViewerProps) {
  const state = scene.states.find((candidate) => candidate.kind === stateKind);
  if (state === undefined) {
    return <div className="viewer-empty">Scene state unavailable.</div>;
  }
  return (
    <Canvas
      camera={{ position: [220, -245, 190], fov: 36, near: 0.1, far: 2_000 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelectPart("")}
    >
      <color attach="background" args={["#101820"]} />
      <ambientLight intensity={1.45} />
      <directionalLight position={[110, -80, 180]} intensity={2.1} />
      <directionalLight position={[-80, 120, 80]} intensity={0.85} />
      <group
        position={[-60, -45, -28]}
        scale={stateKind === "assembled" ? 1.25 : 1}
      >
        {state.instances.map((instance) => (
          <PartInstance
            key={instance.id}
            scene={scene}
            instance={instance}
            stateKind={stateKind}
            motionDegrees={motionDegrees}
            selectedPartId={selectedPartId}
            onSelectPart={onSelectPart}
          />
        ))}
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={90}
        maxDistance={600}
      />
    </Canvas>
  );
}
