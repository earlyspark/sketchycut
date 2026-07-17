import { readFile, stat } from "node:fs/promises";

import { z } from "zod";

import {
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  RetainedPinProgramV1Schema,
  canonicalDocumentHash,
  canonicalGeometryHash,
  canonicalPartHash,
  canonicalStockHash,
  sha256,
  validateFabricationProjection
} from "../src/index.js";

const outputDirectoryUrl = new URL("../artifacts/m3/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M3"),
    generator: z
      .object({
        id: z.literal("m3-artifact-generator"),
        version: z.literal("1.0.0")
      })
      .strict(),
    geometryHashes: z.object({ named: HashSchema, offFamily: HashSchema }).strict(),
    evaluatedDocumentHashes: z.object({ named: HashSchema, offFamily: HashSchema }).strict(),
    runtimeApplicationApiCalls: z.literal(0),
    physicalVerification: z.literal("required"),
    artifacts: z.array(
      z
        .object({
          path: z.string().min(1),
          bytes: z.number().int().nonnegative(),
          sha256: HashSchema
        })
        .strict(),
    )
  })
  .strict();

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, outputDirectoryUrl), "utf8")) as unknown;
}

const manifest = ManifestSchema.parse(await readJson("artifact-manifest.json"));
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, outputDirectoryUrl);
  const contents = await readFile(url);
  const metadata = await stat(url);
  if (metadata.size !== artifact.bytes) {
    throw new Error(`${artifact.path} byte count changed.`);
  }
  if (await sha256(contents) !== artifact.sha256) {
    throw new Error(`${artifact.path} hash changed.`);
  }
}

const namedProgram = RetainedPinProgramV1Schema.parse(await readJson("named/program.json"));
const offFamilyProgram = RetainedPinProgramV1Schema.parse(await readJson("off-family/program.json"));
const named = DesignDocumentV1Schema.parse(await readJson("named/project.json"));
const offFamily = DesignDocumentV1Schema.parse(await readJson("off-family/project.json"));
const namedBundle = ProjectionBundleSchema.parse(await readJson("named/projection-bundle.json"));
const offFamilyBundle = ProjectionBundleSchema.parse(
  await readJson("off-family/projection-bundle.json"),
);

if (
  await canonicalGeometryHash(named) !== manifest.geometryHashes.named ||
  await canonicalGeometryHash(offFamily) !== manifest.geometryHashes.offFamily ||
  await canonicalDocumentHash(named) !== manifest.evaluatedDocumentHashes.named ||
  await canonicalDocumentHash(offFamily) !== manifest.evaluatedDocumentHashes.offFamily
) {
  throw new Error("M3 canonical geometry/evaluated hashes no longer match recomputation.");
}

