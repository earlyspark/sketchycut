import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";

type OracleManifest = {
  boundary: {
    license: string;
    productionImportAllowed: boolean;
    runtimeLinkAllowed: boolean;
  };
  upstream: {
    revision: string;
  };
  referenceRun?: {
    parameters: Record<string, number>;
  };
  fixtures: {
    file: string;
    sha256: string;
    bytes: number;
    parameters?: Record<string, number | string>;
  }[];
};

async function readManifest(relativeUrl: string): Promise<{
  baseUrl: URL;
  manifest: OracleManifest;
}> {
  const manifestUrl = new URL(relativeUrl, import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as OracleManifest;
  return { baseUrl: new URL(".", manifestUrl), manifest };
}

async function verifyFixtures(baseUrl: URL, manifest: OracleManifest): Promise<void> {
  for (const fixture of manifest.fixtures) {
    const fileUrl = new URL(fixture.file, baseUrl);
    const bytes = await readFile(fileUrl);
    const metadata = await stat(fileUrl);
    expect(metadata.size).toBe(fixture.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
  }
}

describe("quarantined behavioral oracles", () => {
  it("pins Boxes.py generated SVG outputs without linking GPL production code", async () => {
    const { baseUrl, manifest } = await readManifest(
      "../fixtures/oracles/boxes-py/manifest.json",
    );
    expect(manifest.upstream.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.boundary).toMatchObject({
      license: "GPL-3.0-or-later",
      productionImportAllowed: false,
      runtimeLinkAllowed: false
    });
    expect(manifest.fixtures.every((fixture) => fixture.parameters !== undefined)).toBe(
      true,
    );
    await verifyFixtures(baseUrl, manifest);
    for (const fixture of manifest.fixtures) {
      const xml = await readFile(new URL(fixture.file, baseUrl), "utf8");
      const documentElement = new DOMParser().parseFromString(
        xml,
        "image/svg+xml",
      ).documentElement;
      expect(documentElement).not.toBeNull();
      expect(documentElement?.tagName).toBe("svg");
    }
  });

  it("pins permissive lasercut.scad assembled and flattened reference outputs", async () => {
    const { baseUrl, manifest } = await readManifest(
      "../fixtures/oracles/lasercut-scad/manifest.json",
    );
    expect(manifest.upstream.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.boundary).toMatchObject({
      license: "BSD-2-Clause",
      productionImportAllowed: false,
      runtimeLinkAllowed: false
    });
    expect(manifest.referenceRun?.parameters).toEqual({
      thicknessMm: 3.1,
      xMm: 100,
      yMm: 200,
      zMm: 50,
      heightMm: 75,
      nutFlatWidthMm: 7
    });
    await verifyFixtures(baseUrl, manifest);
    const csg = await readFile(new URL("examples.scad.csg", baseUrl), "utf8");
    const dxf = await readFile(new URL("examples_flattened.dxf", baseUrl), "utf8");
    expect(csg).toContain("group()");
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
  });
});
