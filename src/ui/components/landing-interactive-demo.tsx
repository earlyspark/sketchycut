"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";

import landingPayloadCandidate from "../../landing/basic-demo-payload.json";
import { readLandingDemoPayload } from "../../landing/payload-contract";
import { SheetView } from "./sheet-view";
import { StaticSceneView } from "./static-scene-view";

const landingPayload = readLandingDemoPayload(landingPayloadCandidate);
const LazySceneCanvas = dynamic(
  () => import("./landing-scene-canvas").then((module) => module.LandingSceneCanvas),
  { ssr: false, loading: () => null },
);

export function LandingInteractiveDemo() {
  const [stateKind, setStateKind] = useState<"assembled" | "exploded">("assembled");
  const [selectedPartId, setSelectedPartId] = useState<string | null>(
    landingPayload.markings[0]?.partId ?? null,
  );
  const [canvasReady, setCanvasReady] = useState(false);
  const markingCodeByPartId = useMemo(
    () => new Map(landingPayload.markings.map((entry) => [entry.partId, entry.markingCode])),
    [],
  );
  const markCanvasReady = useCallback(() => setCanvasReady(true), []);
  const selectPart = (partId: string): void => setSelectedPartId(partId.length === 0 ? null : partId);
  return (
    <div className="landing-interactive-demo">
      <div className="landing-demo-controls" aria-label="Assembly view">
        <button
          type="button"
          className={stateKind === "assembled" ? "active" : ""}
          aria-pressed={stateKind === "assembled"}
          onClick={() => setStateKind("assembled")}
        >Assembled</button>
        <button
          type="button"
          className={stateKind === "exploded" ? "active" : ""}
          aria-pressed={stateKind === "exploded"}
          onClick={() => setStateKind("exploded")}
        >Exploded</button>
      </div>
      <div className="landing-demo-grid">
        <div
          className="landing-scene"
          role="group"
          aria-label="Canonical 3D assembly view"
          data-selected-part-id={selectedPartId ?? ""}
        >
          <span className="sr-only">Interactive assembly scene. Use pointer or touch to orbit and zoom; select parts from the matching sheet.</span>
          <div className={canvasReady ? "landing-static-scene canvas-ready" : "landing-static-scene"}>
            <StaticSceneView
              scene={landingPayload.scene}
              stateKind={stateKind}
              selectedPartId={selectedPartId}
              onSelectPart={selectPart}
            />
          </div>
          <div className="landing-canvas-layer">
            <LazySceneCanvas
              scene={landingPayload.scene}
              stateKind={stateKind}
              selectedPartId={selectedPartId}
              onSelectPart={selectPart}
              onReady={markCanvasReady}
            />
          </div>
        </div>
        <div className="landing-sheet" aria-label="Matching canonical sheet">
          <SheetView
            sheet={landingPayload.sheet}
            markingCodeByPartId={markingCodeByPartId}
            stockFootprintMm={landingPayload.stockFootprintMm}
            selectedPartId={selectedPartId}
            onSelectPart={selectPart}
          />
        </div>
      </div>
    </div>
  );
}
