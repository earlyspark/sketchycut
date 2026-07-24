import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";
import { StableIdSchema } from "../domain/primitives.js";

export const SEALED_PARTITION_MANIFEST_VERSION =
  "sketchycut-sealed-semantic-partition@1.0.0" as const;
export const SEALED_SEMANTIC_CASE_VERSION =
  "sketchycut-sealed-semantic-case@1.0.0" as const;
export const SEALED_PARTITION_COMMITMENT_VERSION =
  "sketchycut-sealed-semantic-commitment@1.0.0" as const;
export const SEALED_PARTITION_OPENING_VERSION =
  "sketchycut-sealed-semantic-opening@1.0.0" as const;

const IsoInstantSchema = z.iso.datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const UniqueStableIdsSchema = z.array(StableIdSchema).max(32)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Stable IDs must be unique." });
    }
  });

export const SealedReviewTriggerCodeSchema = z.enum([
  "ESSENTIAL_UNBOUND",
  "ESSENTIAL_UNCERTAIN",
  "INVENTORY_PROJECTION_COVERAGE_MISMATCH",
  "REFERENCE_ROLE_ACCOUNTING_MISMATCH",
  "CONFLICT_PRECEDENCE_UNVERIFIED",
  "EVIDENCE_BINDING_INCOMPLETE"
]);

const SealedOutcomePolicySchema = z.object({
  purpose: z.enum(["semantic-diagnostic", "svg-acceptance"]),
  allowedKinds: z.array(z.enum([
    "supported",
    "simplified",
    "modified",
    "concept-only"
  ])).min(1).max(4),
  exportRequired: z.boolean()
}).strict().superRefine((policy, context) => {
  const preferredOrder = [
    "supported",
    "simplified",
    "modified",
    "concept-only"
  ] as const;
  if (new Set(policy.allowedKinds).size !== policy.allowedKinds.length) {
    context.addIssue({ code: "custom", message: "Allowed outcomes must be unique." });
  }
  const ranks = policy.allowedKinds.map((kind) => preferredOrder.indexOf(kind));
  if (ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1]!)) {
    context.addIssue({
      code: "custom",
      message: "Allowed outcomes must preserve the registered preference order."
    });
  }
  if (policy.purpose === "svg-acceptance" && !policy.exportRequired) {
    context.addIssue({
      code: "custom",
      message: "SVG acceptance requires an export-authorized outcome."
    });
  }
  if (policy.exportRequired && policy.allowedKinds.includes("concept-only")) {
    context.addIssue({
      code: "custom",
      message: "Concept-only cannot satisfy an export-required policy."
    });
  }
});

const SealedRequirementPredicateSchema = z.object({
  kind: z.enum([
    "containment",
    "support",
    "access",
    "organization",
    "closure",
    "rigid-interface",
    "revolute-interface",
    "prismatic-interface",
    "permitted-stock",
    "visual-treatment",
    "cut-through-treatment",
    "functional-aperture",
    "specific-profile",
    "compound-motion"
  ]),
  priority: z.enum(["must", "prefer"]).nullable()
}).strict();

const SealedBodyPredicateSchema = z.object({
  role: z.enum(["primary-enclosure", "support", "cover"]),
  shapeClass: z.enum([
    "orthogonal-shell",
    "planar",
    "rod",
    "angled",
    "curved",
    "freeform"
  ]).nullable()
}).strict();

const SealedAccessPredicateSchema = z.object({
  kind: z.enum(["open-top", "open-front", "covered"]),
  direction: z.enum(["top", "front"]).nullable(),
  priority: z.enum(["must", "prefer"]).nullable()
}).strict();

const SealedInterfacePredicateSchema = z.object({
  behavior: z.enum(["rigid", "revolute", "prismatic"]),
  axis: z.enum(["width", "depth", "height"]).nullable()
}).strict();

const SealedOrganizationPredicateSchema = z.object({
  desiredSpaceCount: z.number().int().min(1).max(36),
  rows: z.number().int().min(1).max(6).nullable(),
  columns: z.number().int().min(1).max(6).nullable(),
  priority: z.enum(["must", "prefer"]).nullable()
}).strict();

const SealedAccountingPredicateSchema = z.object({
  importance: z.enum(["essential", "preference"]),
  state: z.enum(["bound", "deferred", "unbound", "uncertain"]),
  minimumCount: z.number().int().nonnegative().max(48),
  maximumCount: z.number().int().nonnegative().max(48)
}).strict().superRefine((predicate, context) => {
  if (predicate.maximumCount < predicate.minimumCount) {
    context.addIssue({
      code: "custom",
      message: "Accounting maximum count must not precede its minimum."
    });
  }
});

