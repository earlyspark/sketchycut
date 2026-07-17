import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { sha256 } from "../src/domain/hash.js";

const OUTPUT_DIR = join(process.cwd(), "artifacts", "m3.1.1", "probes");

type Probe = {
  id: string;
  purpose: string;
  expectedRootMm: { width: number; height: number };
  expectedOccupiedMm: { width: number; height: number };
  svg: string;
};

function document(pathAttributes: string, extraMetadata: Record<string, string>): string {
  const metadata = JSON.stringify({
    schemaVersion: "1.0",
    milestone: "M3.1.1",
    scope: "non-processing-xTool-Studio-characterization",
    intendedOperation: "engrave",
    ...extraMetadata
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="25mm" viewBox="0 0 40 25">',
    `<metadata>${metadata}</metadata>`,
    '<g id="operation-engrave" data-operation="engrave" data-operation-label="Engrave area">',
    `<path id="engrave-probe-area" data-operation="engrave" d="M5 5 L35 5 L35 20 L5 20 Z" ${pathAttributes}/>`,
    "</g>",
    "</svg>",
    ""
  ].join("\n");
}

const probes: Probe[] = [
  {
    id: "engrave-fill-only",
    purpose: "Determine whether Studio imports a closed fill-only path as one selectable filled Engrave area without a separate outline operation.",
    expectedRootMm: { width: 40, height: 25 },
    expectedOccupiedMm: { width: 30, height: 15 },
    svg: document('fill="#111111" stroke="none"', { representation: "fill-only-no-stroke" })
  },
  {
    id: "engrave-fill-and-stroke",
    purpose: "Determine whether a matching fill and stroke supports color-layer grouping without creating a second outline operation.",
    expectedRootMm: { width: 40, height: 25 },
    expectedOccupiedMm: { width: 30, height: 15 },
    svg: document(
      'fill="#111111" stroke="#111111" stroke-width="0.1" vector-effect="non-scaling-stroke"',
      { representation: "fill-and-matching-stroke" },
    )
  },
  {
    id: "engrave-stroke-only-control",
    purpose: "Negative control showing how Studio treats the former outline-only representation.",
    expectedRootMm: { width: 40, height: 25 },
    expectedOccupiedMm: { width: 30, height: 15 },
    svg: document(
      'fill="none" stroke="#111111" stroke-width="0.1" vector-effect="non-scaling-stroke"',
      { representation: "stroke-only-control" },
    )
  }
];

await mkdir(OUTPUT_DIR, { recursive: true });
const manifest = {
  schemaVersion: "1.0",
  milestone: "M3.1.1",
  generator: "m3-1-1-studio-probe-generator@1.0.0",
  scope: "import-only-no-processing",
  processingPerformed: false,
  probes: await Promise.all(probes.map(async (probe) => {
    const filename = `${probe.id}.svg`;
    await writeFile(join(OUTPUT_DIR, filename), probe.svg, "utf8");
    return {
      id: probe.id,
      path: filename,
      purpose: probe.purpose,
      expectedRootMm: probe.expectedRootMm,
      expectedOccupiedMm: probe.expectedOccupiedMm,
      bytes: Buffer.byteLength(probe.svg),
      sha256: await sha256(probe.svg)
    };
  }))
};
await writeFile(
  join(OUTPUT_DIR, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
console.log(`Generated ${String(probes.length)} deterministic Studio probes in ${OUTPUT_DIR}.`);
