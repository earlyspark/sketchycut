import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  }))).flat().sort();
}

const evidenceFiles = [
  ...await filesUnder(path.join(root, "artifacts/m6.1")),
  ...await filesUnder(path.join(root, "docs/evidence/m06-1"))
].filter((candidate) => /\.(?:json|jsonl|ndjson|md|txt|svg|html|js)$/u.test(candidate));
const privatePrompt = await readFile(
  path.join(root, "docs/evidence/m05/runtime/interpretation-prompt.txt"),
  "utf8",
);
const forbidden = [
  /data:image\/(?:jpeg|png|webp);base64,/iu,
  /\bsk-[A-Za-z0-9_-]{12,}\b/u,
  /\/Users\/[A-Za-z0-9._-]+\//u,
  /\/(?:private\/)?var\/folders\//u,
  /"(?:rawProviderResponse|fullPrompt|systemPrompt|promptText|modelInstructions)"\s*:/u,
  /"(?:fileName|filename|originalName)"\s*:/iu
] as const;
for (const file of evidenceFiles) {
  const contents = await readFile(file, "utf8");
  if (forbidden.some((pattern) => pattern.test(contents)) ||
      contents.includes(privatePrompt.trim())) {
    throw new Error(`M61PRIV001_PRIVATE_EVIDENCE_CONTENT:${path.relative(root, file)}`);
  }
}

const developmentSource = await readFile(path.join(root, "tools/m61-development.ts"), "utf8");
for (const token of [
  'environment[name] = ""',
  'environment.SKETCHYCUT_LOCAL_ACCESS_CODE = ""',
  'SKETCHYCUT_TEST_MODE: "1"',
  'SKETCHYCUT_M6_STORE: "memory"'
]) {
  if (!developmentSource.includes(token)) {
    throw new Error(`M61PRIV002_FIXTURE_SANITIZATION_MISSING:${token}`);
  }
}

process.stdout.write(
  `Verified M6.1 fixture-variable shadowing and ${String(evidenceFiles.length)} privacy-safe independent artifact/evidence files.\n`,
);