for (const [role, document, bundle, program] of [
  ["named", named, namedBundle, namedProgram],
  ["off-family", offFamily, offFamilyBundle, offFamilyProgram]
] as const) {
  const documentHash = await canonicalDocumentHash(document);
  if (
    document.validation.status !== "pass" ||
    validateFabricationProjection(bundle.fabrication, document.parts).status !== "pass" ||
    document.validation.findings.map((finding) => finding.code).join(",") !==
      "CALIBRATION_REQUIRED,PHYSICAL_VERIFICATION_REQUIRED"
  ) {
    throw new Error(`${role} canonical/fabrication validation or warning boundary changed.`);
  }
  if (
    document.projectId !== program.projectId ||
    document.operatorProgram.length !== 5 ||
    !document.operatorProgram.some(
      (entry) => entry.operatorId === "retained-pin-revolute" && entry.operatorVersion === "1.0.0",
    ) ||
    document.motionConstraints.length !== 1 ||
    document.motionConstraints[0]?.kind !== "revolute" ||
    document.motionConstraints.some((constraint) => constraint.kind === "prismatic")
  ) {
    throw new Error(`${role} no longer uses one registered retained-pin revolute program/DOF.`);
  }
  const stock = document.externalStock?.[0];
  if (stock === undefined || document.externalStock?.length !== 1) {
    throw new Error(`${role} must retain exactly one canonical external stock item.`);
  }
  const stockHash = await canonicalStockHash(stock);
  const stockMesh = bundle.scene.meshes.find((mesh) => mesh.stockItemId === stock.id);
  const stockBom = bundle.bom.entries.find((entry) => entry.stockItemId === stock.id);
  const fabricationPartIds = bundle.fabrication.sheets.flatMap((sheet) =>
    sheet.placements.map((placement) => placement.partId),
  );
  const generatedSheetSvg = manifest.artifacts
    .filter((artifact) => artifact.path.startsWith(`${role === "named" ? "named" : "off-family"}/sheet-`))
    .map((artifact) => artifact.path);
  const partIds = document.parts.map((part) => part.id).sort();
  const projectionPartIdSets = [
    fabricationPartIds.toSorted(),
    bundle.scene.meshes
      .filter((mesh) => mesh.itemKind !== "external-stock")
      .map((mesh) => mesh.partId)
      .toSorted(),
    bundle.bom.entries
      .filter((entry) => entry.entryKind !== "external-stock")
      .map((entry) => entry.partId)
      .toSorted(),
    bundle.legend?.entries.map((entry) => entry.partId).toSorted() ?? []
  ];
  if (
    stockMesh?.sourcePartHash !== stockHash ||
    stockBom?.sourcePartHash !== stockHash ||
    fabricationPartIds.includes(stock.id) ||
    generatedSheetSvg.length === 0 ||
    projectionPartIdSets.some((ids) => ids.join(",") !== partIds.join(",")) ||
    new Set(bundle.instructions?.steps.flatMap((step) => step.partIds)).size !== partIds.length ||
    partIds.some(
      (partId) => !bundle.instructions?.steps.some((step) => step.partIds.includes(partId)),
    ) ||
    [
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash
    ].some((hash) => hash !== documentHash)
  ) {
    throw new Error(`${role} canonical projection identity/hash boundary changed.`);
  }
  const sheetSvgById = new Map<string, string>();
  for (const path of generatedSheetSvg) {
    const svg = await readFile(new URL(path, outputDirectoryUrl), "utf8");
    sheetSvgById.set(path.slice(path.lastIndexOf("/") + 1, -4), svg);
    if (svg.includes(stock.id)) {
      throw new Error(`${role} external stock leaked into SVG fabrication output.`);
    }
  }
  for (const part of document.parts) {
    const partHash = await canonicalPartHash(part);
    const mesh = bundle.scene.meshes.find((item) => item.partId === part.id);
    const bomEntry = bundle.bom.entries.find((item) => item.partId === part.id);
    const sheet = bundle.fabrication.sheets.find((item) =>
      item.placements.some((placement) => placement.partId === part.id),
    );
    const paths = sheet?.paths.filter((path) => path.partId === part.id) ?? [];
    const svg = sheet === undefined ? undefined : sheetSvgById.get(sheet.id);
    if (
      mesh?.sourcePartHash !== partHash ||
      bomEntry?.sourcePartHash !== partHash ||
      paths.length === 0 ||
      paths.some((path) => path.sourceNominalHash !== partHash) ||
      !svg?.includes(`data-part-id="${part.id}"`) ||
      !svg.includes(`data-source-nominal-hash="${partHash}"`)
    ) {
      throw new Error(`${role} part ${part.id} lost a canonical ID/hash linkage.`);
    }
  }
  const motion = document.motionConstraints[0];
  const details = motion.revolute!;
  const boundaries = new Set(details.proofModel.axisPartitionBoundariesUm);
  const partitionStart = details.proofModel.sectionIntervals[0]!.axialStartUm;
  const partitionEnd = details.proofModel.sectionIntervals.at(-1)!.axialEndUm;
  const missingPrimitiveBoundary = details.proofModel.sectionPrimitives.some(
    (primitive) =>
      [primitive.axialStartUm, primitive.axialEndUm].some(
        (boundary) =>
          boundary >= partitionStart && boundary <= partitionEnd && !boundaries.has(boundary),
      ),
  );
  const maximumKerfUm = Math.round(
    Math.max(document.resolvedInputs.machine.kerfMm.x, document.resolvedInputs.machine.kerfMm.y) *
      1_000,
  );
  const compensatedToolpathDiameterUm = details.boreDiameterUm - maximumKerfUm;
  const reconstructedMinimumFinishedBoreUm = compensatedToolpathDiameterUm + maximumKerfUm;
  if (
    details.proofModel.inflationUm <= 0 ||
    details.proofModel.sectionIntervals.length + 1 !== boundaries.size ||
    missingPrimitiveBoundary ||
    compensatedToolpathDiameterUm <= 0 ||
    reconstructedMinimumFinishedBoreUm - stock.stockProfile.measuredMaximumDiameterUm <= 0 ||
    details.retention.retainedTravel.minimumDegrees > motion.range.minimum ||
    details.retention.retainedTravel.maximumDegrees < motion.range.maximum ||
    details.retention.retainerPartIds.length !== 2
  ) {
    throw new Error(`${role} motion partition, compensated clearance, or retention proof changed.`);
  }
  const bomAndInstructions = JSON.stringify({ bom: bundle.bom, instructions: bundle.instructions });
  if (/glue|adhesive/i.test(bomAndInstructions)) {
    throw new Error(`${role} introduced glue into BOM or instructions.`);
  }
  if (
    bundle.scene.states.map((state) => state.kind).join(",") !== "assembled,exploded,open" ||
    bundle.scene.motions?.[0]?.animationSampleMaximumDegrees !== 2 ||
    bundle.instructions?.steps.filter(
      (step) => step.stockItemIds?.includes(stock.id),
    ).map((step) => step.phase).join(",") !== "assembly,disassembly"
  ) {
    throw new Error(`${role} scene/motion/instruction projection contract changed.`);
  }
}

const reports = [
  "proofs/construction-search.json",
  "proofs/hash-separation.json",
  "proofs/seeded-interference.json",
  "proofs/negative-validation.json",
  "proofs/motion-architecture-review.json"
] as const;
for (const path of reports) {
  const report = z
    .object({
      schemaVersion: z.literal("1.0"),
      milestone: z.literal("M3"),
      assertions: z.record(z.string(), z.literal(true))
    })
    .loose()
    .parse(await readJson(path));
  if (Object.keys(report.assertions).length === 0) {
    throw new Error(`${path} has no acceptance assertions.`);
  }
}

