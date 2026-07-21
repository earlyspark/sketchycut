import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256 } from "../src/domain/hash.js";
import { PhysicalConfidenceInputSchema } from "../src/ui/content/physical-confidence-contracts.js";
import {
  buildPhysicalConfidenceArtifactSet,
  verifyPhysicalConfidenceAdjustmentSource
} from "../src/ui/content/physical-confidence.js";
import { buildPhysicalConfidenceObservationDraft } from
  "../src/ui/content/physical-confidence-observation.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowedRoot = path.join(repositoryRoot, "artifacts", "m7");

function usage(): never {
  throw new Error(
    "Usage: node --import tsx tools/generate-physical-confidence-artifacts.ts <input.json> (--dry-run | <artifacts/m7/output-directory>) [--replace-current] [--only=basic,hinged,sliding] [--adjustment-source=<artifacts/m7/package.zip>]",
  );
}

const candidateIds = ["basic", "hinged", "sliding"] as const;
type CandidateId = (typeof candidateIds)[number];

function parseOnlyArgument(argument: string | undefined): ReadonlySet<CandidateId> {
  if (argument === undefined) return new Set(candidateIds);
  if (!argument.startsWith("--only=")) usage();
  const requested = argument.slice("--only=".length).split(",");
  if (
    requested.length === 0 ||
    new Set(requested).size !== requested.length ||
    requested.some((candidate): candidate is string => !candidateIds.includes(candidate as CandidateId))
  ) usage();
  return new Set(requested as CandidateId[]);
}

