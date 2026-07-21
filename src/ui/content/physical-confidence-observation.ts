import {
  PhysicalConfidenceObservationDraftSchema,
  type PhysicalConfidenceObservationDraft,
  type PhysicalConfidencePackageManifest
} from "./physical-confidence-contracts.js";

export type PhysicalConfidenceObservationFinding = {
  code:
    | "OBSERVATION_BINDING_MISMATCH"
    | "OBSERVATION_NOT_CUT_CANDIDATE"
    | "OBSERVATION_STUDIO_INCOMPLETE"
    | "OBSERVATION_DIMENSION_MISMATCH"
    | "OBSERVATION_OPERATION_INCOMPLETE"
    | "OBSERVATION_EXTERNAL_PERSONALIZATION_INCOMPLETE"
    | "OBSERVATION_MACHINE_SETUP_INCOMPLETE"
    | "OBSERVATION_CUT_INCOMPLETE"
    | "OBSERVATION_ASSEMBLY_INCOMPLETE"
    | "OBSERVATION_MOTION_INCOMPLETE"
    | "OBSERVATION_MOTIF_INCOMPLETE"
    | "OBSERVATION_MEDIA_INCOMPLETE"
    | "OBSERVATION_GENERATION_REVIEW_INCOMPLETE"
    | "OBSERVATION_RELEASE_CLAIM_INCOMPLETE";
  message: string;
};

export type PhysicalConfidenceObservationEvaluation = {
  status: "pass" | "fail";
  findings: PhysicalConfidenceObservationFinding[];
};

const operationOrder = ["engrave", "score", "cut"] as const;

type StudioOperation = typeof operationOrder[number];
type StudioOperationSettings = {
  powerPercent: number;
  speedMmPerSecond: number;
  passCount: number;
};

const registeredMarkingSettings: Readonly<Record<"engrave" | "score", StudioOperationSettings>> =
  Object.freeze({
    engrave: Object.freeze({ powerPercent: 50, speedMmPerSecond: 240, passCount: 1 }),
    score: Object.freeze({ powerPercent: 40, speedMmPerSecond: 100, passCount: 1 })
  });

function expectedOperationSettings(
  operation: StudioOperation,
  process: PhysicalConfidencePackageManifest["fabricationInput"]["process"],
): StudioOperationSettings | null {
  if (operation !== "cut") return { ...registeredMarkingSettings[operation] };
  if (process === null) return null;
  return {
    powerPercent: process.powerPercent,
    speedMmPerSecond: process.speedMmPerSecond,
    passCount: process.passCount
  };
}

function expectedProcessingOrder(
  counts: Record<(typeof operationOrder)[number], number>,
  externalOperations: readonly StudioOperation[] = [],
) {
  const activeExternalOperations = new Set(externalOperations);
  return operationOrder.filter((operation) =>
    counts[operation] > 0 || activeExternalOperations.has(operation)
  );
}

function expectedMotion(manifest: PhysicalConfidencePackageManifest) {
  if (manifest.candidateId === "basic") return { kind: "none" as const };
  if (manifest.candidateId === "hinged") {
    const retainedPin = manifest.fabricationInput.retainedPin;
    if (retainedPin === null) throw new Error("PHYSICAL_OBSERVATION_RETAINED_PIN_MISSING");
    return {
      kind: "revolute" as const,
      retainedPinBasis: retainedPin.basis,
      effectivePinDiameterMm: retainedPin.effectiveDiameterMm,
      samePinSectionAsCouponConfirmed: null,
      completedFullCycles: null,
      noBinding: null,
      noPinLoss: null,
      noVisibleBoreWebFailure: null
    };
  }
  return {
    kind: "prismatic" as const,
    completedFullCycles: null,
    noBinding: null,
    noUnintendedRelease: null,
    noRailFailure: null
  };
}

