import { existsSync } from "node:fs";
import path from "node:path";

import { readUpstashConfig } from "../src/server/generation/config.js";
import { UpstashGenerationStore } from "../src/server/generation/upstash-store.js";
import {
  parseExposureCommandArguments,
  runExposureAuthorizationCommand
} from "./generation-exposure-command.js";

if (existsSync(path.resolve(".env.local"))) process.loadEnvFile(path.resolve(".env.local"));
const store = new UpstashGenerationStore(readUpstashConfig());
const result = await runExposureAuthorizationCommand({
  store,
  arguments: parseExposureCommandArguments(process.argv.slice(2))
});
process.stdout.write(result.output);
