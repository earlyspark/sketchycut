import { readFile, stat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  CapturedSlideProgramV1Schema,
  DesignDocumentV1Schema,
  ProjectionBundleSchema,
  XToolStudioHandoffSchema,
  canonicalArtifactSetHash,
  canonicalDocumentHash,
  canonicalGeometryHash,
  canonicalPartHash,
  certifyPrismaticTravel,
  sha256,
  validateFabricationProjection
} from "../src/index.js";
import { buildCombinedMotionGoldenMatrix } from "../tests/helpers/m4-golden.js";

const root = new URL("../artifacts/m4/", import.meta.url);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M4"),
  generator: z.object({
    id: z.literal("m4-artifact-generator"),
    version: z.literal("1.0.0")
  }).strict(),
  geometryHashes: z.object({ named: HashSchema, offFamily: HashSchema }).strict(),
  evaluatedDocumentHashes: z.object({ named: HashSchema, offFamily: HashSchema }).strict(),
  runtimeApplicationApiCalls: z.literal(0),
  physicalVerification: z.literal("required"),
  artifacts: z.array(z.object({
    path: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: HashSchema
  }).strict())
}).strict();

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as unknown;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function openIntervalContains(
  interval: { minimumExclusiveUm: number; maximumExclusiveUm: number },
  value: number,
): boolean {
  return value > interval.minimumExclusiveUm && value < interval.maximumExclusiveUm;
}

const manifest = ManifestSchema.parse(await readJson("artifact-manifest.json"));
if (new Set(manifest.artifacts.map((artifact) => artifact.path)).size !== manifest.artifacts.length) {
  throw new Error("M4 artifact manifest contains duplicate paths.");
}
for (const artifact of manifest.artifacts) {
  const url = new URL(artifact.path, root);
  const [contents, metadata] = await Promise.all([readFile(url), stat(url)]);
  if (metadata.size !== artifact.bytes) {
    throw new Error(`${artifact.path} byte count changed.`);
  }
  if (await sha256(contents) !== artifact.sha256) {
    throw new Error(`${artifact.path} hash changed.`);
  }
}

const namedProgram = CapturedSlideProgramV1Schema.parse(await readJson("named/program.json"));
const offFamilyProgram = CapturedSlideProgramV1Schema.parse(
  await readJson("off-family/program.json"),
);
const named = DesignDocumentV1Schema.parse(await readJson("named/project.json"));
const offFamily = DesignDocumentV1Schema.parse(await readJson("off-family/project.json"));
const namedBundle = ProjectionBundleSchema.parse(await readJson("named/projection-bundle.json"));
const offFamilyBundle = ProjectionBundleSchema.parse(
  await readJson("off-family/projection-bundle.json"),
);
const handoff = XToolStudioHandoffSchema.parse(await readJson("named/handoff.json"));

if (
  await canonicalGeometryHash(named) !== manifest.geometryHashes.named ||
  await canonicalGeometryHash(offFamily) !== manifest.geometryHashes.offFamily ||
  await canonicalDocumentHash(named) !== manifest.evaluatedDocumentHashes.named ||
  await canonicalDocumentHash(offFamily) !== manifest.evaluatedDocumentHashes.offFamily
) {
  throw new Error("M4 canonical geometry/evaluated hashes no longer match recomputation.");
}

