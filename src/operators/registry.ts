import { CALIBRATION_COUPON_OPERATOR } from "./calibration-coupon.js";

export type RegisteredOperator = {
  id: string;
  version: string;
};

export const REGISTERED_OPERATORS: readonly RegisteredOperator[] = [
  CALIBRATION_COUPON_OPERATOR
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
