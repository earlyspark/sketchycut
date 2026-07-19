import type { SceneProjection, SheetProjection } from "../domain/contracts.js";

export const LANDING_PAYLOAD_VERSION = "sketchycut-landing-basic@1.0.0" as const;

export type LandingDemoPayload = {
  schemaVersion: "1.0";
  contractVersion: typeof LANDING_PAYLOAD_VERSION;
  source: {
    exampleId: "guided-example";
    presetId: "medium";
    sourceDocumentHash: string;
    geometryHash: string;
    sheetId: string;
    sheetHash: string;
    sheetSvgHash: string;
  };
  scene: SceneProjection;
  sheet: SheetProjection;
  markings: readonly { partId: string; markingCode: string }[];
  stockFootprintMm: { width: number; height: number };
};

export function readLandingDemoPayload(candidate: unknown): LandingDemoPayload {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("LANDING_PAYLOAD_INVALID");
  }
  const payload = candidate as {
    schemaVersion?: unknown;
    contractVersion?: unknown;
    source?: { exampleId?: unknown; presetId?: unknown };
    scene?: unknown;
    sheet?: unknown;
    markings?: unknown;
    stockFootprintMm?: unknown;
  };
  if (payload.schemaVersion !== "1.0" || payload.contractVersion !== LANDING_PAYLOAD_VERSION ||
      payload.source?.exampleId !== "guided-example" || payload.source.presetId !== "medium" ||
      payload.scene === undefined || payload.sheet === undefined || payload.markings === undefined ||
      payload.stockFootprintMm === undefined) {
    throw new Error("LANDING_PAYLOAD_VERSION_UNSUPPORTED");
  }
  return payload as LandingDemoPayload;
}
