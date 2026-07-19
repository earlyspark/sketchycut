import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevelopmentEnvironment } from "./development.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const nextBin = path.join(repositoryRoot, "node_modules/next/dist/bin/next");
const environment = buildDevelopmentEnvironment("fixtures", process.env);
const child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  env: environment,
  stdio: "inherit"
});
const exitCode = await new Promise<number>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal !== null) reject(new Error(`GENERATION_FIXTURE_START_SIGNAL_${signal}`));
    else resolve(code ?? 1);
  });
});
process.exitCode = exitCode;