const SealedSemanticAtomKindSchema = z.enum([
  "primary-enclosure",
  "partial-support",
  "open-access",
  "retained-revolute-cover",
  "captured-prismatic-cover",
  "organization",
  "qualitative-proportion",
  "object-clearance",
  "object-scale",
  "ranked-goal",
  "registered-surface-treatment",
  "structural-aperture"
]);

export const SealedSemanticOracleSchema = z.object({
  requiredRequirements: z.array(SealedRequirementPredicateSchema).max(24),
  prohibitedRequirements: z.array(SealedRequirementPredicateSchema).max(24),
  requiredBodies: z.array(SealedBodyPredicateSchema).max(8),
  prohibitedBodies: z.array(SealedBodyPredicateSchema).max(8),
  requiredAccess: z.array(SealedAccessPredicateSchema).max(8),
  prohibitedAccess: z.array(SealedAccessPredicateSchema).max(8),
  requiredInterfaces: z.array(SealedInterfacePredicateSchema).max(12),
  prohibitedInterfaces: z.array(SealedInterfacePredicateSchema).max(12),
  requiredOrganization: z.array(SealedOrganizationPredicateSchema).max(8),
  prohibitedOrganization: z.array(SealedOrganizationPredicateSchema).max(8),
  accounting: z.array(SealedAccountingPredicateSchema).max(12),
  requiredAtomKinds: z.array(SealedSemanticAtomKindSchema).max(16),
  prohibitedAtomKinds: z.array(SealedSemanticAtomKindSchema).max(16),
  requiredUnsupportedSignatureIds: UniqueStableIdsSchema,
  prohibitedUnsupportedSignatureIds: UniqueStableIdsSchema
}).strict().superRefine((oracle, context) => {
  const predicateCount = [
    oracle.requiredRequirements,
    oracle.prohibitedRequirements,
    oracle.requiredBodies,
    oracle.prohibitedBodies,
    oracle.requiredAccess,
    oracle.prohibitedAccess,
    oracle.requiredInterfaces,
    oracle.prohibitedInterfaces,
    oracle.requiredOrganization,
    oracle.prohibitedOrganization,
    oracle.accounting,
    oracle.requiredAtomKinds,
    oracle.prohibitedAtomKinds,
    oracle.requiredUnsupportedSignatureIds,
    oracle.prohibitedUnsupportedSignatureIds
  ].reduce((total, predicates) => total + predicates.length, 0);
  if (predicateCount === 0) {
    context.addIssue({
      code: "custom",
      message: "A sealed semantic oracle requires at least one typed predicate."
    });
  }
});

const SealedReferenceSchema = z.object({
  referenceId: StableIdSchema,
  sha256: Sha256Schema,
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  width: z.number().int().positive().max(12_000),
  height: z.number().int().positive().max(12_000),
  dataBase64: z.string().min(4).max(24_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u)
}).strict();

const SealedReferenceRoleConstraintSchema = z.object({
  referenceId: StableIdSchema,
  roles: z.array(z.enum(["structure", "surface"])).min(1).max(2)
}).strict();

export const SealedSemanticCasePayloadSchema = z.object({
  schemaVersion: z.literal(SEALED_SEMANTIC_CASE_VERSION),
  caseId: StableIdSchema,
  evaluationClass: z.enum(["review-eligible-error", "already-correct-control"]),
  submission: z.object({
    brief: z.string().min(1).max(4_000),
    references: z.array(SealedReferenceSchema).max(3),
    roleConstraints: z.array(SealedReferenceRoleConstraintSchema).max(3)
  }).strict(),
  expected: z.object({
    semanticOracle: SealedSemanticOracleSchema,
    baselineOutcomePolicy: SealedOutcomePolicySchema,
    reviewedOutcomePolicy: SealedOutcomePolicySchema,
    reviewDisposition: z.enum(["dispatch-on-registered-trigger", "skip-not-triggered"]),
    requiredTriggerCodes: z.array(SealedReviewTriggerCodeSchema).max(6)
  }).strict()
}).strict().superRefine((testCase, context) => {
  const referenceIds = testCase.submission.references.map((item) => item.referenceId);
  const roleIds = testCase.submission.roleConstraints.map((item) => item.referenceId);
  if (
    new Set(referenceIds).size !== referenceIds.length ||
    new Set(roleIds).size !== roleIds.length ||
    JSON.stringify(referenceIds) !== JSON.stringify(roleIds)
  ) {
    context.addIssue({
      code: "custom",
      message: "Every reference requires exactly one ordered role constraint."
    });
  }
  if (
    testCase.evaluationClass === "review-eligible-error" &&
    (
      testCase.expected.reviewDisposition !== "dispatch-on-registered-trigger" ||
      testCase.expected.requiredTriggerCodes.length === 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "A review-eligible error requires one or more registered review triggers."
    });
  }
  if (
    testCase.evaluationClass === "already-correct-control" &&
    (
      testCase.expected.reviewDisposition !== "skip-not-triggered" ||
      testCase.expected.requiredTriggerCodes.length !== 0
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "An already-correct control must require a no-trigger review skip."
    });
  }
});

