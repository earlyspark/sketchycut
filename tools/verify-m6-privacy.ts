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

const serverFiles = (await filesUnder(path.join(repositoryRoot, "src/server/m6")))
  .filter((candidate) => /\.(?:ts|tsx|js|jsx)$/.test(candidate));
for (const file of serverFiles) {
  const source = await readFile(file, "utf8");
  if (/console\.(?:log|info|warn|error)\s*\(/.test(source) ||
      /process\.(?:stdout|stderr)\.write\s*\(/.test(source)) {
    throw new Error(`M6PRIV001_SERVER_LOGGING_PRESENT: ${path.relative(repositoryRoot, file)}`);
  }
}

const sourceFiles = (await filesUnder(path.join(repositoryRoot, "src")))
  .filter((candidate) => /\.(?:ts|tsx|js|jsx)$/.test(candidate));
const secretReaders = new Set<string>();
const sdkImporters: string[] = [];
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(repositoryRoot, file);
  for (const token of [
    "OPENAI_API_KEY",
    "SKETCHYCUT_ACCESS_CODE_SHA256",
    "SKETCHYCUT_SESSION_SIGNING_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "sketchycut_KV_REST_API_URL",
    "sketchycut_KV_REST_API_TOKEN",
    "SKETCHYCUT_INTERPRETATION_PROMPT"
  ]) {
    if (source.includes(token)) secretReaders.add(relative);
  }
  if (/from ["']openai["']/.test(source)) sdkImporters.push(relative);
}
if (JSON.stringify([...secretReaders].sort()) !== JSON.stringify(["src/server/m6/config.ts"])) {
  throw new Error(`M6PRIV002_SECRET_READER_SCOPE_CHANGED: ${[...secretReaders].sort().join(",")}`);
}
if (JSON.stringify(sdkImporters) !== JSON.stringify(["src/server/m6/openai-transport.ts"])) {
  throw new Error(`M6PRIV003_SDK_IMPORT_SCOPE_CHANGED: ${sdkImporters.join(",")}`);
}

const staticFiles = (await filesUnder(path.join(repositoryRoot, ".next/static")))
  .filter((candidate) => /\.(?:js|json|html|map)$/.test(candidate));
for (const file of staticFiles) {
  const source = await readFile(file, "utf8");
  for (const token of [
    "OPENAI_API_KEY",
    "SKETCHYCUT_ACCESS_CODE_SHA256",
    "SKETCHYCUT_SESSION_SIGNING_SECRET",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "sketchycut_KV_REST_API_URL",
    "sketchycut_KV_REST_API_TOKEN",
    "SKETCHYCUT_INTERPRETATION_PROMPT",
    "node_modules/openai/",
    "openai/resources/"
  ]) {
    if (source.includes(token)) {
      throw new Error(`M6PRIV004_CLIENT_SECRET_OR_ADAPTER_TOKEN: ${path.relative(repositoryRoot, file)} contains ${token}`);
    }
  }
}

const privatePromptPath = path.join(repositoryRoot, "docs/evidence/m05/runtime/interpretation-prompt.txt");
const evidenceFiles = (await filesUnder(path.join(repositoryRoot, "docs/evidence/m06")))
  .filter((candidate) => /\.(?:json|jsonl|ndjson|md|txt|svg|html|js)$/.test(candidate));
const privatePrompt = await readFile(privatePromptPath, "utf8");
const forbiddenPatterns = [
  /data:image\/(?:jpeg|png|webp);base64,/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\/Users\/[A-Za-z0-9._-]+\//,
  /\/(?:private\/)?var\/folders\//,
  /"(?:rawProviderResponse|fullPrompt|systemPrompt|promptText|modelInstructions)"\s*:/,
  /"(?:fileName|filename|originalName)"\s*:/i
] as const;
for (const file of evidenceFiles) {
  const source = await readFile(file, "utf8");
  if (forbiddenPatterns.some((pattern) => pattern.test(source))) {
    throw new Error(`M6PRIV005_PRIVATE_EVIDENCE_CONTENT: ${path.relative(repositoryRoot, file)}`);
  }
  if (source.includes(privatePrompt.trim())) {
    throw new Error(`M6PRIV006_PRIVATE_PROMPT_COPIED: ${path.relative(repositoryRoot, file)}`);
  }
}

const projectSource = await readFile(
  path.join(repositoryRoot, "src/server/m6/project-persistence.ts"),
  "utf8",
);
for (const token of ["dataUrl", "normalizedBrief", "fileName", "filename", "rawProviderResponse"] ) {
  if (projectSource.includes(token)) {
    throw new Error(`M6PRIV007_PERSISTED_PROJECT_PRIVATE_FIELD: ${token}`);
  }
}

const vercelIgnore = new Set(
  (await readFile(path.join(repositoryRoot, ".vercelignore"), "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")),
);
for (const requiredPattern of ["docs/", "AGENTS.md", ".env", ".env.*", "artifacts/", "tests/", "tools/"]) {
  if (!vercelIgnore.has(requiredPattern)) {
    throw new Error(`M6PRIV008_DEPLOYMENT_IGNORE_MISSING: ${requiredPattern}`);
  }
}

process.stdout.write(
  `Verified M6 server reader/import confinement, deployment-context exclusions, no server request logging, client-bundle isolation, minimal project persistence, and ${String(evidenceFiles.length)} privacy-safe evidence files.\n`,
);
