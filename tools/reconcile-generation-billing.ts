import { existsSync } from "node:fs";
import path from "node:path";

import { readUpstashConfig } from "../src/server/generation/config.js";
import { UpstashGenerationStore } from "../src/server/generation/upstash-store.js";
import {
  parseBillingReconciliationCommandArguments,
  runBillingReconciliationCommand
} from "./generation-billing-reconciliation-command.js";

if (existsSync(path.resolve(".env.local"))) {
  process.loadEnvFile(path.resolve(".env.local"));
}
const store = new UpstashGenerationStore(readUpstashConfig());
const result = await runBillingReconciliationCommand({
  store,
  arguments: parseBillingReconciliationCommandArguments(
    process.argv.slice(2),
  )
});
process.stdout.write(result.output);