export const SealedPartitionManifestSchema = z.object({
  schemaVersion: z.literal(SEALED_PARTITION_MANIFEST_VERSION),
  caseContractVersion: z.literal(SEALED_SEMANTIC_CASE_VERSION),
  partitionId: StableIdSchema,
  authorization: z.object({
    authorizationId: StableIdSchema,
    authorizedBy: z.literal("builder"),
    authorizedAt: IsoInstantSchema,
    oneTimeOpening: z.literal(true),
    builderAuthoredCases: z.literal(true),
    codexInspectionForbidden: z.literal(true)
  }).strict(),
  cases: z.array(z.object({
    caseId: StableIdSchema,
    payloadRelativePath: z.string().min(1).max(240)
  }).strict()).min(2).max(64)
}).strict().superRefine((manifest, context) => {
  const caseIds = manifest.cases.map((item) => item.caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    context.addIssue({ code: "custom", message: "Sealed case IDs must be unique." });
  }
  for (const [index, item] of manifest.cases.entries()) {
    const normalized = path.posix.normalize(item.payloadRelativePath.replaceAll("\\", "/"));
    if (
      normalized !== item.payloadRelativePath.replaceAll("\\", "/") ||
      normalized === "." ||
      normalized.startsWith("../") ||
      normalized.includes("/../") ||
      path.posix.isAbsolute(normalized)
    ) {
      context.addIssue({
        code: "custom",
        path: ["cases", index, "payloadRelativePath"],
        message: "Sealed payload paths must be normalized relative paths contained by the input root."
      });
    }
  }
});

