import type { OrthogonalPanelProgramV1 } from "../domain/contracts.js";

export const FIXED_TOP_FRAME_OPERATOR = {
  id: "fixed-top-frame",
  version: "1.0.0"
} as const;

export function requireFixedTopFrameProgram(
  program: OrthogonalPanelProgramV1,
): NonNullable<OrthogonalPanelProgramV1["fixedTopFrame"]> {
  const fixedTop = program.fixedTopFrame;
  if (fixedTop === null) {
    throw new Error("FIXED_TOP_FRAME_PROGRAM_REQUIRED");
  }
  const top = program.panels.find((panel) => panel.id === fixedTop.partId);
  if (top?.frame.zAxis.z !== 1) {
    throw new Error("FIXED_TOP_FRAME_HORIZONTAL_PANEL_REQUIRED");
  }
  const retainedJointIds = new Set(fixedTop.retainedByJointIds);
  if (
    retainedJointIds.size !== 4 ||
    program.tabSlotMates.filter((mate) => retainedJointIds.has(mate.id)).some((mate) =>
      mate.openingPartId !== fixedTop.partId || mate.insertEdge !== "top"
    )
  ) {
    throw new Error("FIXED_TOP_FRAME_RETENTION_INVALID");
  }
  return fixedTop;
}