async function requireEmptyDestination(destination: string): Promise<void> {
  try {
    const entries = await readdir(destination);
    if (entries.length > 0) throw new Error("PHYSICAL_CONFIDENCE_OUTPUT_NOT_EMPTY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function inspectDestination(
  destination: string,
  relative = "",
): Promise<{ files: string[]; directories: string[] }> {
  let entries;
  try {
    entries = await readdir(path.join(destination, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { files: [], directories: [] };
    }
    throw error;
  }
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    const candidate = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      directories.push(candidate);
      const nested = await inspectDestination(destination, candidate);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (entry.isFile()) {
      files.push(candidate);
    } else {
      throw new Error(`PHYSICAL_CONFIDENCE_OUTPUT_SPECIAL_ENTRY:${candidate}`);
    }
  }
  return { files: files.sort(), directories: directories.sort() };
}

async function requireReplaceableDestination(
  destination: string,
  expectedFiles: ReadonlySet<string>,
  preservedFiles: ReadonlyMap<string, Uint8Array | string>,
): Promise<void> {
  const existing = await inspectDestination(destination);
  const unexpectedFiles = existing.files.filter((candidate) => !expectedFiles.has(candidate));
  const unexpectedDirectories = existing.directories.filter((candidate) => candidate !== "review");
  if (unexpectedFiles.length > 0 || unexpectedDirectories.length > 0) {
    throw new Error(
      `PHYSICAL_CONFIDENCE_OUTPUT_UNEXPECTED_ENTRY:${[
        ...unexpectedDirectories,
        ...unexpectedFiles
      ].join(",")}`,
    );
  }
  const existingFiles = new Set(existing.files);
  for (const [relativePath, expected] of preservedFiles) {
    // A destination created with --only contains no unselected candidate
    // package to preserve. When one is present, its bytes remain an exact
    // non-overwrite guard just as they are for a complete artifact set.
    if (!existingFiles.has(relativePath)) continue;
    const actual = new Uint8Array(await readFile(path.join(destination, relativePath)));
    const expectedBytes = typeof expected === "string"
      ? new TextEncoder().encode(expected)
      : expected;
    if (
      actual.byteLength !== expectedBytes.byteLength ||
      await sha256(actual) !== await sha256(expectedBytes)
    ) {
      throw new Error(`PHYSICAL_CONFIDENCE_OUTPUT_PRESERVED_FILE_MISMATCH:${relativePath}`);
    }
  }
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  const outputArgument = process.argv[3];
  const dryRun = outputArgument === "--dry-run";
  const options = process.argv.slice(4);
  const replacementMode = options.includes("--replace-current");
  const onlyArguments = options.filter((argument) => argument.startsWith("--only="));
  const adjustmentSourceArguments = options.filter((argument) =>
    argument.startsWith("--adjustment-source=")
  );
  if (
    inputPath === undefined ||
    outputArgument === undefined ||
    (dryRun && replacementMode) ||
    onlyArguments.length > 1 ||
    adjustmentSourceArguments.length > 1 ||
    options.some((argument) =>
      argument !== "--replace-current" &&
      !argument.startsWith("--only=") &&
      !argument.startsWith("--adjustment-source=")
    ) ||
    options.length > 3
  ) usage();
  const selectedCandidateIds = parseOnlyArgument(onlyArguments[0]);
  const destination = dryRun ? null : path.resolve(repositoryRoot, outputArgument);
  if (
    destination !== null &&
    destination !== allowedRoot &&
    !destination.startsWith(`${allowedRoot}${path.sep}`)
  ) throw new Error("PHYSICAL_CONFIDENCE_OUTPUT_OUTSIDE_ARTIFACT_ROOT");
  const input = PhysicalConfidenceInputSchema.parse(
    JSON.parse(await readFile(path.resolve(inputPath), "utf8")) as unknown,
  );
  const adjustmentSourcePath = adjustmentSourceArguments[0]?.slice(
    "--adjustment-source=".length,
  );
  const resolvedAdjustmentSourcePath = adjustmentSourcePath === undefined
    ? null
    : path.resolve(repositoryRoot, adjustmentSourcePath);
  if (
    resolvedAdjustmentSourcePath !== null &&
    resolvedAdjustmentSourcePath !== allowedRoot &&
    !resolvedAdjustmentSourcePath.startsWith(`${allowedRoot}${path.sep}`)
  ) throw new Error("PHYSICAL_CONFIDENCE_ADJUSTMENT_SOURCE_OUTSIDE_ARTIFACT_ROOT");
  const adjustmentSources = resolvedAdjustmentSourcePath === null
    ? []
    : [await verifyPhysicalConfidenceAdjustmentSource(
        new Uint8Array(await readFile(resolvedAdjustmentSourcePath)),
      )];
  const built = await buildPhysicalConfidenceArtifactSet(input, {
    productAdjustmentSources: adjustmentSources
  });
  const selectedPackages = built.packages.filter((artifactPackage) =>
    selectedCandidateIds.has(artifactPackage.candidateId)
  );
  const completeAllowlist = new Set(built.packages.flatMap((artifactPackage) => [
    artifactPackage.filename,
    ...[...artifactPackage.reviewFiles.keys()].map((filename) => `review/${filename}`)
  ]).concat(
    [...built.sharedReviewFiles.keys()].map((filename) => `review/${filename}`),
  ));
  const preservedFiles = new Map<string, Uint8Array | string>();
  for (const artifactPackage of built.packages) {
    if (selectedCandidateIds.has(artifactPackage.candidateId)) continue;
    const adjustmentSource = adjustmentSources.find((source) =>
      source.manifest.candidateId === artifactPackage.candidateId
    );
    if (adjustmentSource !== undefined) {
      preservedFiles.set(artifactPackage.filename, adjustmentSource.packageBytes);
      for (const [filename, contents] of adjustmentSource.reviewFiles) {
        preservedFiles.set(`review/${filename}`, contents);
      }
      continue;
    }
    preservedFiles.set(artifactPackage.filename, artifactPackage.bytes);
    for (const [filename, contents] of artifactPackage.reviewFiles) {
      preservedFiles.set(`review/${filename}`, contents);
    }
  }
  const written: { path: string; bytes: number; sha256: string }[] = [];
  if (destination !== null) {
    if (replacementMode) {
      await requireReplaceableDestination(destination, completeAllowlist, preservedFiles);
      for (const source of adjustmentSources) {
        if (selectedCandidateIds.has(source.manifest.candidateId)) continue;
        const templatePath = path.join(
          destination,
          "review",
          `${source.manifest.candidateId}-physical-observation-template.json`,
        );
        const template = JSON.parse(await readFile(templatePath, "utf8")) as {
          binding?: { candidateId?: unknown; packageSha256?: unknown };
        };
        if (
          template.binding?.candidateId !== source.manifest.candidateId ||
          template.binding.packageSha256 !== source.packageSha256
        ) {
          throw new Error(
            `PHYSICAL_CONFIDENCE_OUTPUT_PRESERVED_TEMPLATE_MISMATCH:${source.manifest.candidateId}`,
          );
        }
      }
    } else {
      await requireEmptyDestination(destination);
    }
    await mkdir(path.join(destination, "review"), { recursive: true });
    for (const artifactPackage of selectedPackages) {
      const packagePath = path.join(destination, artifactPackage.filename);
      await writeFile(packagePath, artifactPackage.bytes);
      written.push({
        path: path.relative(repositoryRoot, packagePath),
        bytes: artifactPackage.bytes.byteLength,
        sha256: artifactPackage.sha256
      });
      for (const [filename, contents] of artifactPackage.reviewFiles) {
        const reviewPath = path.join(destination, "review", filename);
        await writeFile(reviewPath, contents, "utf8");
        written.push({
          path: path.relative(repositoryRoot, reviewPath),
          bytes: Buffer.byteLength(contents),
          sha256: await sha256(contents)
        });
      }
    }
    for (const source of adjustmentSources) {
      if (selectedCandidateIds.has(source.manifest.candidateId)) continue;
      const filename = `${source.manifest.candidateId}-physical-observation-template.json`;
      const contents = `${JSON.stringify(
        buildPhysicalConfidenceObservationDraft(source.packageSha256, source.manifest),
      )}\n`;
      const reviewPath = path.join(destination, "review", filename);
      await writeFile(reviewPath, contents, "utf8");
      written.push({
        path: path.relative(repositoryRoot, reviewPath),
        bytes: Buffer.byteLength(contents),
        sha256: await sha256(contents)
      });
    }
    for (const [filename, contents] of built.sharedReviewFiles) {
      const reviewPath = path.join(destination, "review", filename);
      await writeFile(reviewPath, contents, "utf8");
      written.push({
        path: path.relative(repositoryRoot, reviewPath),
        bytes: Buffer.byteLength(contents),
        sha256: await sha256(contents)
      });
    }
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: "sketchycut-physical-confidence-generation-result@1.2.0",
    writeMode: dryRun
      ? "dry-run"
      : replacementMode
        ? "replace-current-allowlist"
        : "new-empty-destination",
    stage: built.summary.stage,
    inputHash: built.summary.inputHash,
    runtimeModelCalls: built.summary.runtimeModelCalls,
    physicalVerification: built.summary.physicalVerification,
    material: built.summary.material,
    cutWidth: built.summary.cutWidth,
    fitProfileHashes: built.summary.fitProfileHashes,
    processRecipeHash: built.summary.processRecipeHash,
    retainedPin: built.summary.retainedPin,
    packages: selectedPackages.map((item) => ({
      candidateId: item.candidateId,
      filename: item.filename,
      bytes: item.bytes.byteLength,
      sha256: item.sha256,
      evaluatedDocumentHash: item.manifest.evaluatedDocumentHash,
      geometryHash: item.manifest.geometryHash,
      productSheets: item.manifest.artifactGroups[0]!.sheets,
      materialFitCouponSheets: item.manifest.artifactGroups[1]!.sheets,
      cutWidthTestSheets: item.manifest.artifactGroups[2]!.sheets
    })),
    written: written.sort((left, right) => left.path.localeCompare(right.path))
  }, null, 2)}\n`);
}

await main();