for (const [role, document, program, bundle] of [
  ["named", named, namedProgram, namedBundle],
  ["off-family", offFamily, offFamilyProgram, offFamilyBundle]
] as const) {
  const documentHash = await canonicalDocumentHash(document);
  const warningCodes = document.validation.findings.map((finding) => finding.code);
  if (
    document.projectId !== program.projectId ||
    document.validation.status !== "pass" ||
    warningCodes.join(",") !== "CALIBRATION_REQUIRED,PHYSICAL_VERIFICATION_REQUIRED" ||
    validateFabricationProjection(bundle.fabrication, document.parts).status !== "pass"
  ) {
    throw new Error(`${role} canonical/fabrication validation or warning boundary changed.`);
  }
  if (
    document.operatorProgram.length !== 5 ||
    !document.operatorProgram.some((entry) =>
      entry.operatorId === "captured-panel-slide" && entry.operatorVersion === "1.0.0") ||
    document.motionConstraints.length !== 1 ||
    document.motionConstraints[0]?.kind !== "prismatic" ||
    document.motionConstraints.some((constraint) => constraint.kind === "revolute")
  ) {
    throw new Error(`${role} no longer uses one captured-panel-slide prismatic DOF.`);
  }
  const constraint = document.motionConstraints[0];
  const details = constraint.prismatic!;
  if (
    constraint.range.unit !== "mm" ||
    constraint.range.minimum * 1_000 !== details.normalTravelUm.minimum ||
    constraint.range.maximum * 1_000 !== details.normalTravelUm.maximum ||
    details.states.closedUm !== details.normalTravelUm.minimum ||
    details.states.fullyOpenUm !== details.normalTravelUm.maximum ||
    details.states.removal.positionUm <= details.states.fullyOpenUm ||
    details.states.removal.retainerPartIds.length !== 1
  ) {
    throw new Error(`${role} closed/open/removal state contract changed.`);
  }
  const vertical = details.capture.vertical;
  const lateral = details.capture.lateral;
  if (
    vertical.panelMinimumZUm - vertical.lowerSupportMaximumZUm !== vertical.lowerClearanceUm ||
    vertical.upperRetainerMinimumZUm - vertical.panelMaximumZUm !== vertical.upperClearanceUm ||
    vertical.retainerOverlapUm <= 0 ||
    lateral.panelMinimumXUm - lateral.leftGuideInnerXUm !== lateral.leftClearanceUm ||
    lateral.rightGuideInnerXUm - lateral.panelMaximumXUm !== lateral.rightClearanceUm ||
    lateral.guideOverlapUm <= 0 ||
    details.runningClearance.projectedFinishedVerticalUm <= 0 ||
    details.runningClearance.projectedFinishedLateralUm <= 0 ||
    details.runningClearance.projectedFinishedVerticalUm !==
      details.runningClearance.verticalTotalUm ||
    details.runningClearance.projectedFinishedLateralUm !==
      details.runningClearance.lateralTotalUm
  ) {
    throw new Error(`${role} capture or reconstructed compensated clearance changed.`);
  }
  for (const engagement of details.capture.railEngagement) {
    const overlapAt = (travelUm: number) => Math.max(
      0,
      Math.min(engagement.movingAxialEndUm + travelUm, engagement.guideAxialEndUm) -
        Math.max(engagement.movingAxialStartUm + travelUm, engagement.guideAxialStartUm),
    );
    if (
      Math.min(
        overlapAt(details.normalTravelUm.minimum),
        overlapAt(details.normalTravelUm.maximum),
      ) < engagement.minimumRequiredUm ||
      !details.retention.guidePartIds.includes(engagement.guidePartId)
    ) {
      throw new Error(`${role} rail engagement no longer holds over full normal travel.`);
    }
  }
  const proof = certifyPrismaticTravel(constraint);
  if (
    proof.status !== "pass" ||
    proof.normalTravelConflicts.length !== 0 ||
    proof.overlappingTransversePairCount !== proof.forbiddenIntervals.length ||
    proof.forbiddenIntervals.length !== 2 ||
    !proof.canonicalIntervalsMatch ||
    proof.endpointContacts.length !== 2 ||
    proof.endpointContacts.some((contact) => contact.status !== "certified")
  ) {
    throw new Error(`${role} exact forbidden-interval proof changed.`);
  }
  const closedInterval = proof.forbiddenIntervals.find(
    (interval) => interval.maximumExclusiveUm === details.states.closedUm,
  );
  if (
    closedInterval === undefined ||
    closedInterval.minimumExclusiveUm > details.states.closedUm - details.stops.closed.wallThicknessUm
  ) {
    throw new Error(`${role} closed stop can no longer prove wall non-bypass.`);
  }
  if (
    details.retention.guidePartIds.length !== 2 ||
    details.retention.removableRetainerPartIds.length !== 1 ||
    details.retention.mechanicalJointIds.some((jointId) =>
      !document.joints.some((joint) =>
        joint.id === jointId && joint.kind === "retainer-seat"))
  ) {
    throw new Error(`${role} mechanical no-glue retention changed.`);
  }
  const retainerId = details.retention.removableRetainerPartIds[0]!;
  const installActions = document.assemblyPlan.filter((action) =>
    action.action === "insert" && action.partIds.includes(retainerId));
  const removalActions = document.assemblyPlan.filter((action) =>
    action.action === "remove" && action.phase === "disassembly" &&
      action.partIds.includes(retainerId));
  if (
    document.parts.filter((part) => part.id === retainerId).length !== 1 ||
    document.parts.filter((part) =>
      part.assemblyDependencyPartIds.includes(retainerId)).length !== 1 ||
    installActions.length !== 1 ||
    removalActions.length !== 1 ||
    !document.assemblyPlan.some((action) =>
      action.action === "remove" && action.phase === "disassembly" &&
      constraint.bodyPartIds.every((partId) => action.partIds.includes(partId)) &&
      action.dependsOnActionIds.includes(removalActions[0]!.id))
  ) {
    throw new Error(`${role} removable retainer dependency/action contract changed.`);
  }
  const partIds = sorted(document.parts.map((part) => part.id));
  const projectionPartIdSets = [
    sorted(bundle.fabrication.sheets.flatMap((sheet) =>
      sheet.placements.map((placement) => placement.partId))),
    sorted(bundle.scene.meshes.map((mesh) => mesh.partId)),
    sorted(bundle.bom.entries.map((entry) => entry.partId)),
    sorted(bundle.legend?.entries.map((entry) => entry.partId) ?? [])
  ];
  if (
    projectionPartIdSets.some((ids) => ids.join(",") !== partIds.join(",")) ||
    new Set(bundle.instructions?.steps.flatMap((step) => step.partIds)).size !== partIds.length ||
    partIds.some((partId) =>
      !bundle.instructions?.steps.some((step) => step.partIds.includes(partId))) ||
    [
      bundle.sourceDocumentHash,
      bundle.fabrication.sourceDocumentHash,
      bundle.scene.sourceDocumentHash,
      bundle.bom.sourceDocumentHash,
      bundle.legend?.sourceDocumentHash,
      bundle.instructions?.sourceDocumentHash
    ].some((hash) => hash !== documentHash)
  ) {
    throw new Error(`${role} canonical projection linkage changed.`);
  }
  const svgPaths = manifest.artifacts.filter((artifact) =>
    artifact.path.startsWith(`${role === "named" ? "named" : "off-family"}/sheet-`) &&
    artifact.path.endsWith(".svg"));
  if (svgPaths.length !== bundle.fabrication.sheets.length) {
    throw new Error(`${role} fabrication SVG count changed.`);
  }
  const svgBySheet = new Map<string, string>();
  for (const artifact of svgPaths) {
    const svg = await readFile(new URL(artifact.path, root), "utf8");
    svgBySheet.set(artifact.path.slice(artifact.path.lastIndexOf("/") + 1, -4), svg);
  }
  for (const part of document.parts) {
    const partHash = await canonicalPartHash(part);
    const placements = bundle.fabrication.sheets.flatMap((sheet) =>
      sheet.placements.filter((placement) => placement.partId === part.id));
    const meshes = bundle.scene.meshes.filter((mesh) => mesh.partId === part.id);
    const bomEntries = bundle.bom.entries.filter((entry) => entry.partId === part.id);
    const legendEntries = bundle.legend?.entries.filter((entry) => entry.partId === part.id) ?? [];
    const sheet = bundle.fabrication.sheets.find((item) =>
      item.placements.some((placement) => placement.partId === part.id));
    const paths = sheet?.paths.filter((path) => path.partId === part.id) ?? [];
    const svg = sheet === undefined ? undefined : svgBySheet.get(sheet.id);
    if (
      placements.length !== 1 || meshes.length !== 1 || bomEntries.length !== 1 ||
      legendEntries.length !== 1 || meshes[0]?.sourcePartHash !== partHash ||
      bomEntries[0]?.sourcePartHash !== partHash || paths.length === 0 ||
      paths.some((path) => path.sourceNominalHash !== partHash) ||
      !svg?.includes(`data-part-id="${part.id}"`) ||
      !svg.includes(`data-source-nominal-hash="${partHash}"`)
    ) {
      throw new Error(`${role} part ${part.id} lost exact one-copy ID/hash projection linkage.`);
    }
  }
  if (
    bundle.scene.states.map((state) => state.kind).join(",") !==
      "assembled,exploded,closed,open,removal" ||
    bundle.scene.motions?.length !== 1 ||
    bundle.scene.motions[0]?.kind !== "prismatic" ||
    bundle.scene.motions[0].constraintId !== constraint.id
  ) {
    throw new Error(`${role} canonical scene state/motion projection changed.`);
  }
  const stateTranslationY = (kind: "closed" | "open" | "removal") =>
    bundle.scene.states.find((state) => state.kind === kind)!.instances.find(
      (instance) => instance.partId === constraint.bodyPartIds[0],
    )!.translationMm.yMm;
  const retainerTranslation = (kind: "closed" | "removal") =>
    bundle.scene.states.find((state) => state.kind === kind)!.instances.find(
      (instance) => instance.partId === retainerId,
    )!.translationMm;
  if (
    stateTranslationY("closed") - stateTranslationY("open") !== constraint.range.maximum ||
    stateTranslationY("closed") - stateTranslationY("removal") !==
      details.states.removal.positionUm / 1_000 ||
    JSON.stringify(retainerTranslation("closed")) ===
      JSON.stringify(retainerTranslation("removal"))
  ) {
    throw new Error(`${role} closed/open/removal scene transforms changed.`);
  }
}

