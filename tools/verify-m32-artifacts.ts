import { readFile } from "node:fs/promises";

import { sha256 } from "../src/index.js";

const root = new URL("../artifacts/m3.2/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("artifact-manifest.json", root), "utf8")) as {
  schemaVersion: string;
  milestone: string;
  runtimeApplicationApiCalls: number;
  physicalVerification: string;
  artifacts: { path: string; bytes: number; sha256: string }[];
};
if (
  manifest.schemaVersion !== "1.0" ||
  manifest.milestone !== "M3.2" ||
  manifest.runtimeApplicationApiCalls !== 0 ||
  manifest.physicalVerification !== "required"
) {
  throw new Error("M3.2 artifact manifest metadata is invalid.");
}
for (const artifact of manifest.artifacts) {
  const contents = await readFile(new URL(artifact.path, root), "utf8");
  if (new TextEncoder().encode(contents).length !== artifact.bytes) {
    throw new Error(`M3.2 artifact byte count drifted: ${artifact.path}.`);
  }
  if (await sha256(contents) !== artifact.sha256) {
    throw new Error(`M3.2 artifact hash drifted: ${artifact.path}.`);
  }
}
const catalog = JSON.parse(await readFile(new URL("catalog-report.json", root), "utf8")) as {
  defaultExampleId: string;
  entries: { status: string; hasProgramAdapter: boolean }[];
  plannedDispatchCount: number;
};
if (
  catalog.defaultExampleId !== "basic-box" ||
  catalog.entries.filter((entry) => entry.status === "available").length !== 2 ||
  catalog.entries.some((entry) =>
    entry.status === "planned" && entry.hasProgramAdapter
  ) ||
  catalog.plannedDispatchCount !== 0
) {
  throw new Error("M3.2 guided catalog evidence is invalid.");
}
const ledger = JSON.parse(await readFile(new URL("identity-ledger.json", root), "utf8")) as {
  examples: {
    geometryHash: string;
    sourceDocumentHash: string;
    svgSha256: string;
    artifactSetHash: string;
    handoffSha256: string;
    runtimeApplicationApiCalls: number;
  }[];
  optionalFitTest: {
    sourceDocumentHash: string;
    svgSha256: string;
    artifactSetHash: string;
  };
  goldenSha256: Record<string, string>;
  runtimeApplicationApiCalls: number;
  physicalVerification: string;
};
const expectedExamples = [
  [
    "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    "17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad",
    "0c00350bb3ce195c2f0ed479acdb7c2fa8b54e594d6b161ad7b0c4365f0aae64",
    "67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c",
    "073c2a684df29b32fd698140fab72cfe6d98dd3a3bef407069d21643b7eeb4dc"
  ],
  [
    "cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664",
    "0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381",
    "622314744940326893a8509d648b907bec2a26b9d639ae2c31ea5648338ffadc",
    "d2d84a1e03bb8da5d55048ec3d0efd7c3c2c08396f0766f515dc0d8435bde7e5",
    "3515f141e58cab2f661dc7af368fef4db5db016717533cc382ae6b908af0b56e"
  ]
] as const;
for (const [index, expected] of expectedExamples.entries()) {
  const observed = ledger.examples[index];
  if (observed === undefined || [
    observed.geometryHash,
    observed.sourceDocumentHash,
    observed.svgSha256,
    observed.artifactSetHash,
    observed.handoffSha256
  ].some((value, valueIndex) => value !== expected[valueIndex])) {
    throw new Error(`M3.2 protected example identity drifted at index ${String(index)}.`);
  }
  if (observed.runtimeApplicationApiCalls !== 0) {
    throw new Error("M3.2 example evidence recorded a runtime model call.");
  }
}
if (
  ledger.optionalFitTest.sourceDocumentHash !==
    "0f80a5523903ce9a206a13560848dcbe1b428514493ac5c7b24c7326815bb7dc" ||
  ledger.optionalFitTest.svgSha256 !==
    "2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc" ||
  ledger.optionalFitTest.artifactSetHash !==
    "770d918dfb4b1f193c04ee27e5c12601daeb6ed3c65eec01c4034c061d385a10"
) {
  throw new Error("M3.2 optional fit-test identity drifted.");
}
const expectedGoldenSha256 = {
  m1: "a2e02fa6cd6f58ad1ecf77eab38ea57427d4c4eb9b1b26665d4d9bf0b149dcb3",
  m2: "581178ac0c5a6beda54f452776b0f38e6d02b431a1692db184245f20379df042",
  m3: "c52ccd204a7f5b0929f25f86262729c93f17b3c85453e1e5c2d42781e6e63fcd",
  "m3.1-evaluated": "cff8dc972065574265251eff61a445dea726ed98dae06b3eec363d5201405b23"
};
if (JSON.stringify(ledger.goldenSha256) !== JSON.stringify(expectedGoldenSha256)) {
  throw new Error("M3.2 protected golden hashes drifted.");
}
const replay = JSON.parse(await readFile(new URL("switch-replay.json", root), "utf8")) as {
  basicReplay: Record<string, boolean>;
  fitTestAcrossSwitches: Record<string, boolean>;
  plannedProductCompilations: number;
  runtimeApplicationApiCalls: number;
};
if (
  Object.values(replay.basicReplay).some((value) => !value) ||
  Object.values(replay.fitTestAcrossSwitches).some((value) => !value) ||
  replay.plannedProductCompilations !== 0 ||
  replay.runtimeApplicationApiCalls !== 0 ||
  ledger.runtimeApplicationApiCalls !== 0 ||
  ledger.physicalVerification !== "required"
) {
  throw new Error("M3.2 switch replay evidence is invalid.");
}

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M3.2 artifacts, protected identities, and switch replay.\n`,
);
