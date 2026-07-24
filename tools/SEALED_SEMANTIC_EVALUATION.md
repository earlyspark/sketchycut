# M7.4 sealed-recovery semantic-evaluation builder handoff

This is the builder-facing format for the single authorized M7.4 sealed-recovery
partition. It is a fresh, independently authored two-case partition, not a retry,
replacement, or reopening of the burned partition. The burned commitment, opening,
selection, stop record, and all related evidence remain immutable.

Wait until Codex reports that the final recovery execution identity is frozen. After
that freeze, the builder—not Codex—authors, validates, and ingests the real cases in an
external directory. Do not paste or attach the completed case files to the task, and
do not let Codex inspect the external directory before the one authorized execution.

The examples below are intentionally incomplete templates, not held-out cases. Replace
every placeholder and author meaningful typed oracle predicates before validation.
The infrastructure reserves authorization ID
`m74-sealed-recovery-authorization-20260724` and exactly these two case IDs,
neither of which overlaps the burned partition: `m74-recovery-case-a` is the one
`review-eligible-error`, and `m74-recovery-case-b` is the one
`already-correct-control`. The builder independently authors their briefs,
references, constraints, oracles, policies, and triggers. The partition ID remains a
fresh builder choice.

## Directory

```text
external-directory/
  sealed-partition.json
  cases/
    m74-recovery-case-a.json
    m74-recovery-case-b.json
```

## Manifest

```json
{
  "schemaVersion": "sketchycut-sealed-semantic-partition@1.0.0",
  "caseContractVersion": "sketchycut-sealed-semantic-case@1.0.0",
  "partitionId": "<builder-partition-id>",
  "authorization": {
    "authorizationId": "m74-sealed-recovery-authorization-20260724",
    "authorizedBy": "builder",
    "authorizedAt": "BUILDER MUST REPLACE WITH CURRENT ISO-8601 INSTANT",
    "oneTimeOpening": true,
    "builderAuthoredCases": true,
    "codexInspectionForbidden": true
  },
  "cases": [
    {
      "caseId": "m74-recovery-case-a",
      "payloadRelativePath": "cases/m74-recovery-case-a.json"
    },
    {
      "caseId": "m74-recovery-case-b",
      "payloadRelativePath": "cases/m74-recovery-case-b.json"
    }
  ]
}
```

IDs use lowercase letters, digits, and internal hyphens. Paths are normalized relative
paths and cannot escape the external directory.

## Review-eligible error template

```json
{
  "schemaVersion": "sketchycut-sealed-semantic-case@1.0.0",
  "caseId": "m74-recovery-case-a",
  "evaluationClass": "review-eligible-error",
  "submission": {
    "brief": "BUILDER MUST REPLACE THIS PLACEHOLDER",
    "references": [],
    "roleConstraints": []
  },
  "expected": {
    "semanticOracle": {
      "requiredRequirements": [
        { "kind": "containment", "priority": "must" }
      ],
      "prohibitedRequirements": [],
      "requiredBodies": [],
      "prohibitedBodies": [],
      "requiredAccess": [],
      "prohibitedAccess": [],
      "requiredInterfaces": [],
      "prohibitedInterfaces": [],
      "requiredOrganization": [],
      "prohibitedOrganization": [],
      "accounting": [],
      "requiredAtomKinds": [],
      "prohibitedAtomKinds": [],
      "requiredUnsupportedSignatureIds": [],
      "prohibitedUnsupportedSignatureIds": []
    },
    "baselineOutcomePolicy": {
      "purpose": "semantic-diagnostic",
      "allowedKinds": ["supported", "simplified", "modified", "concept-only"],
      "exportRequired": false
    },
    "reviewedOutcomePolicy": {
      "purpose": "svg-acceptance",
      "allowedKinds": ["supported", "simplified"],
      "exportRequired": true
    },
    "reviewDisposition": "dispatch-on-registered-trigger",
    "requiredTriggerCodes": [
      "INVENTORY_PROJECTION_COVERAGE_MISMATCH"
    ]
  }
}
```

The builder selects only triggers that should genuinely be present in the Call A result:

- `ESSENTIAL_UNBOUND`
- `ESSENTIAL_UNCERTAIN`
- `INVENTORY_PROJECTION_COVERAGE_MISMATCH`
- `REFERENCE_ROLE_ACCOUNTING_MISMATCH`
- `CONFLICT_PRECEDENCE_UNVERIFIED`
- `EVIDENCE_BINDING_INCOMPLETE`

## Already-correct control template

