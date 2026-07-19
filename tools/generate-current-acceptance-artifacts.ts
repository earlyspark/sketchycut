import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const nextRoot = path.join(repositoryRoot, ".next");
const artifactRoot = path.join(repositoryRoot, "artifacts/m6.2");
const evidenceReportRoot = path.join(repositoryRoot, "docs/evidence/m06-2/reports");

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

async function fileRecord(file: string) {
  const bytes = await readFile(file);
  return {
    path: path.relative(artifactRoot, file).split(path.sep).join("/"),
    bytes: bytes.byteLength,
    sha256: sha256(bytes)
  };
}

const routeManifest = JSON.parse(
  await readFile(path.join(nextRoot, "app-path-routes-manifest.json"), "utf8"),
) as Record<string, string>;
const routes = [...new Set(Object.values(routeManifest))].sort();
const rootHtml = await readFile(path.join(nextRoot, "server/app/index.html"), "utf8");
const initialScripts = [...rootHtml.matchAll(/<script[^>]+src="\/_next\/(static\/[^"?]+\.js)/g)]
  .map((match) => path.join(nextRoot, match[1]!));
const initialClientBytes = (await Promise.all(initialScripts.map((file) => stat(file))))
  .reduce((sum, item) => sum + item.size, 0);
const rootServerEntry = path.join(nextRoot, "server/app/page.js");
const rootServerSource = await readFile(rootServerEntry, "utf8");
const rootServerChunkIds = /\.X\(0,\[([\d,]+)\]/.exec(rootServerSource)?.[1]
  ?.split(",").filter(Boolean) ?? [];
const rootServerFiles = [
  rootServerEntry,
  ...rootServerChunkIds.map((id) => path.join(nextRoot, "server/chunks", `${id}.js`))
];
const rootServerBundleBytes = (await Promise.all(rootServerFiles.map((file) => stat(file))))
  .reduce((sum, item) => sum + item.size, 0);
const staticFiles = await filesUnder(path.join(nextRoot, "static"));
const cssBytes = (await Promise.all(
  staticFiles.filter((file) => file.endsWith(".css")).map((file) => stat(file)),
)).reduce((sum, item) => sum + item.size, 0);
const lazyThreeChunks = [] as { path: string; bytes: number; sha256: string }[];
for (const file of staticFiles.filter((candidate) => candidate.endsWith(".js"))) {
  if (initialScripts.includes(file)) continue;
  const bytes = await readFile(file);
  const source = bytes.toString("utf8");
  if (/WebGLRenderer|REVISION:\s*["']185|three\.module/.test(source)) {
    lazyThreeChunks.push({
      path: path.relative(nextRoot, file).split(path.sep).join("/"),
      bytes: bytes.byteLength,
      sha256: sha256(bytes)
    });
  }
}

await mkdir(path.join(artifactRoot, "landing"), { recursive: true });
const copies = [
  ["src/landing/basic-demo-payload.json", "landing/payload.json"],
  ["public/landing/basic-demo-assembled.svg", "landing/assembled.svg"],
  ["public/landing/basic-demo-sheet.svg", "landing/sheet.svg"]
] as const;
for (const [source, destination] of copies) {
  await copyFile(path.join(repositoryRoot, source), path.join(artifactRoot, destination));
}

const landingManifest = JSON.parse(await readFile(
  path.join(repositoryRoot, "src/landing/basic-demo-static-manifest.json"),
  "utf8",
)) as {
  sourceDocumentHash: string;
  sheetHash: string;
  payloadSha256: string;
  assembledSvgSha256: string;
  sheetSvgSha256: string;
};
const acceptanceOutput = {
  schemaVersion: "sketchycut-current-acceptance-output@1.0.0",
  milestone: "M6.2",
  productionOrigin: "https://sketchycut.earlyspark.com",
  currentRoutes: routes,
  landing: landingManifest,
  build: {
    initialClientBytes,
    initialClientBudgetBytes: 592_345,
    rootServerBundleBytes,
    rootServerBudgetBytes: 601_384,
    rootSsrBytes: (await stat(path.join(nextRoot, "server/app/index.html"))).size,
    rootRscBytes: (await stat(path.join(nextRoot, "server/app/index.rsc"))).size,
    cssBytes,
    lazyThreeChunks
  },
  boundaries: {
    modelRequestsMadeByGeneration: 0,
    connectedUpstashCalls: 0,
    deployments: 0,
    physicalFabricationPerformed: false,
    physicalVerificationRequired: true
  }
};
await writeFile(
  path.join(evidenceReportRoot, "acceptance-output.json"),
  `${JSON.stringify(acceptanceOutput, null, 2)}\n`,
);

const generatedFiles = await filesUnder(artifactRoot);
const records = await Promise.all(generatedFiles.map(fileRecord));
const manifest = {
  schemaVersion: "sketchycut-current-artifact-manifest@1.0.0",
  milestone: "M6.2",
  files: records,
  artifactSetSha256: sha256(`${records.map((record) => [
    record.path,
    String(record.bytes),
    record.sha256
  ].join("\0")).join("\n")}\n`)
};
await writeFile(
  path.join(evidenceReportRoot, "current-artifact-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

for (const record of manifest.files) {
  const bytes = await readFile(path.join(artifactRoot, record.path));
  if (bytes.byteLength !== record.bytes || sha256(bytes) !== record.sha256) {
    throw new Error(`CURRENT_ACCEPTANCE_ARTIFACT_HASH:${record.path}`);
  }
}
process.stdout.write(
  `Generated ${String(manifest.files.length)} current acceptance artifacts with set ${manifest.artifactSetSha256}.\n`,
);
