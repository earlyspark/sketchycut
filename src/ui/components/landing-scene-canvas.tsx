"use client";

import { useEffect } from "react";

import type { SceneProjection } from "../../domain/contracts";
import { SceneViewer } from "./scene-viewer";

export function LandingSceneCanvas(props: {
  scene: SceneProjection;
  stateKind: "assembled" | "exploded";
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
  onReady: () => void;
}) {
  useEffect(() => props.onReady(), [props.onReady]);
  return (
    <SceneViewer
      scene={props.scene}
      stateKind={props.stateKind}
      motionValue={0}
      selectedPartId={props.selectedPartId}
      onSelectPart={props.onSelectPart}
    />
  );
}
