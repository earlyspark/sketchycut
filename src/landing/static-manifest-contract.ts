export const LANDING_STATIC_MANIFEST_VERSION = "sketchycut-landing-static@1.0.0" as const;

export type LandingStaticManifest = {
  schemaVersion: "1.0";
  contractVersion: typeof LANDING_STATIC_MANIFEST_VERSION;
  sourceDocumentHash: string;
  sheetHash: string;
  assembledScene: { path: string; sha256: string };
  sheet: { path: string; sha256: string };
};

export function readLandingStaticManifest(candidate: unknown): LandingStaticManifest {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("LANDING_STATIC_MANIFEST_INVALID");
  }
  const manifest = candidate as Partial<LandingStaticManifest>;
  if (manifest.schemaVersion !== "1.0" ||
      manifest.contractVersion !== LANDING_STATIC_MANIFEST_VERSION ||
      typeof manifest.sourceDocumentHash !== "string" ||
      typeof manifest.sheetHash !== "string" ||
      typeof manifest.assembledScene?.path !== "string" ||
      typeof manifest.assembledScene.sha256 !== "string" ||
      typeof manifest.sheet?.path !== "string" ||
      typeof manifest.sheet.sha256 !== "string") {
    throw new Error("LANDING_STATIC_MANIFEST_VERSION_UNSUPPORTED");
  }
  return manifest as LandingStaticManifest;
}