```json
{
  "schemaVersion": "sketchycut-sealed-semantic-case@1.0.0",
  "caseId": "m74-recovery-case-b",
  "evaluationClass": "already-correct-control",
  "submission": {
    "brief": "BUILDER MUST REPLACE THIS PLACEHOLDER",
    "references": [],
    "roleConstraints": []
  },
  "expected": {
    "semanticOracle": {
      "requiredRequirements": [
        { "kind": "containment", "priority": "must" }
      ],
      "prohibitedRequirements": [],
      "requiredBodies": [],
      "prohibitedBodies": [],
      "requiredAccess": [],
      "prohibitedAccess": [],
      "requiredInterfaces": [],
      "prohibitedInterfaces": [],
      "requiredOrganization": [],
      "prohibitedOrganization": [],
      "accounting": [],
      "requiredAtomKinds": [],
      "prohibitedAtomKinds": [],
      "requiredUnsupportedSignatureIds": [],
      "prohibitedUnsupportedSignatureIds": []
    },
    "baselineOutcomePolicy": {
      "purpose": "svg-acceptance",
      "allowedKinds": ["supported", "simplified"],
      "exportRequired": true
    },
    "reviewedOutcomePolicy": {
      "purpose": "svg-acceptance",
      "allowedKinds": ["supported", "simplified"],
      "exportRequired": true
    },
    "reviewDisposition": "skip-not-triggered",
    "requiredTriggerCodes": []
  }
}
```

The full strict predicate enums are defined in
`src/evaluation/sealed-partition.ts`. Every case must contain at least one typed oracle
predicate. `null` means “any value” for the nullable matcher fields.

For a reference image, add one ordered entry to both `references` and
`roleConstraints`:

```json
{
  "referenceId": "<builder-reference-id>",
  "sha256": "64-lowercase-hex-characters",
  "mediaType": "image/png",
  "width": 512,
  "height": 512,
  "dataBase64": "BASE64_BYTES_WITHOUT_A_DATA_URL_PREFIX"
}
```

```json
{
  "referenceId": "<builder-reference-id>",
  "roles": ["structure"]
}
```

The builder runs the validator after the final execution freeze. It checks strict
shape, unique case IDs, required evaluation classes, reference order, base64
canonicalization, and image-byte SHA-256 without displaying private content. The
recovery runner separately refuses anything other than this handoff's exact two-case,
one-case-per-class partition:

```sh
npm run validate:sealed-semantic-evaluation -- \
  --input-root /absolute/path/to/external-directory
```

On success it prints only the partition ID, case IDs, and byte counts. On failure it
prints only `SEALED_PARTITION_VALIDATION_FAILED`. Validation neither writes a
commitment nor claims the one-time opening. A validation failure is terminal for this
recovery; report it without editing the cases and rerunning the command.

Immediately after the one successful validation and before ingestion, preserve its
completion time in the builder's shell:

```sh
export RECOVERY_VALIDATION_COMPLETED_AT="$(
  node -e 'process.stdout.write(new Date().toISOString())'
)"
```

The builder then ingests the validated bytes exactly once into the distinct recovery
commitment path:

```sh
npm run seal:semantic-evaluation -- \
  --input-root /absolute/path/to/external-directory \
  --commitment docs/evidence/m07-4/sealed-recovery-partition-commitment.json
```

Successful ingestion prints only privacy-safe commitment metadata: partition ID,
commitment SHA-256, case IDs, and byte counts. A failure prints only
`SEALED_PARTITION_INGESTION_FAILED`. Do not use or modify the burned
`docs/evidence/m07-4/sealed-partition-commitment.json` or
`docs/evidence/m07-4/sealed-partition-opening.json` paths. Do not rerun ingestion after
either success or failure, and do not create the recovery opening manually.

## Builder attestation and opaque root binding

After successful ingestion, the builder creates one strict privacy-safe attestation.
Do not manually transcribe hashes or assemble the JSON. The command below reads only
the privacy-safe final execution freeze and recovery commitment, canonicalizes only the
external root directory, derives both raw-record hashes, takes the ingestion time from
the commitment, verifies the authorization, exact ordered IDs, and timestamp order,
and writes the attestation once with `wx`. It never reads the external manifest or
either case payload and never prints the external path.

Run it locally as the builder or independent author:

