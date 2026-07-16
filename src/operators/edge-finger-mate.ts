import type { PartFeature } from "../domain/contracts.js";

import {
  localToWorld,
  rectangleContour,
  worldBounds,
  type IntervalUm,
  type OrthogonalWork,
  type PanelEdge,
  type PanelWork,
  type Vector3Um
} from "./orthogonal-model.js";

export const EDGE_FINGER_MATE_OPERATOR = {
  id: "edge-finger-mate",
  version: "1.0.0"
} as const;

function requirePanel(work: OrthogonalWork, partId: string): PanelWork {
  const panel = work.panels.get(partId);
  if (panel === undefined) {
    throw new Error(`Edge mate references unknown panel ${partId}.`);
  }
  return panel;
}

function edgeStripPoints(
  panel: PanelWork,
  edge: PanelEdge,
  spanStartUm: number,
  spanEndUm: number,
): Vector3Um[] {
  if (edge !== "left" && edge !== "right") {
    throw new Error(`Panel ${panel.spec.id} edge ${edge} is outside the vertical edge-mate precondition.`);
  }
  const xStartUm = edge === "left" ? 0 : panel.spec.widthUm - panel.thicknessUm;
  const xEndUm = edge === "left" ? panel.thicknessUm : panel.spec.widthUm;
  return [
    localToWorld(panel.spec, { xUm: xStartUm, yUm: spanStartUm, zUm: 0 }),
    localToWorld(panel.spec, { xUm: xEndUm, yUm: spanStartUm, zUm: 0 }),
    localToWorld(panel.spec, { xUm: xStartUm, yUm: spanEndUm, zUm: panel.thicknessUm }),
    localToWorld(panel.spec, { xUm: xEndUm, yUm: spanEndUm, zUm: panel.thicknessUm })
  ];
}

function intersectBounds(
  left: ReturnType<typeof worldBounds>,
  right: ReturnType<typeof worldBounds>,
): ReturnType<typeof worldBounds> {
  const minimum = {
    xUm: Math.max(left.minimum.xUm, right.minimum.xUm),
    yUm: Math.max(left.minimum.yUm, right.minimum.yUm),
    zUm: Math.max(left.minimum.zUm, right.minimum.zUm)
  };
  const maximum = {
    xUm: Math.min(left.maximum.xUm, right.maximum.xUm),
    yUm: Math.min(left.maximum.yUm, right.maximum.yUm),
    zUm: Math.min(left.maximum.zUm, right.maximum.zUm)
  };
  if (
    maximum.xUm <= minimum.xUm ||
    maximum.yUm <= minimum.yUm ||
    maximum.zUm <= minimum.zUm
  ) {
    throw new Error("Edge-mate panel strips do not share a positive-volume overlap.");
  }
  return { minimum, maximum };
}

function addNotch(panel: PanelWork, edge: PanelEdge, interval: IntervalUm): void {
  if (edge === "left") {
    panel.leftNotches.push(interval);
  } else if (edge === "right") {
    panel.rightNotches.push(interval);
  } else {
    throw new Error(`Edge ${edge} is outside the vertical finger-mate precondition.`);
  }
}

function edgeKeepout(
  panel: PanelWork,
  edge: PanelEdge,
  jointId: string,
  spanStartUm: number,
  spanEndUm: number,
): PartFeature {
  const xUm = edge === "left" ? 0 : panel.spec.widthUm - panel.thicknessUm;
  return {
    id: `${jointId}-${panel.spec.id}-keepout`,
    kind: "joint-keepout",
    operation: "none",
    fitClass: null,
    jointId,
    region: {
      outer: rectangleContour(
        `${jointId}-${panel.spec.id}-keepout-contour`,
        xUm,
        spanStartUm,
        panel.thicknessUm,
        spanEndUm - spanStartUm,
      ),
      holes: []
    },
    path: null,
    parametersUm: {}
  };
}

export function applyEdgeFingerMates(work: OrthogonalWork): OrthogonalWork {
  for (const mate of work.program.edgeMates) {
    const first = requirePanel(work, mate.firstPartId);
    const second = requirePanel(work, mate.secondPartId);
    const spanUm = mate.spanEndUm - mate.spanStartUm;
    const intervals = Array.from({ length: mate.fingerCount }, (_, index) => {
      const startUm = mate.spanStartUm + Math.floor((spanUm * index) / mate.fingerCount);
      const endUm = mate.spanStartUm + Math.floor((spanUm * (index + 1)) / mate.fingerCount);
      return {
        id: `${mate.id}-interval-${String(index + 1)}`,
        startUm,
        endUm,
        occupiedByPartId: index % 2 === 0 ? mate.firstPartId : mate.secondPartId
      };
    });
    for (const interval of intervals) {
      if (interval.occupiedByPartId === mate.firstPartId) {
        addNotch(second, mate.secondEdge, interval);
      } else {
        addNotch(first, mate.firstEdge, interval);
      }
    }
    const firstFeature = edgeKeepout(first, mate.firstEdge, mate.id, mate.spanStartUm, mate.spanEndUm);
    const secondFeature = edgeKeepout(second, mate.secondEdge, mate.id, mate.spanStartUm, mate.spanEndUm);
    first.features.push(firstFeature);
    second.features.push(secondFeature);
    const overlapBoundsWorldUm = intersectBounds(
      worldBounds(edgeStripPoints(first, mate.firstEdge, mate.spanStartUm, mate.spanEndUm)),
      worldBounds(edgeStripPoints(second, mate.secondEdge, mate.spanStartUm, mate.spanEndUm)),
    );
    work.joints.push({
      schemaVersion: "1.0",
      id: mate.id,
      kind: "finger-mate",
      between: [
        { partId: mate.firstPartId, featureId: firstFeature.id },
        { partId: mate.secondPartId, featureId: secondFeature.id }
      ],
      fitClass: "snug",
      nominalClearanceUm: 0,
      insertionDirection: mate.insertionDirection,
      realization: {
        kind: "edge-finger",
        firstPartId: mate.firstPartId,
        secondPartId: mate.secondPartId,
        firstFeatureId: firstFeature.id,
        secondFeatureId: secondFeature.id,
        spanStartUm: mate.spanStartUm,
        spanEndUm: mate.spanEndUm,
        intervals,
        overlapBoundsWorldUm
      }
    });
  }
  return work;
}
