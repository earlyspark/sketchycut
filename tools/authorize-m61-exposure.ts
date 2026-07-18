import { existsSync } from "node:fs";
import path from "node:path";

import { readM6UpstashConfig } from "../src/server/m6/config.js";
import { UpstashM6Store } from "../src/server/m6/upstash-store.js";
import {
  parseM61ExposureCommandArguments,
  runM61ExposureAuthorizationCommand
} from "./m61-exposure-command.js";

if (existsSync(path.resolve(".env.local"))) process.loadEnvFile(path.resolve(".env.local"));
const store = new UpstashM6Store(readM6UpstashConfig());
const result = await runM61ExposureAuthorizationCommand({
  store,
  arguments: parseM61ExposureCommandArguments(process.argv.slice(2))
});
process.stdout.write(result.output);
