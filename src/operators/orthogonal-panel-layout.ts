import type { MaterialProfile, OrthogonalPanelProgramV1 } from "../domain/contracts.js";

import type { OrthogonalWork, PanelWork } from "./orthogonal-model.js";

export const ORTHOGONAL_PANEL_LAYOUT_OPERATOR = {
  id: "orthogonal-panel-layout",
  version: "1.0.0"
} as const;

function dot(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function applyOrthogonalPanelLayout(
  program: OrthogonalPanelProgramV1,
  material: MaterialProfile,
): OrthogonalWork {
  const thicknessUm = Math.round(material.measuredThicknessMm * 1_000);
  const panels = new Map<string, PanelWork>(
    program.panels.map((panel) => {
      const axes = [panel.frame.xAxis, panel.frame.yAxis, panel.frame.zAxis];
      if (
        Math.abs(dot(axes[0]!, axes[1]!)) > 1e-9 ||
        Math.abs(dot(axes[0]!, axes[2]!)) > 1e-9 ||
        Math.abs(dot(axes[1]!, axes[2]!)) > 1e-9
      ) {
        throw new Error(`Panel ${panel.id} frame axes must be mutually orthogonal.`);
      }
      const panelWork: PanelWork = {
        spec: panel,
        thicknessUm,
        bottomTabs: [],
        leftNotches: [],
        rightNotches: [],
        holes: [],
        features: []
      };
      return [panel.id, panelWork];
    }),
  );
  return { program, panels, joints: [] };
}
