import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSealedPartitionCommitment,
  claimSealedPartitionOpening,
  readSealedPartitionCommitment,
  readSealedPartitionOpening,
  validateSealedPartitionPrivacySafe,
  verifySealedPartitionCommitment,
  writeSealedPartitionCommitment
} from "../../src/evaluation/sealed-partition.js";

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "sketchycut-sealed-partition-"));
  const oracle = {
    requiredRequirements: [
      { kind: "containment", priority: "must" }
    ],
    prohibitedRequirements: [],
    requiredBodies: [],
    prohibitedBodies: [],
    requiredAccess: [],
    prohibitedAccess: [],
    requiredInterfaces: [],
    prohibitedInterfaces: [],
    requiredOrganization: [],
    prohibitedOrganization: [],
    accounting: [],
    requiredAtomKinds: [],
    prohibitedAtomKinds: [],
    requiredUnsupportedSignatureIds: [],
    prohibitedUnsupportedSignatureIds: []
  };
  const outcomePolicy = {
    purpose: "svg-acceptance",
    allowedKinds: ["supported"],
    exportRequired: true
  };
  await writeFile(path.join(root, "case-a.json"), JSON.stringify({
    schemaVersion: "sketchycut-sealed-semantic-case@1.0.0",
    caseId: "sealed-case-a",
    evaluationClass: "review-eligible-error",
    submission: {
      brief: "private synthetic fixture A",
      references: [],
      roleConstraints: []
    },
    expected: {
      semanticOracle: oracle,
      baselineOutcomePolicy: outcomePolicy,
      reviewedOutcomePolicy: outcomePolicy,
      reviewDisposition: "dispatch-on-registered-trigger",
      requiredTriggerCodes: ["INVENTORY_PROJECTION_COVERAGE_MISMATCH"]
    }
  }));
  await writeFile(path.join(root, "case-b.json"), JSON.stringify({
    schemaVersion: "sketchycut-sealed-semantic-case@1.0.0",
    caseId: "sealed-case-b",
    evaluationClass: "already-correct-control",
    submission: {
      brief: "private synthetic fixture B",
      references: [],
      roleConstraints: []
    },
    expected: {
      semanticOracle: oracle,
      baselineOutcomePolicy: outcomePolicy,
      reviewedOutcomePolicy: outcomePolicy,
      reviewDisposition: "skip-not-triggered",
      requiredTriggerCodes: []
    }
  }));
  await writeFile(path.join(root, "sealed-partition.json"), JSON.stringify({
    schemaVersion: "sketchycut-sealed-semantic-partition@1.0.0",
    caseContractVersion: "sketchycut-sealed-semantic-case@1.0.0",
    partitionId: "fresh-sealed-partition",
    authorization: {
      authorizationId: "builder-sealed-authorization",
      authorizedBy: "builder",
      authorizedAt: "2026-07-23T20:00:00.000Z",
      oneTimeOpening: true,
      builderAuthoredCases: true,
      codexInspectionForbidden: true
    },
    cases: [
      { caseId: "sealed-case-a", payloadRelativePath: "case-a.json" },
      { caseId: "sealed-case-b", payloadRelativePath: "case-b.json" }
    ]
  }));
  return root;
}

