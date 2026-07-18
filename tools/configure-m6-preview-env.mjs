import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ACCESS_CODE_PATH = "/private/tmp/sketchycut-m6-preview-access-code";

function addPreviewVariable(name, value, { sensitive = false } = {}) {
  const args = ["vercel", "env", "add", name, "preview", "--force"];
  if (sensitive) args.push("--sensitive");
  const result = spawnSync("npx", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: value,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    throw new Error(`M6_PREVIEW_ENV_ADD_FAILED:${name}:${String(result.status)}`);
  }
  process.stdout.write(`Configured preview variable ${name}.\n`);
}

const accessCode = randomBytes(32).toString("base64url");
const accessDigest = createHash("sha256").update(accessCode, "utf8").digest("hex");
const signingSecret = randomBytes(48).toString("base64url");

writeFileSync(ACCESS_CODE_PATH, accessCode, { encoding: "utf8", mode: 0o600 });
chmodSync(ACCESS_CODE_PATH, 0o600);

addPreviewVariable("SKETCHYCUT_ACCESS_CODE_SHA256", accessDigest, { sensitive: true });
addPreviewVariable("SKETCHYCUT_SESSION_SIGNING_SECRET", signingSecret, { sensitive: true });
addPreviewVariable("SKETCHYCUT_M6_STORE", "upstash");
addPreviewVariable("SKETCHYCUT_GENERATION_ENABLED", "1");
addPreviewVariable("SKETCHYCUT_GENERATION_MODE", "replay");
addPreviewVariable("SKETCHYCUT_FIXTURE_MODE", "1");

process.stdout.write(`Stored the temporary preview access code at ${ACCESS_CODE_PATH} with mode 0600.\n`);
