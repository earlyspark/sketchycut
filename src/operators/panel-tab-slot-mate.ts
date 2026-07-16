import type { FitProfile, PartFeature } from "../domain/contracts.js";

import {
  localToWorld,
  rectangleContour,
  worldBounds,
  worldToLocal,
  type OrthogonalWork,
  type PanelWork,
  type Vector3Um
} from "./orthogonal-model.js";

export const PANEL_TAB_SLOT_MATE_OPERATOR = {
  id: "panel-tab-slot-mate",
  version: "1.0.0"
} as const;

function requirePanel(work: OrthogonalWork, partId: string): PanelWork {
  const panel = work.panels.get(partId);
  if (panel === undefined) {
    throw new Error(`Tab-slot mate references unknown panel ${partId}.`);
  }
  return panel;
}

function fitDeltaUm(fit: FitProfile, fitClass: "press" | "snug"): number {
  return Math.round(fit[fitClass].totalDeltaMm * 1_000);
}

function tabIntervals(
  widthUm: number,
  endInsetUm: number,
  tabCount: number,
  jointId: string,
): { id: string; startUm: number; endUm: number }[] {
  const usableUm = widthUm - endInsetUm * 2;
  if (usableUm <= 0) {
    throw new Error(`Joint ${jointId} has no usable edge span.`);
  }
  const pitchUm = Math.floor(usableUm / tabCount);
  const tabWidthUm = Math.floor(pitchUm * 0.55);
  if (tabWidthUm <= 0) {
    throw new Error(`Joint ${jointId} produces non-positive tabs.`);
  }
  return Array.from({ length: tabCount }, (_, index) => {
    const centerUm = endInsetUm + Math.floor(((index + 0.5) * usableUm) / tabCount);
    return {
      id: `${jointId}-tab-${String(index + 1)}`,
      startUm: centerUm - Math.floor(tabWidthUm / 2),
      endUm: centerUm + Math.ceil(tabWidthUm / 2)
    };
  });
}

function tabWorldPrism(
  panel: PanelWork,
  startUm: number,
  endUm: number,
  depthUm: number,
): Vector3Um[] {
  if (panel.spec.bodyInsetUm.bottom < depthUm) {
    throw new Error(`Panel ${panel.spec.id} tab depth exceeds its bottom body inset.`);
  }
  return [
    localToWorld(panel.spec, { xUm: startUm, yUm: panel.spec.bodyInsetUm.bottom - depthUm, zUm: 0 }),
    localToWorld(panel.spec, { xUm: endUm, yUm: panel.spec.bodyInsetUm.bottom - depthUm, zUm: 0 }),
    localToWorld(panel.spec, { xUm: startUm, yUm: panel.spec.bodyInsetUm.bottom, zUm: panel.thicknessUm }),
    localToWorld(panel.spec, { xUm: endUm, yUm: panel.spec.bodyInsetUm.bottom, zUm: panel.thicknessUm })
  ];
}

function openingContour(
  id: string,
  opening: PanelWork,
  worldPoints: readonly Vector3Um[],
  clearanceUm: number,
): {
  contour: ReturnType<typeof rectangleContour>;
  bounds: ReturnType<typeof worldBounds>;
  clearanceAxis: PanelWork["spec"]["frame"]["xAxis"];
} {
  const local = worldPoints.map((point) => worldToLocal(opening.spec, point));
  const xValues = local.map((point) => point.xUm);
  const yValues = local.map((point) => point.yUm);
  const zValues = local.map((point) => point.zUm);
  if (Math.min(...zValues) < -1 || Math.max(...zValues) > opening.thicknessUm + 1) {
    throw new Error(`Insert tab for ${opening.spec.id} does not pass through the opening thickness.`);
  }
  const minXUm = Math.min(...xValues);
  const maxXUm = Math.max(...xValues);
  const minYUm = Math.min(...yValues);
  const maxYUm = Math.max(...yValues);
  const xSpanUm = maxXUm - minXUm;
  const ySpanUm = maxYUm - minYUm;
  const thicknessRunsAlongX = Math.abs(xSpanUm - opening.thicknessUm) <= Math.abs(ySpanUm - opening.thicknessUm);
  const xDeltaUm = thicknessRunsAlongX ? clearanceUm : 0;
  const yDeltaUm = thicknessRunsAlongX ? 0 : clearanceUm;
  const xStartUm = minXUm - Math.floor(xDeltaUm / 2);
  const yStartUm = minYUm - Math.floor(yDeltaUm / 2);
  return {
    contour: rectangleContour(
      `${id}-contour`,
      xStartUm,
      yStartUm,
      xSpanUm + xDeltaUm,
      ySpanUm + yDeltaUm,
      "cw",
    ),
    bounds: worldBounds(worldPoints),
    clearanceAxis: thicknessRunsAlongX ? opening.spec.frame.xAxis : opening.spec.frame.yAxis
  };
}

