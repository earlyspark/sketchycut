import { ACCUMULATED_KERF_GAUGE_OPERATOR } from "./accumulated-kerf-gauge.js";
import { CALIBRATION_COUPON_OPERATOR } from "./calibration-coupon.js";
import { CAPTURED_PANEL_SLIDE_OPERATOR } from "./captured-panel-slide.js";
import { EDGE_FINGER_MATE_OPERATOR } from "./edge-finger-mate.js";
import { ORTHOGONAL_PANEL_LAYOUT_OPERATOR } from "./orthogonal-panel-layout.js";
import { PANEL_TAB_SLOT_MATE_OPERATOR } from "./panel-tab-slot-mate.js";
import { RETAINED_PIN_REVOLUTE_OPERATOR } from "./retained-pin-revolute.js";
import { SURFACE_TREATMENT_OPERATOR } from "./surface-treatment.js";

export type RegisteredOperator = {
  id: string;
  version: string;
};

export const REGISTERED_OPERATORS: readonly RegisteredOperator[] = [
  CALIBRATION_COUPON_OPERATOR,
  ACCUMULATED_KERF_GAUGE_OPERATOR,
  ORTHOGONAL_PANEL_LAYOUT_OPERATOR,
  PANEL_TAB_SLOT_MATE_OPERATOR,
  EDGE_FINGER_MATE_OPERATOR,
  RETAINED_PIN_REVOLUTE_OPERATOR,
  CAPTURED_PANEL_SLIDE_OPERATOR,
  SURFACE_TREATMENT_OPERATOR
] as const;

export function registeredOperatorVersions(): ReadonlyMap<string, string> {
  const versions = new Map<string, string>();
  for (const operator of REGISTERED_OPERATORS) {
    if (versions.has(operator.id)) {
      throw new Error(`Duplicate registered operator ID ${operator.id}.`);
    }
    versions.set(operator.id, operator.version);
  }
  return versions;
}