const construction = z
  .object({
    resolvedDeferralFrom: z.literal("M2.1"),
    selected: z.object({
      searchPolicyVersion: z.literal("1.0.0"),
      preferredCandidateId: z.literal("five-station"),
      selectedCandidateId: z.literal("three-station"),
      changedConstruction: z.literal(true),
      disclosure: z.string().includes("without changing thickness, kerf, pin diameter")
    }).loose(),
    replayGeometryHashes: z.tuple([HashSchema, HashSchema]),
    noCandidate: z.object({
      code: z.literal("RETAINED_PIN_CONSTRUCTION_UNAVAILABLE"),
      measuredInputs: z.object({
        thicknessUm: z.literal(3_000),
        pinDiameterUm: z.literal(3_000),
        kerfXUm: z.literal(150),
        kerfYUm: z.literal(160)
      }).strict()
    }).loose()
  })
  .loose()
  .parse(await readJson("proofs/construction-search.json"));
if (construction.replayGeometryHashes[0] !== construction.replayGeometryHashes[1]) {
  throw new Error("M2.1 deferred fallback is no longer replay-stable.");
}

const interference = z
  .object({
    midAngleOnly: z.object({
      seed: z.object({
        nominalCenterAngleDegrees: z.literal(52.5),
        axialScope: z.literal("all-axis-intervals")
      }).loose(),
      proof: z.object({
        status: z.literal("fail"),
        collisions: z.array(z.object({
          axialIntervalId: z.string(),
          angleDegrees: z.number().gt(0).lt(105)
        }).loose()).min(2),
        indeterminatePairs: z.array(z.unknown()).length(0)
      }).loose()
    }).loose(),
    axialStationOnly: z.object({
      seed: z.object({
        nominalCenterAngleDegrees: z.literal(52.5),
        axialIntervalId: z.string().min(1)
      }).loose(),
      proof: z.object({
        status: z.literal("fail"),
        collisions: z.array(z.object({
          axialIntervalId: z.string(),
          angleDegrees: z.number().gt(0).lt(105)
        }).loose()).length(1),
        indeterminatePairs: z.array(z.unknown()).length(0)
      }).loose()
    }).loose()
  })
  .loose()
  .parse(await readJson("proofs/seeded-interference.json"));
if (
  new Set(interference.midAngleOnly.proof.collisions.map((collision) => collision.axialIntervalId))
    .size !== interference.midAngleOnly.proof.collisions.length
) {
  throw new Error("Seeded M3 mid-angle collision no longer spans distinct axial intervals.");
}
if (
  interference.axialStationOnly.proof.collisions[0]?.axialIntervalId !==
  interference.axialStationOnly.seed.axialIntervalId
) {
  throw new Error("Seeded M3 collision is no longer isolated to its axial interval.");
}

const operatorProofs = z
  .object({
    proofs: z.array(z.object({
      proofRole: z.enum(["named", "off-family"]),
      runtimeApplicationApiCalls: z.literal(0),
      proof: z.object({
        method: z.literal("axis-partition-conservative-angle-interval"),
        rotationSign: z.literal(-1),
        status: z.literal("pass"),
        collisions: z.array(z.unknown()).length(0),
        indeterminatePairs: z.array(z.unknown()).length(0),
        animationSampleMaximumDegrees: z.literal(2),
        endpointContacts: z.array(z.object({
          nominalGapUm: z.literal(0),
          status: z.literal("certified"),
          conservativeInteriorStatus: z.literal("certified"),
          positiveAwayFromEndpoint: z.literal(true),
          monotoneSeparation: z.literal(true)
        }).loose()).length(3)
      }).loose()
    }).loose()).length(2)
  })
  .loose()
  .parse(await readJson("proofs/operator-proof-reports.json"));
if (new Set(operatorProofs.proofs.map((proof) => proof.proofRole)).size !== 2) {
  throw new Error("M3 proof set no longer contains named and off-family coverage.");
}

const architectureReview = z
  .object({
    trigger: z.literal("shared-motion-validation-approaches-500-logical-lines"),
    measuredLogicalLines: z.record(z.string(), z.number().int().positive()),
    decision: z.object({
      status: z.literal("reviewed-retain-focused-modules"),
      rejectedAlternatives: z.array(z.string()).min(3),
      futureBoundary: z.string().min(1)
    }).loose()
  })
  .loose()
  .parse(await readJson("proofs/motion-architecture-review.json"));
if (
  Object.values(architectureReview.measuredLogicalLines).reduce(
    (total, count) => total + count,
    0,
  ) < 500
) {
  throw new Error("M3 motion architecture review no longer records its triggered threshold.");
}

const golden = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M3"),
    cases: z.array(z.unknown()).length(6)
  })
  .strict()
  .parse(await readJson("golden-matrix.json"));
void golden;

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M3 artifact hashes, two operator proofs, bounded motion, stock exclusion, and M2.1 fallback resolution.\n`,
);