export function applyPanelTabSlotMates(work: OrthogonalWork, fit: FitProfile): OrthogonalWork {
  for (const mate of work.program.tabSlotMates) {
    if (mate.insertEdge !== "bottom") {
      throw new Error(`Joint ${mate.id} requires unsupported insert edge ${mate.insertEdge}.`);
    }
    const insert = requirePanel(work, mate.insertPartId);
    const opening = requirePanel(work, mate.openingPartId);
    const clearanceUm = fitDeltaUm(fit, mate.fitClass);
    const intervals = tabIntervals(insert.spec.widthUm, mate.endInsetUm, mate.tabCount, mate.id);
    const insertFeatureIds: string[] = [];
    const openingFeatureIds: string[] = [];
    const mateBoundsWorldUm = [];
    let clearanceAxis: PanelWork["spec"]["frame"]["xAxis"] | undefined;

    for (const interval of intervals) {
      insert.bottomTabs.push({ ...interval, jointId: mate.id, depthUm: mate.tabDepthUm });
      const tabFeatureId = interval.id;
      const tabContour = rectangleContour(
        `${tabFeatureId}-contour`,
        interval.startUm,
        insert.spec.bodyInsetUm.bottom - mate.tabDepthUm,
        interval.endUm - interval.startUm,
        mate.tabDepthUm,
      );
      const tabFeature: PartFeature = {
        id: tabFeatureId,
        kind: "tab",
        operation: "cut",
        fitClass: mate.fitClass,
        jointId: mate.id,
        region: { outer: tabContour, holes: [] },
        path: null,
        parametersUm: {
          insertThickness: insert.thicknessUm,
          engagement: mate.tabDepthUm
        }
      };
      insert.features.push(tabFeature);
      insertFeatureIds.push(tabFeatureId);

      const worldPoints = tabWorldPrism(insert, interval.startUm, interval.endUm, mate.tabDepthUm);
      const slot = openingContour(`${mate.id}-slot-${String(openingFeatureIds.length + 1)}`, opening, worldPoints, clearanceUm);
      clearanceAxis ??= slot.clearanceAxis;
      if (clearanceAxis !== slot.clearanceAxis) {
        const dot = clearanceAxis.x * slot.clearanceAxis.x +
          clearanceAxis.y * slot.clearanceAxis.y +
          clearanceAxis.z * slot.clearanceAxis.z;
        if (Math.abs(dot - 1) > 1e-9) {
          throw new Error(`Joint ${mate.id} produced inconsistent clearance axes.`);
        }
      }
      const slotFeatureId = `${mate.id}-slot-${String(openingFeatureIds.length + 1)}`;
      opening.holes.push(slot.contour);
      opening.features.push({
        id: slotFeatureId,
        kind: "slot",
        operation: "cut",
        fitClass: mate.fitClass,
        jointId: mate.id,
        region: { outer: slot.contour, holes: [] },
        path: null,
        parametersUm: {
          openingMinusInsert: clearanceUm,
          insertThickness: insert.thicknessUm
        }
      });
      openingFeatureIds.push(slotFeatureId);
      mateBoundsWorldUm.push({
        id: `${mate.id}-mate-${String(mateBoundsWorldUm.length + 1)}`,
        ...slot.bounds
      });
    }

    work.joints.push({
      schemaVersion: "1.0",
      id: mate.id,
      kind: "panel-tab-slot",
      between: [
        { partId: mate.insertPartId, featureId: insertFeatureIds[0]! },
        { partId: mate.openingPartId, featureId: openingFeatureIds[0]! }
      ],
      fitClass: mate.fitClass,
      nominalClearanceUm: clearanceUm,
      insertionDirection: { x: 0, y: 0, z: -1 },
      realization: {
        kind: "tab-slot",
        insertPartId: mate.insertPartId,
        openingPartId: mate.openingPartId,
        insertFeatureIds,
        openingFeatureIds,
        clearanceAxis: clearanceAxis ?? opening.spec.frame.yAxis,
        openingMinusInsertUm: clearanceUm,
        mateBoundsWorldUm
      }
    });
  }
  return work;
}