export function buildPhysicalConfidenceObservationDraft(
  packageSha256: string,
  manifest: PhysicalConfidencePackageManifest,
): PhysicalConfidenceObservationDraft {
  const product = manifest.artifactGroups.find((group) => group.id === "product");
  if (product === undefined) throw new Error("PHYSICAL_OBSERVATION_PRODUCT_GROUP_MISSING");
  const scoreTreatmentPathCount = product.sheets.reduce(
    (total, sheet) => total + sheet.scoreTreatmentPathCount,
    0,
  );
  return PhysicalConfidenceObservationDraftSchema.parse({
    schemaVersion: "sketchycut-physical-observation@1.3.0",
    binding: {
      stage: manifest.stage,
      candidateId: manifest.candidateId,
      packageSha256,
      inputHash: manifest.inputHash,
      evaluatedDocumentHash: manifest.evaluatedDocumentHash,
      geometryHash: manifest.geometryHash,
      materialProfileHash: manifest.materialProfileHash,
      processRecipeHash: manifest.processRecipeHash,
      fitProfileHash: manifest.fitProfileHash,
      pinProfileHash: manifest.pinProfileHash
    },
    studio: {
      desktopVersion: null,
      firmwareVersion: null,
      importDpi: null,
      oversizePolicy: null,
      sheets: product.sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        svgSha256: sheet.svgSha256,
        expectedSvgRootDimensionsMm: sheet.rootDimensionsMm,
        expectedImportedOccupiedDimensionsMm: sheet.importedOccupiedDimensionsMm,
        observedImportedOccupiedDimensionsMm: null,
        parts: sheet.partDimensionsMm.map((part) => ({
          partId: part.partId,
          expectedDimensionsMm: { width: part.width, height: part.height },
          observedDimensionsMm: null
        })),
        importedViaUpload: null,
        neverResized: null,
        vectorQualityReviewed: null,
        operations: operationOrder.map((operation) => ({
          operation,
          expectedPathCount: sheet.operationPathCounts[operation],
          expectedSettings: sheet.operationPathCounts[operation] > 0
            ? expectedOperationSettings(operation, manifest.fabricationInput.process)
            : null,
          assigned: null,
          outputEnabled: null,
          observedSettings: null
        })),
        externalStudioPersonalizations: [],
        processingOrder: null,
        innerBeforeOuterReviewed: null,
        studioKerfOffsetMm: null
      }))
    },
    machineSetup: {
      module: null,
      initializationAndCalibrationState: null,
      cleanLevelBaseplate: null,
      enclosureInterlockConfirmed: null,
      magneticFixtureCount: null,
      minimumToolpathToFixtureClearanceMm: null,
      allFourCameraViewfinderPointsClear: null,
      framingPathsOnMaterial: null,
      framingFixturesClear: null,
      builtInAirPumpStateConfirmed: null,
      exhaustConfirmed: null,
      continuousSupervisionConfirmed: null,
      fireReadinessConfirmed: null,
      residueCleanupCompleted: null
    },
    cut: {
      exactRecipeHashConfirmed: null,
      cutThroughConfirmed: null,
      affectedPartsIntact: null
    },
    assembly: {
      usedGeneratedInstructionsOnly: null,
      structuralGlueUsed: null,
      assembled: null,
      fingerTabJointsSeatByHand: null,
      noJointFracture: null,
      noSpontaneousJointSeparation: null,
      majorDimensions: (["width", "depth", "height"] as const).map((axis) => ({
        axis,
        expectedMm: manifest.expectedFinishedEnvelopeMm[axis],
        observedMm: null
      }))
    },
    motion: expectedMotion(manifest),
    motif: scoreTreatmentPathCount > 0
      ? {
          evidence: "registered-score-surface-treatment",
          visible: null,
          structuralKeepoutsUndamaged: null
        }
      : { evidence: "not-applicable" },
    media: [],
    deviations: [],
    generationObservationReview: {
      windowStart: null,
      windowEnd: null,
      eligibleSampleSize: null,
      requestMixLimitation: null,
      broadGeneralizationClaimed: null
    },
    usedHistoricalArtifact: null,
    releaseClaimsAligned: null
  });
}

function dimensionsAgree(
  expected: { width: number; height: number },
  observed: { width: number; height: number } | null,
  toleranceMm: number,
): boolean {
  return observed !== null &&
    Math.abs(expected.width - observed.width) <= toleranceMm &&
    Math.abs(expected.height - observed.height) <= toleranceMm;
}