const productGroup = handoff.artifactGroups.find((group) => group.id === "product")!;
if (
  productGroup.sourceDocumentHash !== manifest.evaluatedDocumentHashes.named ||
  productGroup.artifactSetHash !== await canonicalArtifactSetHash(
    "product",
    productGroup.sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      svgSha256: sheet.svgSha256
    })),
  )
) {
  throw new Error("M4 product handoff identity or no-double-compensation contract changed.");
}

const narrow = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M4"),
  seed: z.object({
    interval: z.object({
      id: z.string(),
      minimumExclusiveUm: z.number().int(),
      maximumExclusiveUm: z.number().int()
    }).loose(),
    widthUm: z.number().int().positive().lt(1_000),
    normalEndpointsUm: z.tuple([z.literal(0), z.literal(60_000)]),
    animationSampleStepUm: z.literal(1_000),
    animationSamplesUm: z.array(z.number().int()).length(61)
  }).strict(),
  proof: z.object({
    status: z.literal("fail"),
    normalTravelConflicts: z.array(z.object({ id: z.string() }).loose()).min(1)
  }).loose(),
  validation: z.object({
    status: z.literal("fail"),
    findings: z.array(z.object({
      code: z.string(),
      blocksExport: z.boolean()
    }).loose()).min(1)
  }).loose()
}).loose().parse(await readJson("proofs/narrow-obstruction.json"));
if (
  narrow.seed.widthUm !==
    narrow.seed.interval.maximumExclusiveUm - narrow.seed.interval.minimumExclusiveUm ||
  narrow.seed.normalEndpointsUm.some((sample) => openIntervalContains(narrow.seed.interval, sample)) ||
  narrow.seed.animationSamplesUm.some((sample) => openIntervalContains(narrow.seed.interval, sample)) ||
  !narrow.proof.normalTravelConflicts.some((interval) => interval.id === narrow.seed.interval.id) ||
  !narrow.validation.findings.some((finding) =>
    finding.code === "PRISMATIC_TRAVEL_COLLISION" && finding.blocksExport)
) {
  throw new Error("M4 narrow-obstruction exact-vs-sampled evidence changed.");
}

