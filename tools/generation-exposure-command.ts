import type { GenerationStore } from "../src/server/generation/contracts.js";
import {
  applyReviewedExposureIncrease,
  exposureUsd,
  reviewExposureIncrease
} from "../src/server/generation/exposure-authorization.js";

export type ExposureCommandArguments = {
  increaseMicrousd: number;
  evidenceSha256: string;
  reviewNote: string;
  apply: boolean;
};

export function parseExposureCommandArguments(
  argv: readonly string[],
): ExposureCommandArguments {
  const allowed = new Set(["--increase-usd", "--evidence-sha256", "--note", "--apply"]);
  for (const argument of argv.filter((value) => value.startsWith("--"))) {
    if (!allowed.has(argument)) throw new Error(`GENERATION_AUTHORIZATION_ARGUMENT_UNKNOWN_${argument.slice(2)}`);
  }
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index < 0 ? null : argv[index + 1] ?? null;
  };
  const increaseUsd = value("--increase-usd");
  if (increaseUsd === null || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(increaseUsd)) {
    throw new Error("GENERATION_AUTHORIZATION_INCREMENT_INVALID");
  }
  const [whole, fraction = ""] = increaseUsd.split(".");
  const increaseMicrousd = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  if (!Number.isSafeInteger(increaseMicrousd) || increaseMicrousd <= 0 ||
      increaseMicrousd > 100_000_000) {
    throw new Error("GENERATION_AUTHORIZATION_INCREMENT_INVALID");
  }
  const evidenceSha256 = value("--evidence-sha256");
  const reviewNote = value("--note");
  if (evidenceSha256 === null || reviewNote === null) {
    throw new Error("GENERATION_AUTHORIZATION_EVIDENCE_AND_NOTE_REQUIRED");
  }
  return { increaseMicrousd, evidenceSha256, reviewNote, apply: argv.includes("--apply") };
}

export async function runExposureAuthorizationCommand(input: {
  store: GenerationStore;
  arguments: ExposureCommandArguments;
  now?: Date;
  authorizationId?: string;
}): Promise<{ output: string; applied: boolean }> {
  const review = await reviewExposureIncrease({
    store: input.store,
    increaseMicrousd: input.arguments.increaseMicrousd,
    evidenceSha256: input.arguments.evidenceSha256,
    reviewNote: input.arguments.reviewNote,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.authorizationId === undefined ? {} : { authorizationId: input.authorizationId })
  });
  const summary = review.ledgerSummary;
  const lines = [
    `Mode: ${input.arguments.apply ? "apply" : "dry-run"}`,
    `Current authorized ceiling: $${exposureUsd(review.state.authorizedCeilingMicrousd)}`,
    `Cumulative reserved exposure: $${exposureUsd(review.state.reservedExposureMicrousd)}`,
    `Confirmed estimated cost: $${exposureUsd(summary.confirmedEstimatedCostMicrousd)}`,
    `Unresolved potentially billed exposure: $${exposureUsd(summary.unresolvedPotentiallyBilledExposureMicrousd)}`,
    `Attempts: ${String(summary.dispatchedAttemptCount)} dispatched / ${String(summary.nonDispatchedAttemptCount)} non-dispatched`,
    `Proposed authorized ceiling: $${exposureUsd(review.proposedAuthorization.resultingAuthorizedCeilingMicrousd)}`
  ];
  if (!input.arguments.apply) {
    lines.push("Dry run only; durable exposure state was not changed. Add --apply after review.");
    return { output: lines.join("\n") + "\n", applied: false };
  }
  const decision = await applyReviewedExposureIncrease({ store: input.store, review });
  if (!decision.applied) {
    throw new Error(`GENERATION_AUTHORIZATION_${decision.reason.toUpperCase().replaceAll("-", "_")}`);
  }
  lines.push(
    `Applied immutable authorization ${review.proposedAuthorization.authorizationId}; ceiling is now $${exposureUsd(decision.state.authorizedCeilingMicrousd)}.`,
  );
  return { output: lines.join("\n") + "\n", applied: true };
}
