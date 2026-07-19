import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceReport = path.join(
  repositoryRoot,
  "docs/evidence/m06-2/reports/working-byte-snapshot-source.json",
);

function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const sourceOutput = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: repositoryRoot },
);
const sourcePaths = sourceOutput.toString("utf8").split("\0").filter(Boolean).sort();
const snapshotRoot = await mkdtemp(path.join(tmpdir(), "sketchycut-working-bytes-"));
const entries: { path: string; bytes: number; mode: string; sha256: string }[] = [];

for (const sourcePath of sourcePaths) {
  if (path.isAbsolute(sourcePath) || sourcePath.split("/").includes("..")) {
    throw new Error(`WORKING_BYTE_SNAPSHOT_UNSAFE_PATH:${sourcePath}`);
  }
  const topLevel = sourcePath.split("/")[0];
  if ([".git", "docs", "artifacts", "node_modules", ".next", ".next-fixtures"].includes(topLevel ?? "")) {
    throw new Error(`WORKING_BYTE_SNAPSHOT_PRIVATE_PATH:${sourcePath}`);
  }
  if (/^\.env(?:\.|$)/u.test(sourcePath)) {
    throw new Error(`WORKING_BYTE_SNAPSHOT_ENV_PATH:${sourcePath}`);
  }
  const source = path.join(repositoryRoot, sourcePath);
  let sourceStats;
  try {
    sourceStats = await lstat(source);
  } catch {
    // Deleted tracked paths are present in the Git index but absent from the current bytes.
    continue;
  }
  const destination = path.join(snapshotRoot, sourcePath);
  await mkdir(path.dirname(destination), { recursive: true });
  if (sourceStats.isSymbolicLink()) {
    const target = await readlink(source);
    await symlink(target, destination);
    entries.push({
      path: sourcePath,
      bytes: Buffer.byteLength(target),
      mode: (sourceStats.mode & 0o777).toString(8).padStart(4, "0"),
      sha256: digest(target)
    });
    continue;
  }
  if (!sourceStats.isFile()) throw new Error(`WORKING_BYTE_SNAPSHOT_UNSUPPORTED_ENTRY:${sourcePath}`);
  await copyFile(source, destination);
  await chmod(destination, sourceStats.mode & 0o777);
  const bytes = await readFile(destination);
  entries.push({
    path: sourcePath,
    bytes: bytes.byteLength,
    mode: (sourceStats.mode & 0o777).toString(8).padStart(4, "0"),
    sha256: digest(bytes)
  });
}

const manifestBytes = `${entries.map((entry) => [
  entry.path,
  entry.mode,
  String(entry.bytes),
  entry.sha256
].join("\0")).join("\n")}\n`;
await mkdir(path.dirname(evidenceReport), { recursive: true });
await writeFile(evidenceReport, `${JSON.stringify({
  schemaVersion: "sketchycut-working-byte-source@1.0.0",
  generatedAt: new Date().toISOString(),
  sourceCommand: "git ls-files --cached --others --exclude-standard -z",
  snapshotRoot,
  sourceEntryCount: entries.length,
  sourceBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  sourceManifestSha256: digest(manifestBytes),
  excludedRoots: [".git", "docs", "artifacts", "node_modules", ".next", ".next-fixtures"],
  environmentFilesCopied: 0,
  entries
}, null, 2)}\n`);
process.stdout.write(`${snapshotRoot}\n`);