const fixedGoldenRaw = await readJson("golden-matrix.json");
const fixedGolden = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M4-combined-motion"),
  revolute: z.object({ cases: z.array(z.unknown()).length(6) }).loose(),
  prismatic: z.object({ cases: z.array(z.unknown()).length(6) }).loose()
}).strict().parse(fixedGoldenRaw);
void fixedGolden;
if (!isDeepStrictEqual(await buildCombinedMotionGoldenMatrix(), fixedGoldenRaw)) {
  throw new Error("M4 combined revolute/prismatic golden no longer matches recomputation.");
}

const architecture = z.object({
  trigger: z.literal("proximity-to-500-logical-line-motion-complexity-tripwire"),
  measuredLogicalLines: z.record(z.string(), z.number().int().positive()),
  thresholdLogicalLines: z.literal(500),
  decision: z.object({
    status: z.literal("reviewed-retain-two-operator-owned-modules"),
    rejectedAlternatives: z.array(z.string()).length(3),
    futureBoundary: z.string().min(1)
  }).loose()
}).loose().parse(await readJson("proofs/motion-architecture-review.json"));
const currentProofSources = await Promise.all([
  readFile(new URL("../src/validation/prismatic-proof.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/validation/prismatic.ts", import.meta.url), "utf8")
]);
const currentLineCounts = Object.fromEntries([
  "src/validation/prismatic-proof.ts",
  "src/validation/prismatic.ts"
].map((path, index) => [path, currentProofSources[index]!.split(/\r?\n/u).filter((line) => {
  const trimmed = line.trim();
  return trimmed.length > 0 && !trimmed.startsWith("//");
}).length]));
if (
  JSON.stringify(currentLineCounts) !== JSON.stringify(architecture.measuredLogicalLines) ||
  Object.values(currentLineCounts).reduce((sum, count) => sum + count, 0) > 500
) {
  throw new Error("M4 prismatic architecture review no longer matches source/tripwire.");
}

