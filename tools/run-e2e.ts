import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDevelopmentEnvironment } from "./development.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const environment = buildDevelopmentEnvironment("fixtures", {
  ...process.env,
  NODE_ENV: "production"
});

async function run(executable: string, args: readonly string[]): Promise<void> {
  const child = spawn(process.execPath, [executable, ...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit"
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal !== null) reject(new Error(`E2E_CHILD_SIGNAL_${signal}`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`E2E_CHILD_EXIT_${String(code)}`);
}

await run(path.join(repositoryRoot, "node_modules/next/dist/bin/next"), ["build", "--webpack"]);
await run(path.join(repositoryRoot, "node_modules/@playwright/test/cli.js"), [
  "test",
  ...process.argv.slice(2)
]);
