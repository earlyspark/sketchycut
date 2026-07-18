import type { M6Store } from "../src/server/m6/contracts.js";
import {
  applyReviewedM61ExposureIncrease,
  exposureUsd,
  reviewM61ExposureIncrease
} from "../src/server/m6/exposure-authorization.js";

export type M61ExposureCommandArguments = {
  increaseUsd: 5;
  evidenceSha256: string;
  reviewNote: string;
  apply: boolean;
};

export function parseM61ExposureCommandArguments(
  argv: readonly string[],
): M61ExposureCommandArguments {
  const allowed = new Set(["--increase-usd", "--evidence-sha256", "--note", "--apply"]);
  for (const argument of argv.filter((value) => value.startsWith("--"))) {
    if (!allowed.has(argument)) throw new Error(`M61_AUTHORIZATION_ARGUMENT_UNKNOWN_${argument.slice(2)}`);
  }
  const value = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index < 0 ? null : argv[index + 1] ?? null;
  };
  if (value("--increase-usd") !== "5") {
    throw new Error("M61_AUTHORIZATION_INCREMENT_MUST_BE_5_USD");
  }
  const evidenceSha256 = value("--evidence-sha256");
  const reviewNote = value("--note");
  if (evidenceSha256 === null || reviewNote === null) {
    throw new Error("M61_AUTHORIZATION_EVIDENCE_AND_NOTE_REQUIRED");
  }
  return { increaseUsd: 5, evidenceSha256, reviewNote, apply: argv.includes("--apply") };
}

export async function runM61ExposureAuthorizationCommand(input: {
  store: M6Store;
  arguments: M61ExposureCommandArguments;
  now?: Date;
  authorizationId?: string;
}): Promise<{ output: string; applied: boolean }> {
  const review = await reviewM61ExposureIncrease({
    store: input.store,
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
  const decision = await applyReviewedM61ExposureIncrease({ store: input.store, review });
  if (!decision.applied) {
    throw new Error(`M61_AUTHORIZATION_${decision.reason.toUpperCase().replaceAll("-", "_")}`);
  }
  lines.push(
    `Applied immutable authorization ${review.proposedAuthorization.authorizationId}; ceiling is now $${exposureUsd(decision.state.authorizedCeilingMicrousd)}.`,
  );
  return { output: lines.join("\n") + "\n", applied: true };
}
