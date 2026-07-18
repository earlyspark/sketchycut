import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

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

const privatePromptPath = path.join(
  repositoryRoot,
  "docs/evidence/m05/runtime/interpretation-prompt.txt",
);
const evidenceFiles = (
  await Promise.all([
    filesUnder(path.join(repositoryRoot, "artifacts/m5")),
    filesUnder(path.join(repositoryRoot, "public/m5")),
    filesUnder(path.join(repositoryRoot, "docs/evidence/m05"))
  ])
).flat().filter((candidate) =>
  candidate !== privatePromptPath &&
  /\.(?:json|jsonl|ndjson|md|txt|svg|html|js)$/.test(candidate)
);

const forbiddenPatterns = [
  { id: "M5PRIV001_RAW_IMAGE_DATA_URL", pattern: /data:image\/(?:jpeg|png|webp);base64,/i },
  { id: "M5PRIV002_SECRET_SHAPE", pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/ },
  { id: "M5PRIV003_ABSOLUTE_USER_PATH", pattern: /\/Users\/[A-Za-z0-9._-]+\// },
  { id: "M5PRIV004_TEMPORARY_LOCAL_PATH", pattern: /\/(?:private\/)?var\/folders\// },
  { id: "M5PRIV005_RAW_PROVIDER_RESPONSE", pattern: /"rawProviderResponse"\s*:/ },
  { id: "M5PRIV006_FULL_PROMPT", pattern: /"(?:fullPrompt|systemPrompt|promptText|modelInstructions)"\s*:/ },
  { id: "M5PRIV007_FILENAME_FIELD", pattern: /"(?:fileName|filename|originalName)"\s*:/i }
] as const;

for (const file of evidenceFiles) {
  const source = await readFile(file, "utf8");
  for (const { id, pattern } of forbiddenPatterns) {
    if (pattern.test(source)) {
      throw new Error(`${id}: ${path.relative(repositoryRoot, file)}`);
    }
  }
}

const privatePrompt = await readFile(privatePromptPath, "utf8");
if (privatePrompt.trim().length < 200) throw new Error("M5PRIV010_PRIVATE_PROMPT_MISSING");
for (const file of evidenceFiles) {
  if ((await readFile(file, "utf8")).includes(privatePrompt.trim())) {
    throw new Error(`M5PRIV011_PRIVATE_PROMPT_COPIED_TO_EVIDENCE: ${path.relative(repositoryRoot, file)}`);
  }
}

const sidecarSource = await readFile(path.join(repositoryRoot, "tools/m5-sidecar.ts"), "utf8");
for (const unsafeLogShape of [
  /console\.(?:log|info|warn|error)\s*\([^)]*(?:submission|request|prompt|dataUrl)/,
  /process\.(?:stdout|stderr)\.write\s*\([^)]*(?:submission|request|prompt|dataUrl)/
]) {
  if (unsafeLogShape.test(sidecarSource)) {
    throw new Error("M5PRIV008_REQUEST_CONTENT_LOGGING_PRESENT");
  }
}

const actualKeyReaders: string[] = [];
for (const candidate of await filesUnder(path.join(repositoryRoot, "tools"))) {
  if (!/\.(?:ts|tsx|js|mjs)$/.test(candidate)) continue;
  if (/(?:process\.env|environment)\.OPENAI_API_KEY/.test(await readFile(candidate, "utf8"))) {
    actualKeyReaders.push(path.relative(repositoryRoot, candidate));
  }
}
if (JSON.stringify(actualKeyReaders) !== JSON.stringify(["tools/m5-sidecar.ts"])) {
  throw new Error(`M5PRIV009_KEY_READER_SCOPE_CHANGED: ${actualKeyReaders.join(",")}`);
}

process.stdout.write(
  `Verified M5 privacy across ${String(evidenceFiles.length)} artifact/evidence files; the private prompt is not copied, and the development-tools boundary retains one API-key reader with no request-content logging.\n`,
);
