import {
  LiveCallRuntimeOriginSchema,
  type LiveCallRuntimeOrigin
} from "../../interpretation/live-ledger.js";

export function deriveM61RuntimeOrigin(
  environment: NodeJS.ProcessEnv = process.env,
): LiveCallRuntimeOrigin {
  if (environment.SKETCHYCUT_TEST_MODE === "1" || environment.NODE_ENV === "test") {
    return "test-recorded";
  }
  if (environment.VERCEL === "1") {
    return LiveCallRuntimeOriginSchema.parse(
      environment.VERCEL_ENV === "production"
        ? "deployment-production"
        : "deployment-preview",
    );
  }
  return "local-development";
}