describe("sealed semantic-evaluation partition", () => {
  it("records only commitment hashes, case IDs, byte counts, and authorization metadata", async () => {
    const root = await fixtureRoot();
    const commitment = await buildSealedPartitionCommitment({
      inputRoot: root,
      committedAt: "2026-07-23T20:05:00.000Z"
    });
    expect(commitment.caseIds).toEqual(["sealed-case-a", "sealed-case-b"]);
    expect(commitment.payloads.every((item) => item.payloadBytes > 0)).toBe(true);
    expect(JSON.stringify(commitment)).not.toContain("private synthetic fixture");
    expect(commitment.commitmentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects any manifest or payload change before opening", async () => {
    const root = await fixtureRoot();
    const commitment = await buildSealedPartitionCommitment({
      inputRoot: root,
      committedAt: "2026-07-23T20:05:00.000Z"
    });
    const casePath = path.join(root, "case-b.json");
    const privateCase = JSON.parse(await readFile(casePath, "utf8")) as {
      submission: { brief: string };
    };
    privateCase.submission.brief = "changed private fixture";
    await writeFile(casePath, JSON.stringify(privateCase));
    await expect(verifySealedPartitionCommitment({
      inputRoot: root,
      commitment
    })).rejects.toThrow("SEALED_PARTITION_COMMITMENT_MISMATCH");
  });

  it("validates with a privacy-safe summary that excludes payload content", async () => {
    const root = await fixtureRoot();
    const summary = await validateSealedPartitionPrivacySafe(root);
    expect(summary).toMatchObject({
      status: "sealed-partition-valid",
      partitionId: "fresh-sealed-partition",
      caseIds: ["sealed-case-a", "sealed-case-b"]
    });
    expect(summary.payloadByteCounts).toHaveLength(2);
    expect(JSON.stringify(summary)).not.toContain("private synthetic fixture");
  });

  it("writes commitment and opening records without overwrite", async () => {
    const root = await fixtureRoot();
    const recordRoot = await mkdtemp(path.join(tmpdir(), "sketchycut-sealed-record-"));
    const commitmentPath = path.join(recordRoot, "commitment.json");
    const openingPath = path.join(recordRoot, "opening.json");
    await writeSealedPartitionCommitment({
      inputRoot: root,
      commitmentPath,
      committedAt: "2026-07-23T20:05:00.000Z"
    });
    const commitment = await readSealedPartitionCommitment(commitmentPath);
    const opening = await claimSealedPartitionOpening({
      commitmentPath,
      openingPath,
      claimedAt: "2026-07-23T21:00:00.000Z"
    });
    expect(opening.commitmentSha256).toBe(commitment.commitmentSha256);
    await expect(readSealedPartitionOpening(openingPath))
      .resolves.toEqual(opening);
    await expect(claimSealedPartitionOpening({
      commitmentPath,
      openingPath,
      claimedAt: "2026-07-23T21:01:00.000Z"
    })).rejects.toMatchObject({ code: "EEXIST" });
    expect(JSON.parse(await readFile(openingPath, "utf8"))).toEqual(opening);
  });

  it("supports preaccess, atomic opening, and one verified in-memory snapshot in that order", async () => {
    const root = await fixtureRoot();
    const recordRoot = await mkdtemp(path.join(tmpdir(), "sketchycut-sealed-choreography-"));
    const commitmentPath = path.join(recordRoot, "commitment.json");
    const openingPath = path.join(recordRoot, "opening.json");
    const events: string[] = [];
    await writeSealedPartitionCommitment({
      inputRoot: root,
      commitmentPath,
      committedAt: "2026-07-23T20:05:00.000Z"
    });

    const commitment = await readSealedPartitionCommitment(commitmentPath);
    events.push("preaccess-gates");
    const opening = await claimSealedPartitionOpening({
      commitmentPath,
      openingPath,
      claimedAt: "2026-07-23T21:00:00.000Z"
    });
    events.push("opening-claimed");

    let verifierInvocations = 0;
    verifierInvocations += 1;
    const verified = await verifySealedPartitionCommitment({
      inputRoot: root,
      commitment
    });
    events.push("verified-snapshot-loaded");

    await rm(root, { recursive: true, force: true });
    expect(events).toEqual([
      "preaccess-gates",
      "opening-claimed",
      "verified-snapshot-loaded"
    ]);
    expect(verifierInvocations).toBe(1);
    expect(opening).toMatchObject({
      schemaVersion: "sketchycut-sealed-semantic-opening@1.0.0",
      partitionId: commitment.partitionId,
      commitmentSha256: commitment.commitmentSha256,
      caseIds: commitment.caseIds
    });
    expect(verified.payloads.map((item) => item.caseId)).toEqual([
      "sealed-case-a",
      "sealed-case-b"
    ]);
    expect(verified.payloads.map((item) => item.payload.evaluationClass))
      .toEqual(["review-eligible-error", "already-correct-control"]);
    expect(new Set(verified.payloads.map((item) => item.caseId)).size).toBe(2);
    expect(verified.payloads[0]!.payload.submission.brief)
      .toBe("private synthetic fixture A");
    const digest = (bytes: Uint8Array): string =>
      createHash("sha256").update(bytes).digest("hex");
    expect(digest(verified.manifestBytes)).toBe(
      commitment.manifestSha256,
    );
    expect(verified.payloads.map((item) => ({
      caseId: item.caseId,
      byteReads: 1,
      byteCount: item.payloadBytes.byteLength,
      sha256: digest(item.payloadBytes),
      caseContractVersion: item.payload.schemaVersion
    }))).toEqual(commitment.payloads.map((item) => ({
      caseId: item.caseId,
      byteReads: 1,
      byteCount: item.payloadBytes,
      sha256: item.payloadSha256,
      caseContractVersion: "sketchycut-sealed-semantic-case@1.0.0"
    })));
    expect(verified.payloads.reduce(
      (total, item) => total + item.payloadBytes.byteLength,
      0,
    )).toBe(commitment.totalPayloadBytes);
    await expect(readSealedPartitionOpening(openingPath)).resolves.toMatchObject({
      state: "claimed-before-first-dispatch",
      caseIds: ["sealed-case-a", "sealed-case-b"]
    });
  });

  it("rejects payload traversal and symlink-like root escapes before reading bytes", async () => {
    const root = await fixtureRoot();
    const manifestPath = path.join(root, "sealed-partition.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      cases: { caseId: string; payloadRelativePath: string }[];
    };
    manifest.cases[0]!.payloadRelativePath = "../outside.json";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(buildSealedPartitionCommitment({ inputRoot: root }))
      .rejects.toThrow();
  });

  it("verifies one loaded payload snapshot without a hidden second load", async () => {
    const source = await readFile(
      path.resolve("src/evaluation/sealed-partition.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "export async function verifySealedPartitionCommitment",
    );
    const end = source.indexOf(
      "export async function readSealedPartitionCommitment",
    );
    const implementation = source.slice(start, end);
    expect(implementation.match(/loadSealedPartition\(/gu)).toHaveLength(1);
    expect(implementation).toContain(
      "sealedPartitionCommitmentFromLoaded",
    );
    expect(implementation).not.toContain(
      "buildSealedPartitionCommitment",
    );
  });
});