```sh
RECOVERY_EXTERNAL_ROOT='/absolute/path/to/external-directory' \
RECOVERY_INDEPENDENT_AUTHOR_ROLE='builder' \
node --input-type=module -e '
  import { createHash, randomBytes } from "node:crypto";
  import {
    lstat,
    readFile,
    realpath,
    writeFile
  } from "node:fs/promises";

  try {
    const campaign = "m7-4-sealed-recovery";
    const authorizationId =
      "m74-sealed-recovery-authorization-20260724";
    const caseIds = [
      "m74-recovery-case-a",
      "m74-recovery-case-b"
    ];
    const domain =
      "sketchycut-m74-sealed-recovery-canonical-root@1.0.0";
    const freezePath =
      "docs/evidence/m07-4/reports/" +
      "sealed-recovery-execution-identity-freeze.json";
    const commitmentPath =
      "docs/evidence/m07-4/" +
      "sealed-recovery-partition-commitment.json";
    const attestationPath =
      "docs/evidence/m07-4/" +
      "sealed-recovery-builder-attestation.json";
    const rootInput = process.env.RECOVERY_EXTERNAL_ROOT;
    const validationCompletedAt =
      process.env.RECOVERY_VALIDATION_COMPLETED_AT;
    const independentAuthorRole =
      process.env.RECOVERY_INDEPENDENT_AUTHOR_ROLE;

    if (
      typeof rootInput !== "string" ||
      typeof validationCompletedAt !== "string" ||
      !["builder", "independent-party"].includes(independentAuthorRole)
    ) {
      throw new Error("BUILDER_ATTESTATION_INPUT_INVALID");
    }

    const [
      freezeBytes,
      commitmentBytes,
      rootMetadata,
      canonicalRoot
    ] =
      await Promise.all([
        readFile(freezePath),
        readFile(commitmentPath),
        lstat(rootInput),
        realpath(rootInput)
      ]);
    const freeze = JSON.parse(freezeBytes.toString("utf8"));
    const commitment = JSON.parse(commitmentBytes.toString("utf8"));
    const ingestionCompletedAt = commitment.committedAt;
    const attestedAt = new Date().toISOString();
    const freezeTime = Date.parse(freeze.frozenAt);
    const authorizationTime = Date.parse(
      commitment.authorization?.authorizedAt
    );
    const validationTime = Date.parse(validationCompletedAt);
    const ingestionTime = Date.parse(ingestionCompletedAt);
    const attestedTime = Date.parse(attestedAt);

    if (
      freeze.schemaVersion !==
        "sketchycut-m74-sealed-recovery-" +
        "execution-identity-freeze@1.0.0" ||
      freeze.campaign !== campaign ||
      commitment.schemaVersion !==
        "sketchycut-sealed-semantic-commitment@1.0.0" ||
      commitment.authorization?.authorizationId !== authorizationId ||
      !rootMetadata.isDirectory() ||
      rootMetadata.isSymbolicLink() ||
      JSON.stringify(commitment.caseIds) !== JSON.stringify(caseIds) ||
      typeof commitment.partitionId !== "string" ||
      commitment.partitionId.length === 0 ||
      !/^[a-f0-9]{64}$/.test(commitment.commitmentSha256) ||
      ![
        freezeTime,
        authorizationTime,
        validationTime,
        ingestionTime,
        attestedTime
      ]
        .every(Number.isFinite) ||
      authorizationTime <= freezeTime ||
      authorizationTime > validationTime ||
      validationTime <= freezeTime ||
      ingestionTime < validationTime ||
      attestedTime < ingestionTime
    ) {
      throw new Error("BUILDER_ATTESTATION_BINDING_INVALID");
    }

    const sha256 = (bytes) =>
      createHash("sha256").update(bytes).digest("hex");
    const nonce = randomBytes(32).toString("hex");
    const canonicalRealpathSha256 = createHash("sha256")
      .update(
        `${domain}\0${nonce}\0${canonicalRoot}`,
        "utf8"
      )
      .digest("hex");
    const attestation = {
      schemaVersion:
        "sketchycut-m74-sealed-recovery-" +
        "builder-attestation@1.0.0",
      campaign,
      authorizationId,
      attestedAt,
      validationCompletedAt,
      ingestionCompletedAt,
      independentAuthorRole,
      independentlyAuthored: true,
      validationPassed: true,
      ingestionPassed: true,
      createdAfterExecutionFreeze: true,
      nonOverwritingCommitment: true,
      nonOverwritingAttestation: true,
      codexPayloadAccess: false,
      retryAuthorized: false,
      replacementAuthorized: false,
      furtherCampaignAuthorized: false,
      partitionId: commitment.partitionId,
      caseIds,
      executionIdentityFreezeRecordSha256: sha256(freezeBytes),
      commitmentRecordSha256: sha256(commitmentBytes),
      commitmentSha256: commitment.commitmentSha256,
      externalRootBinding: {
        domain,
        nonce,
        canonicalRealpathSha256
      }
    };
    await writeFile(
      attestationPath,
      `${JSON.stringify(attestation, null, 2)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    process.stdout.write(
      JSON.stringify({
        status: "sealed-recovery-builder-attestation-recorded",
        partitionId: commitment.partitionId,
        caseIds
      }) + "\n"
    );
  } catch {
    process.stderr.write(
      "SEALED_RECOVERY_BUILDER_ATTESTATION_FAILED\n"
    );
    process.exitCode = 1;
  }
'
```

The command prints only privacy-safe status, partition ID, and case IDs. Any freeze,
commitment, authorization, ID, timestamp-order, canonical-root, existing-destination,
or write failure prints only
`SEALED_RECOVERY_BUILDER_ATTESTATION_FAILED` and is terminal. Do not edit or replace
the commitment, freeze, attestation, or external partition afterward.

After successful ingestion, provide Codex only the absolute external-directory path
once for the already-authorized execution. That execution may make at most two Call A
requests plus at most one trigger-gated Call B request, with no retry. The opening is
one-time and terminal: success, a gate stop, a transport ambiguity, or any other
failure authorizes no reread, retry, replacement partition, or further M7.4 campaign.
