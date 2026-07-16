import type {
  Joint,
  OrthogonalPanelProgramV1,
  PartFeature,
  PointUm,
  Region2D,
  SheetPart,
  Vector3UmSchema
} from "../domain/contracts.js";
import type { z } from "zod";

import { booleanRegions } from "../kernel/geometry/clipper-adapter.js";

export type Vector3Um = z.infer<typeof Vector3UmSchema>;
export type PanelEdge = "bottom" | "right" | "top" | "left";
export type IntervalUm = {
  id: string;
  startUm: number;
  endUm: number;
};

export type PanelWork = {
  spec: OrthogonalPanelProgramV1["panels"][number];
  thicknessUm: number;
  bottomTabs: (IntervalUm & { jointId: string; depthUm: number })[];
  leftNotches: IntervalUm[];
  rightNotches: IntervalUm[];
  holes: Region2D["outer"][];
  features: PartFeature[];
};

export type OrthogonalWork = {
  program: OrthogonalPanelProgramV1;
  panels: Map<string, PanelWork>;
  joints: Joint[];
};

export function rectangleContour(
  id: string,
  xUm: number,
  yUm: number,
  widthUm: number,
  heightUm: number,
  orientation: "ccw" | "cw" = "ccw",
): Region2D["outer"] {
  const points: PointUm[] = [
    { xUm, yUm },
    { xUm: xUm + widthUm, yUm },
    { xUm: xUm + widthUm, yUm: yUm + heightUm },
    { xUm, yUm: yUm + heightUm }
  ];
  return {
    id,
    closed: true,
    points: orientation === "ccw" ? points : points.reverse()
  };
}

export function buildPanelOuter(panel: PanelWork): Region2D["outer"] {
  const { widthUm, heightUm, bodyInsetUm } = panel.spec;
  if (bodyInsetUm.left !== 0 || bodyInsetUm.right !== 0 || bodyInsetUm.top !== 0) {
    throw new Error(`Panel ${panel.spec.id} uses unsupported non-bottom body insets.`);
  }
  const bottomUm = bodyInsetUm.bottom;
  const solids: Region2D[] = [
    {
      outer: rectangleContour(
        `${panel.spec.id}-body`,
        0,
        bottomUm,
        widthUm,
        heightUm - bottomUm,
      ),
      holes: []
    },
    ...panel.bottomTabs.map((tab) => ({
      outer: rectangleContour(
        `${tab.id}-solid`,
        tab.startUm,
        bottomUm - tab.depthUm,
        tab.endUm - tab.startUm,
        tab.depthUm,
      ),
      holes: []
    }))
  ];
  const unioned = booleanRegions("union", solids, [], `${panel.spec.id}-solid`);
  if (unioned.length !== 1) {
    throw new Error(`Panel ${panel.spec.id} solids did not produce one connected region.`);
  }
  const notches: Region2D[] = [
    ...panel.leftNotches.map((notch) => ({
      outer: rectangleContour(
        `${notch.id}-left-notch`,
        0,
        notch.startUm,
        panel.thicknessUm,
        notch.endUm - notch.startUm,
      ),
      holes: []
    })),
    ...panel.rightNotches.map((notch) => ({
      outer: rectangleContour(
        `${notch.id}-right-notch`,
        widthUm - panel.thicknessUm,
        notch.startUm,
        panel.thicknessUm,
        notch.endUm - notch.startUm,
      ),
      holes: []
    }))
  ];
  const result = notches.length === 0
    ? unioned
    : booleanRegions("difference", unioned, notches, `${panel.spec.id}-profile`);
  if (result.length !== 1 || result[0]!.holes.length !== 0) {
    throw new Error(`Panel ${panel.spec.id} edge operations did not produce one hole-free region.`);
  }
  return {
    ...result[0]!.outer,
    id: `${panel.spec.id}-outer`
  };
}

export function localToWorld(
  panel: OrthogonalPanelProgramV1["panels"][number] | SheetPart,
  point: Vector3Um,
): Vector3Um {
  const { origin, xAxis, yAxis, zAxis } = "frame" in panel ? panel.frame : panel.assembledFrame;
  return {
    xUm: Math.round(origin.xUm + point.xUm * xAxis.x + point.yUm * yAxis.x + point.zUm * zAxis.x),
    yUm: Math.round(origin.yUm + point.xUm * xAxis.y + point.yUm * yAxis.y + point.zUm * zAxis.y),
    zUm: Math.round(origin.zUm + point.xUm * xAxis.z + point.yUm * yAxis.z + point.zUm * zAxis.z)
  };
}

export function worldToLocal(
  panel: OrthogonalPanelProgramV1["panels"][number] | SheetPart,
  point: Vector3Um,
): Vector3Um {
  const frame = "frame" in panel ? panel.frame : panel.assembledFrame;
  const delta = {
    xUm: point.xUm - frame.origin.xUm,
    yUm: point.yUm - frame.origin.yUm,
    zUm: point.zUm - frame.origin.zUm
  };
  return {
    xUm: Math.round(delta.xUm * frame.xAxis.x + delta.yUm * frame.xAxis.y + delta.zUm * frame.xAxis.z),
    yUm: Math.round(delta.xUm * frame.yAxis.x + delta.yUm * frame.yAxis.y + delta.zUm * frame.yAxis.z),
    zUm: Math.round(delta.xUm * frame.zAxis.x + delta.yUm * frame.zAxis.y + delta.zUm * frame.zAxis.z)
  };
}

export function worldBounds(points: readonly Vector3Um[]): { minimum: Vector3Um; maximum: Vector3Um } {
  return {
    minimum: {
      xUm: Math.min(...points.map((point) => point.xUm)),
      yUm: Math.min(...points.map((point) => point.yUm)),
      zUm: Math.min(...points.map((point) => point.zUm))
    },
    maximum: {
      xUm: Math.max(...points.map((point) => point.xUm)),
      yUm: Math.max(...points.map((point) => point.yUm)),
      zUm: Math.max(...points.map((point) => point.zUm))
    }
  };
}

export function panelToSheetPart(panel: PanelWork, materialProfileId: string): SheetPart {
  const outer = buildPanelOuter(panel);
  const region: Region2D = { outer, holes: panel.holes };
  const boundary: PartFeature = {
    id: `${panel.spec.id}-boundary`,
    kind: "outer-boundary",
    operation: "cut",
    fitClass: null,
    jointId: null,
    region,
    path: null,
    parametersUm: {
      bodyInsetBottom: panel.spec.bodyInsetUm.bottom
    }
  };
  return {
    schemaVersion: "1.0",
    id: panel.spec.id,
    name: panel.spec.name,
    role: "structural-panel",
    markingCode: panel.spec.markingCode,
    materialProfileId,
    thicknessUm: panel.thicknessUm,
    grainVector: panel.spec.grainVector,
    nominalRegion: region,
    features: [boundary, ...panel.features],
    assembledFrame: panel.spec.frame,
    explodedOffset: panel.spec.explodedOffset,
    assemblyDependencyPartIds: [],
    sourceOperator: {
      id: "orthogonal-panel-layout",
      version: "1.0.0"
    }
  };
}
