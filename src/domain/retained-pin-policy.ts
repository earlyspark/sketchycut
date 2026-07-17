export const RETAINED_PIN_GEOMETRY_POLICY = {
  id: "retained-pin-geometry-policy",
  version: "1.0.0",
  minimumLigamentUm: 1_500,
  lobeMarginUm: 1_000,
  panelAxisGapUm: 2_000,
  radiusQuantumUm: 100
} as const;

export function retainedPinGeometryDimensions(input: {
  measuredPinDiameterUm: number;
  totalDiametralClearanceUm: number;
  machineMinimumFeatureUm: number;
}): {
  boreDiameterUm: number;
  minimumBoreLigamentUm: number;
  leafRadiusUm: number;
  panelAxisOffsetUm: number;
} {
  const boreDiameterUm =
    input.measuredPinDiameterUm + input.totalDiametralClearanceUm;
  const minimumBoreLigamentUm = Math.max(
    input.machineMinimumFeatureUm,
    RETAINED_PIN_GEOMETRY_POLICY.minimumLigamentUm,
  );
  const rawRadiusUm =
    boreDiameterUm / 2 +
    minimumBoreLigamentUm +
    RETAINED_PIN_GEOMETRY_POLICY.lobeMarginUm;
  const leafRadiusUm = Math.ceil(
    rawRadiusUm / RETAINED_PIN_GEOMETRY_POLICY.radiusQuantumUm,
  ) * RETAINED_PIN_GEOMETRY_POLICY.radiusQuantumUm;
  return {
    boreDiameterUm,
    minimumBoreLigamentUm,
    leafRadiusUm,
    panelAxisOffsetUm:
      leafRadiusUm + RETAINED_PIN_GEOMETRY_POLICY.panelAxisGapUm
  };
}
