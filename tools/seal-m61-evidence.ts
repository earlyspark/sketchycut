import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ExistingManifest = {
  entries: { path: string; sha256: string }[];
};

type FrozenBaselines = {
  immutableTrees: { root: string; entryCount: number; sha256: string }[];
};

type LiveEvidence = {
  status: "pass-quality-follow-up-required";
  summary: {
    runtimeApplicationApiCalls: number;
    confirmedEstimatedCostUsd: number;
    unresolvedPotentialExposureUsd: number;
  };
};

const repositoryRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const manifestPath = path.join(repositoryRoot, "docs/evidence/m06-1/manifest.json");

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function artifactPaths(): Promise<string[]> {
  const names = await readdir(path.join(repositoryRoot, "artifacts/m6.1"));
  return names.sort().map((name) => `artifacts/m6.1/${name}`);
}

function currentWorktree() {
  const porcelain = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  const entries = porcelain.trimEnd().split("\n").filter(Boolean);
  return {
    porcelainSha256: sha256(porcelain),
    entryCount: entries.length,
    trackedModifiedCount: entries.filter((entry) => !entry.startsWith("??")).length,
    untrackedCount: entries.filter((entry) => entry.startsWith("??")).length
  };
}

const existing = JSON.parse(await readFile(manifestPath, "utf8")) as ExistingManifest;
const frozen = JSON.parse(await readFile(
  path.join(repositoryRoot, "artifacts/m6.1/frozen-baselines.json"),
  "utf8",
)) as FrozenBaselines;
const additions = [
  "docs/ARCHITECTURE.md",
  "docs/CAPABILITY_MATRIX.md",
  "docs/M6_1_1_INTENT_CONDITIONED_DESIGN_AND_REVISION_PLAN.md",
  "docs/M6_1_1_INTENT_CONDITIONED_CONSTRUCTION_AND_INTERNAL_REVIEW_PROPOSAL.md",
  "docs/evidence/m06-1/live/live-evaluation.json",
  "tests/server/m61-runtime.test.ts",
  "tools/capture-m61-live-evidence.ts",
  "tools/m5-replay-artifacts-lib.ts",
  "tools/m6-artifacts-lib.ts",
  "tools/seal-m61-evidence.ts"
];
const entryPaths = [...new Set([
  ...existing.entries.map((entry) => entry.path),
  ...await artifactPaths(),
  ...additions
])].sort();
const entries = await Promise.all(entryPaths.map(async (relativePath) => ({
  path: relativePath,
  sha256: sha256(await readFile(path.join(repositoryRoot, relativePath)))
})));
const artifactManifest = await readFile(
  path.join(repositoryRoot, "artifacts/m6.1/artifact-manifest.json"),
);
const liveEvidence = JSON.parse(await readFile(
  path.join(repositoryRoot, "docs/evidence/m06-1/live/live-evaluation.json"),
  "utf8",
)) as LiveEvidence;
const manifest = {
  schemaVersion: "1.0",
  milestone: "M6.1",
  status: "complete-software-validated-live-quality-follow-up",
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim(),
  worktree: currentWorktree(),
  immutableTrees: frozen.immutableTrees,
  artifactManifestSha256: sha256(artifactManifest),
  runtimeApplicationApiCalls: liveEvidence.summary.runtimeApplicationApiCalls,
  estimatedCostUsd: liveEvidence.summary.confirmedEstimatedCostUsd,
  unresolvedPotentialExposureUsd: liveEvidence.summary.unresolvedPotentialExposureUsd,
  liveBrowserStatus: liveEvidence.status,
  physicalVerification: "required-not-performed",
  entries,
  pendingEntries: []
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(
  `Sealed M6.1 evidence with ${String(entries.length)} hashed entries and current worktree identity.\n`,
);