const identity = z.object({
  protectedExamples: z.array(z.object({
    geometryHash: HashSchema,
    sourceDocumentHash: HashSchema,
    svgSha256: HashSchema,
    artifactSetHash: HashSchema,
    handoffSha256: HashSchema,
    runtimeApplicationApiCalls: z.literal(0)
  }).loose()).length(2),
  capturedSlide: z.object({
    geometryHash: HashSchema,
    sourceDocumentHash: HashSchema,
    svgSha256: HashSchema,
    artifactSetHash: HashSchema,
    handoffSha256: HashSchema,
    studioImportEvidence: z.literal(
      "none; xTool Studio-targeted fabrication candidate; import verification required",
    ),
    runtimeApplicationApiCalls: z.literal(0)
  }).loose(),
  optionalFitTest: z.object({
    sourceDocumentHash: HashSchema,
    svgSha256: HashSchema,
    artifactSetHash: HashSchema
  }).strict(),
  protectedGoldenSha256: z.record(z.string(), HashSchema),
  runtimeApplicationApiCalls: z.literal(0),
  physicalVerification: z.literal("required")
}).loose().parse(await readJson("identity-ledger.json"));
const expectedProtected = [
  [
    "b60886c111a9039226fc69ae3f8ab883e88bf2dadbcae58224c4186c9c1cd1b5",
    "17a51ce72c0edd58e6d7f7d4627ab887f9194c7ca2f0e2954cf0049bffa58dad",
    "0c00350bb3ce195c2f0ed479acdb7c2fa8b54e594d6b161ad7b0c4365f0aae64",
    "67e26c7d280473f9a567747f192d50555d4f8c9895710839a328cad751a7b89c",
    "073c2a684df29b32fd698140fab72cfe6d98dd3a3bef407069d21643b7eeb4dc"
  ],
  [
    "cf612788f8ec8ae169bb3f029b614b5ebe4ad9f8b0f17732f4d5f08d1be2b664",
    "0cbffb0cf8e2051ce01558c66ba9424d1842e5ce395487f5766a65531c45d381",
    "622314744940326893a8509d648b907bec2a26b9d639ae2c31ea5648338ffadc",
    "d2d84a1e03bb8da5d55048ec3d0efd7c3c2c08396f0766f515dc0d8435bde7e5",
    "3515f141e58cab2f661dc7af368fef4db5db016717533cc382ae6b908af0b56e"
  ]
] as const;
for (const [index, expected] of expectedProtected.entries()) {
  const observed = identity.protectedExamples[index]!;
  if ([
    observed.geometryHash,
    observed.sourceDocumentHash,
    observed.svgSha256,
    observed.artifactSetHash,
    observed.handoffSha256
  ].some((value, valueIndex) => value !== expected[valueIndex])) {
    throw new Error(`Protected M4 predecessor identity drifted at index ${String(index)}.`);
  }
}
if (
  identity.capturedSlide.geometryHash !== manifest.geometryHashes.named ||
  identity.capturedSlide.sourceDocumentHash !== manifest.evaluatedDocumentHashes.named ||
  identity.capturedSlide.svgSha256 !== productGroup.sheets[0]?.svgSha256 ||
  identity.capturedSlide.artifactSetHash !== productGroup.artifactSetHash ||
  identity.optionalFitTest.sourceDocumentHash !==
    "0f80a5523903ce9a206a13560848dcbe1b428514493ac5c7b24c7326815bb7dc" ||
  identity.optionalFitTest.svgSha256 !==
    "2d4296889f9689cea687affd55dcb7bd7242e2340212b1d123d433aebd4b47fc" ||
  identity.optionalFitTest.artifactSetHash !==
    "770d918dfb4b1f193c04ee27e5c12601daeb6ed3c65eec01c4034c061d385a10"
) {
  throw new Error("M4 captured/fit-test identity ledger changed.");
}
const expectedGoldenHashes = {
  m1: "a2e02fa6cd6f58ad1ecf77eab38ea57427d4c4eb9b1b26665d4d9bf0b149dcb3",
  m2: "581178ac0c5a6beda54f452776b0f38e6d02b431a1692db184245f20379df042",
  m3: "c52ccd204a7f5b0929f25f86262729c93f17b3c85453e1e5c2d42781e6e63fcd",
  "m3.1-evaluated": "cff8dc972065574265251eff61a445dea726ed98dae06b3eec363d5201405b23"
};
if (JSON.stringify(identity.protectedGoldenSha256) !== JSON.stringify(expectedGoldenHashes)) {
  throw new Error("Protected pre-M4 golden hashes drifted.");
}

const acceptance = z.object({
  schemaVersion: z.literal("1.0"),
  milestone: z.literal("M4"),
  assertions: z.record(z.string(), z.literal(true))
}).strict().parse(await readJson("proofs/acceptance-assertions.json"));
if (Object.keys(acceptance.assertions).length < 10) {
  throw new Error("M4 generated acceptance assertion set is incomplete.");
}

process.stdout.write(
  `Verified ${String(manifest.artifacts.length)} M4 artifact hashes, exact named/off-family prismatic proofs, narrow obstruction detection, projection identities, and predecessor invariants.\n`,
);