const SealedPayloadCommitmentSchema = z.object({
  caseId: StableIdSchema,
  payloadBytes: z.number().int().positive(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const SealedPartitionCommitmentSchema = z.object({
  schemaVersion: z.literal(SEALED_PARTITION_COMMITMENT_VERSION),
  partitionId: StableIdSchema,
  committedAt: IsoInstantSchema,
  authorization: SealedPartitionManifestSchema.shape.authorization,
  manifestBytes: z.number().int().positive(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  caseIds: z.array(StableIdSchema).min(2).max(64),
  payloads: z.array(SealedPayloadCommitmentSchema).min(2).max(64),
  totalPayloadBytes: z.number().int().positive(),
  commitmentSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().superRefine((commitment, context) => {
  if (
    JSON.stringify(commitment.caseIds) !==
      JSON.stringify(commitment.payloads.map((item) => item.caseId))
  ) {
    context.addIssue({
      code: "custom",
      message: "Sealed case IDs and payload commitments must have identical stable order."
    });
  }
  if (
    commitment.totalPayloadBytes !==
      commitment.payloads.reduce((total, item) => total + item.payloadBytes, 0)
  ) {
    context.addIssue({
      code: "custom",
      message: "Sealed total payload bytes must equal the per-case byte counts."
    });
  }
});

export const SealedPartitionOpeningSchema = z.object({
  schemaVersion: z.literal(SEALED_PARTITION_OPENING_VERSION),
  openingId: StableIdSchema,
  partitionId: StableIdSchema,
  commitmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  claimedAt: IsoInstantSchema,
  claimedBy: z.literal("builder-authorized-evaluation-runner"),
  state: z.literal("claimed-before-first-dispatch"),
  caseIds: z.array(StableIdSchema).min(2).max(64)
}).strict();

export type SealedPartitionManifest = z.infer<typeof SealedPartitionManifestSchema>;
export type SealedSemanticCasePayload = z.infer<
  typeof SealedSemanticCasePayloadSchema
>;
export type SealedPartitionCommitment = z.infer<typeof SealedPartitionCommitmentSchema>;
export type SealedPartitionOpening = z.infer<typeof SealedPartitionOpeningSchema>;

type LoadedSealedPartition = {
  manifest: SealedPartitionManifest;
  manifestBytes: Uint8Array;
  payloads: {
    caseId: string;
    payloadBytes: Uint8Array;
    payload: SealedSemanticCasePayload;
  }[];
};

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseSealedPayload(
  expectedCaseId: string,
  payloadBytes: Uint8Array,
): SealedSemanticCasePayload {
  try {
    const payload = SealedSemanticCasePayloadSchema.parse(
      JSON.parse(Buffer.from(payloadBytes).toString("utf8")) as unknown,
    );
    if (payload.caseId !== expectedCaseId) {
      throw new Error("SEALED_PARTITION_CASE_ID_MISMATCH");
    }
    for (const reference of payload.submission.references) {
      const decoded = Buffer.from(reference.dataBase64, "base64");
      if (
        decoded.byteLength === 0 ||
        decoded.toString("base64") !== reference.dataBase64 ||
        sha256Bytes(decoded) !== reference.sha256
      ) {
        throw new Error("SEALED_PARTITION_REFERENCE_INTEGRITY_INVALID");
      }
    }
    return payload;
  } catch {
    throw new Error("SEALED_PARTITION_CASE_PAYLOAD_INVALID");
  }
}

async function requireRegularNonSymlink(filePath: string): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("SEALED_PARTITION_INPUT_MUST_BE_REGULAR_FILE");
  }
}

async function containedPayloadPath(inputRoot: string, relativePath: string): Promise<string> {
  const root = await realpath(inputRoot);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("SEALED_PARTITION_PAYLOAD_OUTSIDE_INPUT_ROOT");
  }
  await requireRegularNonSymlink(candidate);
  const resolved = await realpath(candidate);
  const resolvedRelative = path.relative(root, resolved);
  if (resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative)) {
    throw new Error("SEALED_PARTITION_PAYLOAD_REALPATH_OUTSIDE_INPUT_ROOT");
  }
  return resolved;
}

export async function loadSealedPartition(inputRoot: string): Promise<LoadedSealedPartition> {
  const root = await realpath(inputRoot);
  const manifestPath = path.join(root, "sealed-partition.json");
  await requireRegularNonSymlink(manifestPath);
  const manifestBytes = await readFile(manifestPath);
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("SEALED_PARTITION_MANIFEST_JSON_INVALID");
  }
  const manifest = SealedPartitionManifestSchema.parse(manifestValue);
  const payloads = [];
  for (const item of manifest.cases) {
    const payloadPath = await containedPayloadPath(root, item.payloadRelativePath);
    const payloadBytes = await readFile(payloadPath);
    payloads.push({
      caseId: item.caseId,
      payloadBytes,
      payload: parseSealedPayload(item.caseId, payloadBytes)
    });
  }
  const classes = new Set(payloads.map((item) => item.payload.evaluationClass));
  if (
    !classes.has("review-eligible-error") ||
    !classes.has("already-correct-control")
  ) {
    throw new Error("SEALED_PARTITION_REQUIRED_EVALUATION_CLASSES_MISSING");
  }
  return { manifest, manifestBytes, payloads };
}

export async function validateSealedPartitionPrivacySafe(
  inputRoot: string,
): Promise<{
  status: "sealed-partition-valid";
  partitionId: string;
  caseIds: string[];
  payloadByteCounts: number[];
  totalPayloadBytes: number;
}> {
  const loaded = await loadSealedPartition(inputRoot);
  const payloadByteCounts = loaded.payloads.map(
    (item) => item.payloadBytes.byteLength,
  );
  return {
    status: "sealed-partition-valid",
    partitionId: loaded.manifest.partitionId,
    caseIds: loaded.payloads.map((item) => item.caseId),
    payloadByteCounts,
    totalPayloadBytes: payloadByteCounts.reduce(
      (total, byteCount) => total + byteCount,
      0,
    )
  };
}

async function commitmentDigest(input: {
  partitionId: string;
  authorization: SealedPartitionManifest["authorization"];
  manifestBytes: number;
  manifestSha256: string;
  payloads: z.infer<typeof SealedPayloadCommitmentSchema>[];
}): Promise<string> {
  return hashCanonical({
    partitionId: input.partitionId,
    authorization: input.authorization,
    manifestBytes: input.manifestBytes,
    manifestSha256: input.manifestSha256,
    payloads: input.payloads
  });
}

export async function buildSealedPartitionCommitment(input: {
  inputRoot: string;
  committedAt?: string;
}): Promise<SealedPartitionCommitment> {
  const loaded = await loadSealedPartition(input.inputRoot);
  return sealedPartitionCommitmentFromLoaded(
    loaded,
    input.committedAt ?? new Date().toISOString(),
  );
}

async function sealedPartitionCommitmentFromLoaded(
  loaded: LoadedSealedPartition,
  committedAt: string,
): Promise<SealedPartitionCommitment> {
  const payloads = loaded.payloads.map((item) => SealedPayloadCommitmentSchema.parse({
    caseId: item.caseId,
    payloadBytes: item.payloadBytes.byteLength,
    payloadSha256: sha256Bytes(item.payloadBytes)
  }));
  const digestInput = {
    partitionId: loaded.manifest.partitionId,
    authorization: loaded.manifest.authorization,
    manifestBytes: loaded.manifestBytes.byteLength,
    manifestSha256: sha256Bytes(loaded.manifestBytes),
    payloads
  };
  return SealedPartitionCommitmentSchema.parse({
    schemaVersion: SEALED_PARTITION_COMMITMENT_VERSION,
    partitionId: loaded.manifest.partitionId,
    committedAt,
    authorization: loaded.manifest.authorization,
    manifestBytes: digestInput.manifestBytes,
    manifestSha256: digestInput.manifestSha256,
    caseIds: payloads.map((item) => item.caseId),
    payloads,
    totalPayloadBytes: payloads.reduce((total, item) => total + item.payloadBytes, 0),
    commitmentSha256: await commitmentDigest(digestInput)
  });
}

export async function writeSealedPartitionCommitment(input: {
  inputRoot: string;
  commitmentPath: string;
  committedAt?: string;
}): Promise<SealedPartitionCommitment> {
  const commitment = await buildSealedPartitionCommitment(input);
  await mkdir(path.dirname(input.commitmentPath), { recursive: true });
  await writeFile(
    input.commitmentPath,
    `${JSON.stringify(commitment, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  return commitment;
}

export async function verifySealedPartitionCommitment(input: {
  inputRoot: string;
  commitment: unknown;
}): Promise<LoadedSealedPartition> {
  const commitment = SealedPartitionCommitmentSchema.parse(input.commitment);
  const loaded = await loadSealedPartition(input.inputRoot);
  const recomputed = await sealedPartitionCommitmentFromLoaded(
    loaded,
    commitment.committedAt,
  );
  if (JSON.stringify(recomputed) !== JSON.stringify(commitment)) {
    throw new Error("SEALED_PARTITION_COMMITMENT_MISMATCH");
  }
  return loaded;
}

export async function readSealedPartitionCommitment(
  commitmentPath: string,
): Promise<SealedPartitionCommitment> {
  await requireRegularNonSymlink(commitmentPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(commitmentPath, "utf8")) as unknown;
  } catch {
    throw new Error("SEALED_PARTITION_COMMITMENT_JSON_INVALID");
  }
  return SealedPartitionCommitmentSchema.parse(value);
}

export async function readSealedPartitionOpening(
  openingPath: string,
): Promise<SealedPartitionOpening> {
  await requireRegularNonSymlink(openingPath);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(openingPath, "utf8")) as unknown;
  } catch {
    throw new Error("SEALED_PARTITION_OPENING_JSON_INVALID");
  }
  return SealedPartitionOpeningSchema.parse(value);
}

export async function claimSealedPartitionOpening(input: {
  commitmentPath: string;
  openingPath: string;
  claimedAt?: string;
}): Promise<SealedPartitionOpening> {
  const commitment = await readSealedPartitionCommitment(input.commitmentPath);
  const opening = SealedPartitionOpeningSchema.parse({
    schemaVersion: SEALED_PARTITION_OPENING_VERSION,
    openingId: `sealed-opening-${randomUUID()}`,
    partitionId: commitment.partitionId,
    commitmentSha256: commitment.commitmentSha256,
    claimedAt: input.claimedAt ?? new Date().toISOString(),
    claimedBy: "builder-authorized-evaluation-runner",
    state: "claimed-before-first-dispatch",
    caseIds: commitment.caseIds
  });
  await mkdir(path.dirname(input.openingPath), { recursive: true });
  await writeFile(
    input.openingPath,
    `${JSON.stringify(opening, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
  return opening;
}