function add(
  findings: PhysicalConfidenceObservationFinding[],
  condition: boolean,
  code: PhysicalConfidenceObservationFinding["code"],
  message: string,
): void {
  if (!condition) findings.push({ code, message });
}

export function evaluatePhysicalConfidenceObservation(
  candidate: PhysicalConfidenceObservationDraft,
  packageSha256: string,
  manifest: PhysicalConfidencePackageManifest,
): PhysicalConfidenceObservationEvaluation {
  const observation = PhysicalConfidenceObservationDraftSchema.parse(candidate);
  const findings: PhysicalConfidenceObservationFinding[] = [];
  const binding = observation.binding;
  const expectedBinding = {
    stage: manifest.stage,
    candidateId: manifest.candidateId,
    packageSha256,
    inputHash: manifest.inputHash,
    evaluatedDocumentHash: manifest.evaluatedDocumentHash,
    geometryHash: manifest.geometryHash,
    materialProfileHash: manifest.materialProfileHash,
    processRecipeHash: manifest.processRecipeHash,
    fitProfileHash: manifest.fitProfileHash,
    pinProfileHash: manifest.pinProfileHash
  };
  add(
    findings,
    JSON.stringify(binding) === JSON.stringify(expectedBinding),
    "OBSERVATION_BINDING_MISMATCH",
    "Observation hashes or candidate identity do not match the exact package manifest.",
  );
  add(
    findings,
    manifest.stage === "cut-candidate",
    "OBSERVATION_NOT_CUT_CANDIDATE",
    "Only exact cut-candidate bytes with fixture-derived cut width, evidence-backed fit for every consumed class (including exact source hashes for any product-observed adjustment), and a recorded process can receive physical acceptance evidence.",
  );

  const expectedProcess = manifest.fabricationInput.process;
  add(
    findings,
    expectedProcess !== null &&
      observation.studio.desktopVersion === expectedProcess.studioDesktopVersion &&
      observation.studio.firmwareVersion === expectedProcess.firmwareVersion &&
      observation.studio.importDpi !== null &&
      observation.studio.oversizePolicy !== null,
    "OBSERVATION_STUDIO_INCOMPLETE",
    "Studio version, firmware, DPI, and oversize policy must match the recorded cut-candidate process.",
  );

  const product = manifest.artifactGroups.find((group) => group.id === "product");
  if (product === undefined) throw new Error("PHYSICAL_OBSERVATION_PRODUCT_GROUP_MISSING");
  for (const expectedSheet of product.sheets) {
    const sheet = observation.studio.sheets.find((item) => item.sheetId === expectedSheet.sheetId);
    add(
      findings,
      sheet?.svgSha256 === expectedSheet.svgSha256,
      "OBSERVATION_BINDING_MISMATCH",
      `Studio observation is missing exact sheet ${expectedSheet.sheetId}.`,
    );
    if (sheet === undefined) continue;
    add(
      findings,
      dimensionsAgree(
        expectedSheet.importedOccupiedDimensionsMm,
        sheet.observedImportedOccupiedDimensionsMm,
        0.1,
      ),
      "OBSERVATION_DIMENSION_MISMATCH",
      `${expectedSheet.sheetId} imported occupied dimensions do not agree within 0.1 mm.`,
    );
    for (const expectedPart of expectedSheet.partDimensionsMm) {
      const part = sheet.parts.find((item) => item.partId === expectedPart.partId);
      add(
        findings,
        dimensionsAgree(
          { width: expectedPart.width, height: expectedPart.height },
          part?.observedDimensionsMm ?? null,
          0.1,
        ),
        "OBSERVATION_DIMENSION_MISMATCH",
        `${expectedSheet.sheetId}/${expectedPart.partId} dimensions do not agree within 0.1 mm.`,
      );
    }
    add(
      findings,
      sheet.importedViaUpload === true &&
        sheet.neverResized === true &&
        sheet.vectorQualityReviewed === true &&
        sheet.studioKerfOffsetMm === 0 &&
        JSON.stringify(sheet.processingOrder) ===
          JSON.stringify(expectedProcessingOrder(
            expectedSheet.operationPathCounts,
            sheet.externalStudioPersonalizations.map((item) => item.operation),
          )) &&
        sheet.innerBeforeOuterReviewed === true,
      "OBSERVATION_STUDIO_INCOMPLETE",
      `${expectedSheet.sheetId} import method, resize state, vector review, order, inner-before-outer review, or Kerf Offset is incomplete.`,
    );
    const expectedPartIds = new Set(expectedSheet.partDimensionsMm.map((part) => part.partId));
    for (const personalization of sheet.externalStudioPersonalizations) {
      add(
        findings,
        expectedPartIds.has(personalization.affectedPartId) &&
          personalization.withinAffectedPartBoundaryConfirmed === true &&
          personalization.structuralKeepoutClearConfirmed === true &&
          personalization.outputEnabled === true &&
          JSON.stringify(personalization.observedSettings) ===
            JSON.stringify(registeredMarkingSettings.engrave),
        "OBSERVATION_EXTERNAL_PERSONALIZATION_INCOMPLETE",
        `${expectedSheet.sheetId}/${personalization.personalizationId} must remain an explicitly user-added Engrave on a known part, clear the structural keep-outs, and use the registered Engrave settings without modifying canonical structural paths.`,
      );
    }
    for (const operation of operationOrder) {
      const expectedCount = expectedSheet.operationPathCounts[operation];
      const recorded = sheet.operations.find((item) => item.operation === operation);
      const required = expectedCount > 0;
      const expectedSettings = required
        ? expectedOperationSettings(operation, manifest.fabricationInput.process)
        : null;
      add(
        findings,
        recorded?.expectedPathCount === expectedCount &&
          JSON.stringify(recorded.expectedSettings) === JSON.stringify(expectedSettings) &&
          (!required || (
            recorded.assigned === true &&
            recorded.outputEnabled === true &&
            JSON.stringify(recorded.observedSettings) === JSON.stringify(expectedSettings)
          )),
        "OBSERVATION_OPERATION_INCOMPLETE",
        `${expectedSheet.sheetId} ${operation} assignment/output/settings do not match the registered handoff.`,
      );
    }
  }

  const setup = observation.machineSetup;
  add(
    findings,
    setup.module === "xTool M2 20W blue-light" &&
      setup.initializationAndCalibrationState !== null &&
      setup.cleanLevelBaseplate === true &&
      setup.enclosureInterlockConfirmed === true &&
      setup.magneticFixtureCount === 4 &&
      setup.minimumToolpathToFixtureClearanceMm !== null &&
      setup.minimumToolpathToFixtureClearanceMm >= 5 &&
      setup.allFourCameraViewfinderPointsClear === true &&
      setup.framingPathsOnMaterial === true &&
      setup.framingFixturesClear === true &&
      setup.builtInAirPumpStateConfirmed === true &&
      setup.exhaustConfirmed === true &&
      setup.continuousSupervisionConfirmed === true &&
      setup.fireReadinessConfirmed === true &&
      setup.residueCleanupCompleted === true,
    "OBSERVATION_MACHINE_SETUP_INCOMPLETE",
    "The exact M2 setup, four-fixture, 5 mm clearance, framing, air, exhaust, supervision, fire, and cleanup record is incomplete.",
  );
  add(
    findings,
    observation.cut.exactRecipeHashConfirmed === manifest.processRecipeHash &&
      observation.cut.cutThroughConfirmed === true &&
      observation.cut.affectedPartsIntact === true,
    "OBSERVATION_CUT_INCOMPLETE",
    "Cut-through, intact-part, or exact-recipe evidence is incomplete.",
  );

  const assembly = observation.assembly;
  let dimensionsPass = true;
  for (const axis of ["width", "depth", "height"] as const) {
    const expected = manifest.expectedFinishedEnvelopeMm[axis];
    const dimension = assembly.majorDimensions.find((item) => item.axis === axis);
    const observed = dimension?.observedMm ?? null;
    const tolerance = Math.max(1, expected * 0.01);
    if (
      dimension?.expectedMm !== expected ||
      observed === null ||
      Math.abs(expected - observed) > tolerance
    ) dimensionsPass = false;
  }
  add(
    findings,
    assembly.usedGeneratedInstructionsOnly === true &&
      assembly.structuralGlueUsed === false &&
      assembly.assembled === true &&
      assembly.fingerTabJointsSeatByHand === true &&
      assembly.noJointFracture === true &&
      assembly.noSpontaneousJointSeparation === true &&
      dimensionsPass,
    "OBSERVATION_ASSEMBLY_INCOMPLETE",
    "Glue-free assembly, joint behavior, instruction-only use, or major-dimension evidence is incomplete.",
  );

  if (manifest.candidateId === "basic") {
    add(
      findings,
      observation.motion.kind === "none",
      "OBSERVATION_MOTION_INCOMPLETE",
      "Basic candidate must record no moving mechanism.",
    );
  } else if (manifest.candidateId === "hinged") {
    const retainedPin = manifest.fabricationInput.retainedPin;
    if (retainedPin === null) throw new Error("PHYSICAL_OBSERVATION_RETAINED_PIN_MISSING");
    const expectedPin = retainedPin.effectiveDiameterMm;
    add(
      findings,
      observation.motion.kind === "revolute" &&
        observation.motion.retainedPinBasis === retainedPin.basis &&
        observation.motion.effectivePinDiameterMm === expectedPin &&
        observation.motion.samePinSectionAsCouponConfirmed === true &&
        observation.motion.completedFullCycles !== null &&
        observation.motion.completedFullCycles >= 20 &&
        observation.motion.noBinding === true &&
        observation.motion.noPinLoss === true &&
        observation.motion.noVisibleBoreWebFailure === true,
      "OBSERVATION_MOTION_INCOMPLETE",
      "Hinge evidence requires the exact retained-pin basis and effective diameter, confirmation that the coupon-tested pin section was used, and at least 20 clean full cycles.",
    );
  } else {
    add(
      findings,
      observation.motion.kind === "prismatic" &&
        observation.motion.completedFullCycles !== null &&
        observation.motion.completedFullCycles >= 20 &&
        observation.motion.noBinding === true &&
        observation.motion.noUnintendedRelease === true &&
        observation.motion.noRailFailure === true,
      "OBSERVATION_MOTION_INCOMPLETE",
      "Slide evidence requires at least 20 clean full cycles without release or rail failure.",
    );
  }
  const scoreTreatmentPathCount = product.sheets.reduce(
    (total, sheet) => total + sheet.scoreTreatmentPathCount,
    0,
  );
  if (scoreTreatmentPathCount > 0) {
    add(
      findings,
      observation.motif.evidence === "registered-score-surface-treatment" &&
        observation.motif.visible === true &&
        observation.motif.structuralKeepoutsUndamaged === true,
      "OBSERVATION_MOTIF_INCOMPLETE",
      "Registered Score surface-treatment paths require visible motif and undamaged structural keep-out observations.",
    );
  } else {
    add(
      findings,
      observation.motif.evidence === "not-applicable",
      "OBSERVATION_MOTIF_INCOMPLETE",
      "Motif evidence must be explicitly not applicable when the exact product has no registered Score surface-treatment paths.",
    );
  }
  const hasPhoto = observation.media.some((item) => item.kind === "photo");
  const needsVideo = manifest.candidateId !== "basic";
  const hasVideo = observation.media.some((item) => item.kind === "video");
  add(
    findings,
    hasPhoto && (!needsVideo || hasVideo),
    "OBSERVATION_MEDIA_INCOMPLETE",
    "Each candidate needs a hash-bound photo; each moving candidate also needs a hash-bound video.",
  );
  const generation = observation.generationObservationReview;
  add(
    findings,
    generation.windowStart !== null &&
      generation.windowEnd !== null &&
      generation.eligibleSampleSize !== null &&
      generation.requestMixLimitation !== null &&
      generation.broadGeneralizationClaimed === false,
    "OBSERVATION_GENERATION_REVIEW_INCOMPLETE",
    "The privacy-safe generation window, sample size, request-mix limitation, and narrow claim boundary must be recorded.",
  );
  add(
    findings,
    observation.usedHistoricalArtifact === false && observation.releaseClaimsAligned === true,
    "OBSERVATION_RELEASE_CLAIM_INCOMPLETE",
    "Evidence must reject historical artifacts and confirm release-claim alignment.",
  );
  return { status: findings.length === 0 ? "pass" : "fail", findings };
}
