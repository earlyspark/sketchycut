import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { DesignDocumentV1Schema } from "../../src/domain/contracts.js";
import { sha256 } from "../../src/domain/hash.js";
import {
  PhysicalConfidenceInputSchema,
  PhysicalConfidenceObservationDraftSchema,
  PhysicalConfidencePackageManifestSchema,
  type PhysicalConfidenceInput
} from "../../src/ui/content/physical-confidence-contracts.js";
import {
  buildPhysicalConfidenceArtifactSet,
  verifyPhysicalConfidenceAdjustmentSource,
  verifyPhysicalConfidencePackage
} from "../../src/ui/content/physical-confidence.js";
import {
  buildPhysicalConfidenceObservationDraft,
  evaluatePhysicalConfidenceObservation
} from "../../src/ui/content/physical-confidence-observation.js";

const SOFTWARE_PREFLIGHT = {
  schemaVersion: "2.0",
  stage: "software-preflight",
  stock: {
    presetId: "stock-3mm-basswood-laser-plywood",
    batchId: null,
    grainAxis: "machine-x-grain-x",
    footprintMm: { width: 304.8, height: 304.8 },
    thickness: { basis: "nominal-preset" }
  },
  cutWidth: { source: "provisional-preset" },
  fit: { basis: "provisional" },
  retainedPin: { basis: "nominal-preset", effectiveDiameterMm: 3 },
  process: null
} as const satisfies PhysicalConfidenceInput;

const TOOTHPICK_PREFLIGHT = {
  ...SOFTWARE_PREFLIGHT,
  retainedPin: {
    basis: "user-reported-reference-gauge",
    effectiveDiameterMm: 2.18,
    minimumDiameterMm: 2.05,
    maximumDiameterMm: 2.3,
    stockKind: "wooden-toothpick",
    referenceGauge: {
      system: "american-wire-gauge",
      largerDiameterGaugeNumber: 11,
      smallerDiameterGaugeNumber: 12,
      policyId: "american-wire-gauge-diameter",
      policyVersion: "1.0.0"
    },
    straightnessEvidence: "unverified"
  }
} as const satisfies PhysicalConfidenceInput;

const COMPLETE_CUT_CANDIDATE = {
  ...SOFTWARE_PREFLIGHT,
  stage: "cut-candidate",
  stock: {
    ...SOFTWARE_PREFLIGHT.stock,
    batchId: "test-basswood-sheet",
    thickness: {
      basis: "user-reported-caliper",
      readingsMm: [2.96, 2.98, 3] as const
    }
  },
  cutWidth: {
    source: "fixture-derived",
    fixtureEvidence: {
      method: "joint-fit-offset-selection",
      fixtureProviderId: "atomm",
      fixtureToolId: "kerf-offset-tester",
      fixtureSourceUrl: "https://www.atomm.com/creativetools/generator/kerf-offset-tester/#/",
      fixtureArtifactKind: "downstream-import-state",
      fixtureArtifactHash: "2317e964d34197f443d8fb63aa5c39dc940a1ee765c2ed53dc274fb572bf80ef",
      jointKind: "finger-joint",
      boardThicknessMm: 2.98,
      candidateObservations: [
        { perSideOffsetMm: 0.12, result: "too-loose" },
        { perSideOffsetMm: 0.14, result: "selected-snug" },
        { perSideOffsetMm: 0.16, result: "too-tight" },
        { perSideOffsetMm: 0.18, result: "too-tight" }
      ],
      selectedPerSideOffsetMm: 0.14,
      normalizedFullCutWidthMm: { x: 0.28, y: 0.28 },
      selectionRuleVersion: "1.0.0",
      selectionEvidenceState: "user-reported"
    }
  },
  fit: {
    basis: "coupon-observed",
    couponSvgSha256: "c".repeat(64),
    selectionRuleVersion: "1.0.0",
    validRun: {
      errors: "none",
      cutThrough: "complete",
      labelsVisible: true,
      piecesReleasedFreely: true
    },
    nonqualifyingDeviations: ["cut-contours-assigned-score"],
    classes: {
      press: {
        totalDeltaMm: -0.1,
        confidence: "provisional",
        observations: [{ specimen: "slot", result: "will-not-enter" }]
      },
      snug: {
        totalDeltaMm: 0,
        confidence: "coupon-selected",
        observations: [{ specimen: "slot", result: "snug-retained" }]
      },
      sliding: {
        totalDeltaMm: 0.1,
        confidence: "coupon-selected",
        observations: [{ specimen: "slot", result: "slides" }]
      },
      rotating: {
        totalDeltaMm: 0.2,
        confidence: "coupon-selected",
        observations: [
          { specimen: "slot", result: "slides" },
          { specimen: "rotating-bore", result: "rotates-freely-slight-play" }
        ]
      },
      rod: {
        totalDeltaMm: 0.1,
        confidence: "coupon-selected",
        observations: [
          { specimen: "slot", result: "forceful" },
          { specimen: "retention-bore", result: "smooth-and-retained" }
        ]
      }
    }
  },
  retainedPin: {
    basis: "user-reported-caliper",
    effectiveDiameterMm: 2.98
  },
  process: {
    studioDesktopVersion: "1.7.30-test",
    firmwareVersion: "test-firmware",
    materialPresetSource: "user-defined",
    powerPercent: 100,
    speedMmPerSecond: 4,
    passCount: 1,
    focusMode: "auto-measure",
    focusDescentMm: null,
    builtInAirPump: "high",
    supportArrangement: "test flat support",
    studioKerfOffsetMm: 0,
    evidenceStatus: "user-reported"
  }
} as const satisfies PhysicalConfidenceInput;

const NOMINAL_STANDARD_CUT_CANDIDATE = {
  ...COMPLETE_CUT_CANDIDATE,
  stock: {
    ...COMPLETE_CUT_CANDIDATE.stock,
    thickness: { basis: "nominal-preset" }
  },
  cutWidth: {
    ...COMPLETE_CUT_CANDIDATE.cutWidth,
    fixtureEvidence: {
      ...COMPLETE_CUT_CANDIDATE.cutWidth.fixtureEvidence,
      boardThicknessMm: 3
    }
  },
  retainedPin: { basis: "nominal-preset", effectiveDiameterMm: 3 }
} as const satisfies PhysicalConfidenceInput;

async function withExactCoupon(
  input: PhysicalConfidenceInput,
): Promise<PhysicalConfidenceInput> {
  if (input.fit.basis !== "coupon-observed") return input;
  const measurement = await buildPhysicalConfidenceArtifactSet({
    ...input,
    stage: "measurement-fixture"
  });
  const couponSvg = measurement.sharedReviewFiles.get("material-fit-coupon-sheet-1.svg");
  if (couponSvg === undefined) throw new Error("Expected retained-pin coupon SVG.");
  return {
    ...input,
    fit: { ...input.fit, couponSvgSha256: await sha256(couponSvg) }
  };
}

function completeObservation(
  artifactPackage: Awaited<ReturnType<typeof buildPhysicalConfidenceArtifactSet>>["packages"][number],
) {
  const manifest = artifactPackage.manifest;
  const process = manifest.fabricationInput.process;
  if (process === null) throw new Error("Expected a recorded process.");
  const observation = buildPhysicalConfidenceObservationDraft(
    artifactPackage.sha256,
    manifest,
  );
  observation.studio.desktopVersion = process.studioDesktopVersion;
  observation.studio.firmwareVersion = process.firmwareVersion;
  observation.studio.importDpi = 96;
  observation.studio.oversizePolicy = "Ask every time";
  for (const sheet of observation.studio.sheets) {
    sheet.observedImportedOccupiedDimensionsMm = {
      ...sheet.expectedImportedOccupiedDimensionsMm
    };
    for (const part of sheet.parts) {
      part.observedDimensionsMm = { ...part.expectedDimensionsMm };
    }
    sheet.importedViaUpload = true;
    sheet.neverResized = true;
    sheet.vectorQualityReviewed = true;
    for (const operation of sheet.operations) {
      if (operation.expectedPathCount > 0) {
        operation.assigned = true;
        operation.outputEnabled = true;
        operation.observedSettings = operation.expectedSettings === null
          ? null
          : { ...operation.expectedSettings };
      }
    }
    sheet.processingOrder = sheet.operations
      .filter((operation) => operation.expectedPathCount > 0)
      .map((operation) => operation.operation);
    sheet.innerBeforeOuterReviewed = true;
    sheet.studioKerfOffsetMm = 0;
  }
  observation.machineSetup = {
    module: "xTool M2 20W blue-light",
    initializationAndCalibrationState: "Current setup confirmed",
    cleanLevelBaseplate: true,
    magneticFixtureCount: 4,
    minimumToolpathToFixtureClearanceMm: 5,
    allFourCameraViewfinderPointsClear: true,
    framingPathsOnMaterial: true,
    framingFixturesClear: true,
    builtInAirPumpStateConfirmed: true
  };
  observation.cut = {
    exactRecipeHashConfirmed: manifest.processRecipeHash,
    cutThroughConfirmed: true,
    affectedPartsIntact: true
  };
  observation.assembly.usedGeneratedInstructionsOnly = true;
  observation.assembly.structuralGlueUsed = false;
  observation.assembly.assembled = true;
  observation.assembly.fingerTabJointsSeatByHand = true;
  observation.assembly.noJointFracture = true;
  observation.assembly.noSpontaneousJointSeparation = true;
  for (const dimension of observation.assembly.majorDimensions) {
    dimension.observedMm = dimension.expectedMm;
  }
  if (observation.motion.kind === "revolute") {
    const retainedPin = manifest.fabricationInput.retainedPin;
    if (retainedPin === null) throw new Error("Expected retained-pin input for hinged candidate.");
    if (
      observation.motion.retainedPinBasis !== retainedPin.basis ||
      observation.motion.effectivePinDiameterMm !== retainedPin.effectiveDiameterMm
    ) throw new Error("Expected the observation template to retain exact pin evidence.");
    observation.motion.samePinSectionAsCouponConfirmed = true;
    observation.motion.completedFullCycles = 20;
    observation.motion.noBinding = true;
    observation.motion.noPinLoss = true;
    observation.motion.noVisibleBoreWebFailure = true;
  } else if (observation.motion.kind === "prismatic") {
    observation.motion.completedFullCycles = 20;
    observation.motion.noBinding = true;
    observation.motion.noUnintendedRelease = true;
    observation.motion.noRailFailure = true;
  }
  if (observation.motif.evidence === "registered-score-surface-treatment") {
    observation.motif.visible = true;
    observation.motif.structuralKeepoutsUndamaged = true;
  }
  observation.media = [{
    kind: "photo",
    filename: `${manifest.candidateId}.jpg`,
    sha256: "a".repeat(64)
  }];
  if (manifest.candidateId !== "basic") {
    observation.media.push({
      kind: "video",
      filename: `${manifest.candidateId}.mp4`,
      sha256: "b".repeat(64)
    });
  }
  observation.generationObservationReview = {
    windowStart: "2026-07-20T00:00:00.000Z",
    windowEnd: "2026-07-20T01:00:00.000Z",
    eligibleSampleSize: 0,
    requestMixLimitation: "No representative current production requests were available.",
    broadGeneralizationClaimed: false
  };
  observation.usedHistoricalArtifact = false;
  observation.releaseClaimsAligned = true;
  return observation;
}

describe("current physical-confidence artifact set", () => {
  it("rejects a cut-candidate label without batch, calibrated process evidence, and recipe", () => {
    expect(PhysicalConfidenceInputSchema.safeParse({
      ...SOFTWARE_PREFLIGHT,
      stage: "cut-candidate"
    }).success).toBe(false);
  });

  it("rejects inconsistent joint-fit selection evidence and a fixture thickness mismatch", async () => {
    expect(PhysicalConfidenceInputSchema.safeParse({
      ...COMPLETE_CUT_CANDIDATE,
      cutWidth: {
        ...COMPLETE_CUT_CANDIDATE.cutWidth,
        fixtureEvidence: {
          ...COMPLETE_CUT_CANDIDATE.cutWidth.fixtureEvidence,
          normalizedFullCutWidthMm: { x: 0.27, y: 0.28 }
        }
      }
    }).success).toBe(false);
    await expect(buildPhysicalConfidenceArtifactSet({
      ...COMPLETE_CUT_CANDIDATE,
      cutWidth: {
        ...COMPLETE_CUT_CANDIDATE.cutWidth,
        fixtureEvidence: {
          ...COMPLETE_CUT_CANDIDATE.cutWidth.fixtureEvidence,
          boardThicknessMm: 2.97
        }
      }
    })).rejects.toThrow("PHYSICAL_CONFIDENCE_JOINT_FIXTURE_THICKNESS_MISMATCH");
  });

  it("keeps failed press evidence provisional and requires every consumed fit class", async () => {
    expect(PhysicalConfidenceInputSchema.safeParse({
      ...COMPLETE_CUT_CANDIDATE,
      fit: {
        ...COMPLETE_CUT_CANDIDATE.fit,
        classes: {
          ...COMPLETE_CUT_CANDIDATE.fit.classes,
          press: {
            ...COMPLETE_CUT_CANDIDATE.fit.classes.press,
            confidence: "coupon-selected"
          }
        }
      }
    }).success).toBe(false);

    const completeInput = await withExactCoupon(COMPLETE_CUT_CANDIDATE);
    const incomplete = {
      ...completeInput,
      fit: {
        ...(completeInput.fit.basis === "coupon-observed"
          ? completeInput.fit
          : COMPLETE_CUT_CANDIDATE.fit),
        classes: {
          press: COMPLETE_CUT_CANDIDATE.fit.classes.press,
          sliding: COMPLETE_CUT_CANDIDATE.fit.classes.sliding,
          rotating: COMPLETE_CUT_CANDIDATE.fit.classes.rotating,
          rod: COMPLETE_CUT_CANDIDATE.fit.classes.rod
        }
      }
    } satisfies PhysicalConfidenceInput;
    await expect(buildPhysicalConfidenceArtifactSet(incomplete))
      .rejects.toThrow("PHYSICAL_CONFIDENCE_REQUIRED_FIT_UNSELECTED:snug");
  }, 20_000);

  it("binds a snug-fit product refinement to the exact prior product hashes", async () => {
    const baselineInput = await withExactCoupon(COMPLETE_CUT_CANDIDATE);
    const original = await buildPhysicalConfidenceArtifactSet(baselineInput);
    const sourcePackage = original.packages.find((item) => item.candidateId === "basic")!;
    const source = await verifyPhysicalConfidenceAdjustmentSource(sourcePackage.bytes);
    const sourceProductSvgSha256 = sourcePackage.manifest.artifactGroups
      .find((group) => group.id === "product")!.sheets[0]!.svgSha256;
    const adjusted = PhysicalConfidenceInputSchema.parse({
      ...baselineInput,
      fit: {
        ...baselineInput.fit,
        classes: {
          ...(baselineInput.fit.basis === "coupon-observed" ? baselineInput.fit.classes : {}),
          snug: {
            ...COMPLETE_CUT_CANDIDATE.fit.classes.snug,
            totalDeltaMm: 0.05,
            confidence: "product-observed",
            adjustment: {
              basis: "product-assembly-observation",
              baselineTotalDeltaMm: 0,
              adjustmentMm: 0.05,
              sourceCandidateId: "basic",
              sourcePackageSha256: source.packageSha256,
              sourceProductSvgSha256,
              observation: "assembled-successfully-excessive-insertion-force",
              disposition: "apply-to-subsequent-candidates-with-new-hashes",
              targetCandidateIds: ["hinged", "sliding"] as ["hinged", "sliding"]
            }
          }
        }
      }
    });
    if (adjusted.fit.basis !== "coupon-observed") {
      throw new Error("Expected coupon-observed adjusted fit input.");
    }
    expect(PhysicalConfidenceInputSchema.safeParse(adjusted).success).toBe(true);
    expect(PhysicalConfidenceInputSchema.safeParse({
      ...adjusted,
      fit: {
        ...adjusted.fit,
        classes: {
          ...adjusted.fit.classes,
          snug: { ...adjusted.fit.classes.snug, totalDeltaMm: 0.04 }
        }
      }
    }).success).toBe(false);

    await expect(buildPhysicalConfidenceArtifactSet(adjusted)).rejects.toThrow(
      "PHYSICAL_CONFIDENCE_PRODUCT_ADJUSTMENT_SOURCE_REQUIRED",
    );
    const revised = await buildPhysicalConfidenceArtifactSet(adjusted, {
      productAdjustmentSources: [source]
    });
    expect(revised.summary.fitProfileHashes.basic).toBe(
      original.summary.fitProfileHashes.basic,
    );
    expect(revised.summary.fitProfileHashes.hinged).not.toBe(
      original.summary.fitProfileHashes.hinged,
    );
    for (const artifactPackage of revised.packages) {
      const baselinePackage = original.packages.find(
        (item) => item.candidateId === artifactPackage.candidateId,
      )!;
      if (artifactPackage.candidateId === "basic") {
        expect(artifactPackage.bytes).toEqual(baselinePackage.bytes);
        expect(artifactPackage.sha256).toBe(baselinePackage.sha256);
      } else {
        expect(artifactPackage.sha256).not.toBe(baselinePackage.sha256);
      }
      const files = unzipSync(artifactPackage.bytes);
      const evidence = JSON.parse(strFromU8(files["fit-selection-evidence.json"]!)) as {
        classes: { snug?: { totalDeltaMm: number; adjustment?: { sourcePackageSha256: string } } };
      };
      expect(evidence.classes.snug).toMatchObject(
        artifactPackage.candidateId === "basic"
          ? { totalDeltaMm: 0, confidence: "coupon-selected" }
          : {
              totalDeltaMm: 0.05,
              confidence: "product-observed",
              adjustment: { sourcePackageSha256: source.packageSha256 }
            },
      );
    }
    const hingedSourcePackage = revised.packages.find((item) => item.candidateId === "hinged")!;
    const hingedSource = await verifyPhysicalConfidenceAdjustmentSource(hingedSourcePackage.bytes);
    const hingedSourceSvgSha256 = hingedSourcePackage.manifest.artifactGroups
      .find((group) => group.id === "product")!.sheets[0]!.svgSha256;
    const secondStep = PhysicalConfidenceInputSchema.parse({
      ...adjusted,
      fit: {
        ...adjusted.fit,
        classes: {
          ...adjusted.fit.classes,
          snug: {
            ...adjusted.fit.classes.snug,
            totalDeltaMm: 0.1,
            adjustment: {
              basis: "product-assembly-observation",
              baselineTotalDeltaMm: 0,
              adjustmentMm: 0.1,
              sourceCandidateId: "hinged",
              sourcePackageSha256: hingedSource.packageSha256,
              sourceProductSvgSha256: hingedSourceSvgSha256,
              observation: "assembly-blocked-excessive-interference",
              disposition: "apply-to-subsequent-candidates-with-new-hashes",
              targetCandidateIds: ["hinged", "sliding"] as ["hinged", "sliding"]
            }
          }
        }
      }
    });
    const secondRevision = await buildPhysicalConfidenceArtifactSet(secondStep, {
      productAdjustmentSources: [hingedSource]
    });
    expect(secondRevision.packages.find((item) => item.candidateId === "hinged")!.manifest
      .fabricationInput.fit).toMatchObject({
        classes: {
          snug: {
            totalDeltaMm: 0.1,
            adjustment: {
              sourceCandidateId: "hinged",
              sourcePackageSha256: hingedSource.packageSha256
            }
          }
        }
      });
    const slidingSourcePackage = secondRevision.packages.find(
      (item) => item.candidateId === "sliding",
    )!;
    const slidingSource = await verifyPhysicalConfidenceAdjustmentSource(
      slidingSourcePackage.bytes,
    );
    const slidingSourceSvgSha256 = slidingSourcePackage.manifest.artifactGroups
      .find((group) => group.id === "product")!.sheets[0]!.svgSha256;
    if (secondStep.fit.basis !== "coupon-observed") {
      throw new Error("Expected coupon-observed second-step fit input.");
    }
    const thirdStep = PhysicalConfidenceInputSchema.parse({
      ...secondStep,
      fit: {
        ...secondStep.fit,
        classes: {
          ...secondStep.fit.classes,
          snug: {
            ...secondStep.fit.classes.snug,
            totalDeltaMm: 0.15,
            adjustment: {
              basis: "product-assembly-observation",
              baselineTotalDeltaMm: 0,
              adjustmentMm: 0.15,
              sourceCandidateId: "sliding",
              sourcePackageSha256: slidingSource.packageSha256,
              sourceProductSvgSha256: slidingSourceSvgSha256,
              observation: "shell-interfaces-seated-with-excessive-force",
              disposition: "apply-to-subsequent-candidates-with-new-hashes",
              targetCandidateIds: ["hinged", "sliding"] as ["hinged", "sliding"]
            }
          }
        }
      }
    });
    const thirdRevision = await buildPhysicalConfidenceArtifactSet(thirdStep, {
      productAdjustmentSources: [slidingSource]
    });
    expect(thirdRevision.packages.find((item) => item.candidateId === "sliding")!.manifest
      .fabricationInput.fit).toMatchObject({
        classes: {
          snug: {
            totalDeltaMm: 0.15,
            adjustment: {
              sourceCandidateId: "sliding",
              sourcePackageSha256: slidingSource.packageSha256,
              observation: "shell-interfaces-seated-with-excessive-force"
            }
          }
        }
      });
    expect(revised.sharedReviewFiles).toEqual(original.sharedReviewFiles);
  }, 20_000);

  it("accepts registered nominal 3 mm stock and pin inputs for a fully calibrated cut candidate", async () => {
    expect(PhysicalConfidenceInputSchema.safeParse(NOMINAL_STANDARD_CUT_CANDIDATE).success).toBe(true);
    const built = await buildPhysicalConfidenceArtifactSet(
      await withExactCoupon(NOMINAL_STANDARD_CUT_CANDIDATE),
    );
    expect(built.summary.material).toMatchObject({
      measuredThicknessMm: 3,
      thicknessBasis: "nominal-preset",
      batchId: "test-basswood-sheet"
    });
    expect(built.summary.retainedPin).toMatchObject({
      basis: "nominal-preset",
      effectiveDiameterMm: 3
    });
    expect(built.summary.cutWidth.source).toBe("fixture-derived");
    expect(built.packages.every((item) => item.manifest.stage === "cut-candidate")).toBe(true);
  }, 20_000);

  it("keeps toothpick input and hash changes exclusive to the hinged capability", async () => {
    const nominal = await buildPhysicalConfidenceArtifactSet(SOFTWARE_PREFLIGHT);
    const toothpick = await buildPhysicalConfidenceArtifactSet(TOOTHPICK_PREFLIGHT);
    const nominalByCandidate = new Map(nominal.packages.map((item) => [item.candidateId, item]));
    const toothpickByCandidate = new Map(toothpick.packages.map((item) => [item.candidateId, item]));

    for (const candidateId of ["basic", "sliding"] as const) {
      const left = nominalByCandidate.get(candidateId)!;
      const right = toothpickByCandidate.get(candidateId)!;
      expect(left.bytes).toEqual(right.bytes);
      expect(left.sha256).toBe(right.sha256);
      expect(right.manifest.fabricationInput.retainedPin).toBeNull();
      expect(right.manifest.pinProfileHash).toBeNull();
    }

    const nominalHinged = nominalByCandidate.get("hinged")!;
    const toothpickHinged = toothpickByCandidate.get("hinged")!;
    expect(toothpickHinged.sha256).not.toBe(nominalHinged.sha256);
    expect(toothpickHinged.manifest.fabricationInput.retainedPin).toEqual(
      TOOTHPICK_PREFLIGHT.retainedPin,
    );
    expect(toothpickHinged.manifest.pinProfileHash).not.toBeNull();
    const hingedFiles = unzipSync(toothpickHinged.bytes);
    expect(strFromU8(hingedFiles["material-fit-coupon/measurement-instructions.md"]!))
      .toContain("2.05–2.30 mm reference bounds");
    const document = DesignDocumentV1Schema.parse(
      JSON.parse(strFromU8(hingedFiles["canonical-project.json"]!)) as unknown,
    );
    expect(document.externalStock?.some((item) => item.kind === "wooden-toothpick")).toBe(true);

    const observation = buildPhysicalConfidenceObservationDraft(
      toothpickHinged.sha256,
      toothpickHinged.manifest,
    );
    expect(observation.motion).toMatchObject({
      kind: "revolute",
      retainedPinBasis: "user-reported-reference-gauge",
      effectivePinDiameterMm: 2.18,
      samePinSectionAsCouponConfirmed: null
    });
    expect(observation.motion).not.toHaveProperty("measuredPinDiameterMm");
    expect(PhysicalConfidenceObservationDraftSchema.safeParse({
      ...observation,
      motion: {
        ...observation.motion,
        measuredPinDiameterMm: 2.18
      }
    }).success).toBe(false);
  }, 20_000);

  it("keeps straightness evidence out of nominal geometry identity", async () => {
    const unverified = await buildPhysicalConfidenceArtifactSet(TOOTHPICK_PREFLIGHT);
    const reviewed = await buildPhysicalConfidenceArtifactSet({
      ...TOOTHPICK_PREFLIGHT,
      retainedPin: {
        ...TOOTHPICK_PREFLIGHT.retainedPin,
        straightnessEvidence: "user-reported"
      }
    });
    const left = unverified.packages.find((item) => item.candidateId === "hinged")!;
    const right = reviewed.packages.find((item) => item.candidateId === "hinged")!;
    expect(left.manifest.geometryHash).toBe(right.manifest.geometryHash);
    expect(left.manifest.evaluatedDocumentHash).not.toBe(right.manifest.evaluatedDocumentHash);
    expect(left.sha256).not.toBe(right.sha256);
  }, 20_000);

  it("accepts and propagates a complete measured cut-candidate chain", async () => {
    const completeInput = await withExactCoupon(COMPLETE_CUT_CANDIDATE);
    const built = await buildPhysicalConfidenceArtifactSet(completeInput);
    expect(built.summary.stage).toBe("cut-candidate");
    expect(built.summary.material).toMatchObject({
      measuredThicknessMm: 2.98,
      thicknessBasis: "user-reported-caliper",
      batchId: "test-basswood-sheet"
    });
    expect(built.summary.cutWidth).toEqual({
      xMm: 0.28,
      yMm: 0.28,
      source: "fixture-derived"
    });
    expect(built.summary.retainedPin).toMatchObject({
      basis: "user-reported-caliper",
      effectiveDiameterMm: 2.98
    });
    expect(built.packages.every((item) => item.manifest.stage === "cut-candidate")).toBe(true);
    expect(built.summary.runtimeModelCalls).toBe(0);
    for (const artifactPackage of built.packages) {
      const verifiedPackage = await verifyPhysicalConfidencePackage(artifactPackage.bytes);
      expect(verifiedPackage).toMatchObject({
        packageSha256: artifactPackage.sha256,
        manifest: artifactPackage.manifest
      });
      const files = unzipSync(artifactPackage.bytes);
      expect(JSON.parse(strFromU8(files["cut-width-fixture-evidence.json"]!))).toEqual(
        completeInput.cutWidth.source === "fixture-derived"
          ? completeInput.cutWidth.fixtureEvidence
          : undefined,
      );
      const fitEvidence = JSON.parse(strFromU8(files["fit-selection-evidence.json"]!)) as {
        classes: Record<string, unknown>;
      };
      const expectedClasses = artifactPackage.candidateId === "basic"
        ? ["snug"]
        : artifactPackage.candidateId === "hinged"
          ? ["rotating", "snug"]
          : ["sliding", "snug"];
      expect(Object.keys(fitEvidence.classes).sort()).toEqual(expectedClasses);
      expect(fitEvidence.classes).not.toHaveProperty("press");
      const observation = completeObservation(artifactPackage);
      expect(observation.motif.evidence).toBe("registered-score-surface-treatment");
      expect(evaluatePhysicalConfidenceObservation(
        observation,
        artifactPackage.sha256,
        artifactPackage.manifest,
      )).toEqual({ status: "pass", findings: [] });
      if (artifactPackage.candidateId === "hinged") {
        const personalized = completeObservation(artifactPackage);
        const personalizedSheet = personalized.studio.sheets[0]!;
        expect(
          personalizedSheet.operations.find((item) => item.operation === "engrave")
            ?.expectedPathCount,
        ).toBe(0);
        personalizedSheet.externalStudioPersonalizations.push({
          personalizationId: "user-cover-logo",
          source: "user-added-in-studio",
          description: "User-added cover engraving",
          affectedPartId: "cover-panel",
          operation: "engrave",
          objectCount: 1,
          claimedAsSketchyCutOutput: false,
          canonicalStructuralPathsModified: false,
          withinAffectedPartBoundaryConfirmed: true,
          structuralKeepoutClearConfirmed: true,
          outputEnabled: true,
          observedSettings: {
            powerPercent: 50,
            speedMmPerSecond: 240,
            passCount: 1
          }
        });
        personalizedSheet.processingOrder = ["engrave", "score", "cut"];
        personalized.deviations.push(
          "One user-added Studio engraving is outside the canonical SketchyCut package; canonical Cut and Score paths were unchanged.",
        );
        expect(evaluatePhysicalConfidenceObservation(
          personalized,
          artifactPackage.sha256,
          artifactPackage.manifest,
        )).toEqual({ status: "pass", findings: [] });

        const unsafePersonalization = structuredClone(personalized);
        unsafePersonalization.studio.sheets[0]!
          .externalStudioPersonalizations[0]!.structuralKeepoutClearConfirmed = false;
        expect(evaluatePhysicalConfidenceObservation(
          unsafePersonalization,
          artifactPackage.sha256,
          artifactPackage.manifest,
        ).findings.map((item) => item.code)).toContain(
          "OBSERVATION_EXTERNAL_PERSONALIZATION_INCOMPLETE",
        );

        const wrongPinEvidence = completeObservation(artifactPackage);
        if (wrongPinEvidence.motion.kind !== "revolute") {
          throw new Error("Expected revolute observation for Hinged.");
        }
        wrongPinEvidence.motion.retainedPinBasis = "nominal-preset";
        wrongPinEvidence.motion.effectivePinDiameterMm += 0.01;
        wrongPinEvidence.motion.samePinSectionAsCouponConfirmed = false;
        expect(evaluatePhysicalConfidenceObservation(
          wrongPinEvidence,
          artifactPackage.sha256,
          artifactPackage.manifest,
        ).findings.map((item) => item.code)).toContain("OBSERVATION_MOTION_INCOMPLETE");
      }
    }

    const treatmentPackage = built.packages[0]!;
    const falseNotApplicable = completeObservation(treatmentPackage);
    falseNotApplicable.motif = { evidence: "not-applicable" };
    expect(evaluatePhysicalConfidenceObservation(
      falseNotApplicable,
      treatmentPackage.sha256,
      treatmentPackage.manifest,
    ).findings.map((item) => item.code)).toContain("OBSERVATION_MOTIF_INCOMPLETE");

    const noTreatmentManifest = PhysicalConfidencePackageManifestSchema.parse({
      ...treatmentPackage.manifest,
      artifactGroups: treatmentPackage.manifest.artifactGroups.map((group) => group.id === "product"
        ? {
            ...group,
            sheets: group.sheets.map((sheet) => ({
              ...sheet,
              scoreTreatmentPathCount: 0
            }))
          }
        : group)
    });
    const noTreatmentPackage = { ...treatmentPackage, manifest: noTreatmentManifest };
    const noTreatmentObservation = completeObservation(noTreatmentPackage);
    expect(noTreatmentObservation.motif).toEqual({ evidence: "not-applicable" });
    expect(evaluatePhysicalConfidenceObservation(
      noTreatmentObservation,
      noTreatmentPackage.sha256,
      noTreatmentManifest,
    )).toEqual({ status: "pass", findings: [] });
    noTreatmentObservation.motif = {
      evidence: "registered-score-surface-treatment",
      visible: true,
      structuralKeepoutsUndamaged: true
    };
    expect(evaluatePhysicalConfidenceObservation(
      noTreatmentObservation,
      noTreatmentPackage.sha256,
      noTreatmentManifest,
    ).findings.map((item) => item.code)).toContain("OBSERVATION_MOTIF_INCOMPLETE");

    const changedDimensions = completeObservation(built.packages[0]!);
    changedDimensions.studio.sheets[0]!.observedImportedOccupiedDimensionsMm!.width += 0.11;
    const failed = evaluatePhysicalConfidenceObservation(
      changedDimensions,
      built.packages[0]!.sha256,
      built.packages[0]!.manifest,
    );
    expect(failed.status).toBe("fail");
    expect(failed.findings.map((item) => item.code)).toContain(
      "OBSERVATION_DIMENSION_MISMATCH",
    );

    const corruptedPackage = built.packages[0]!.bytes.slice();
    corruptedPackage[Math.floor(corruptedPackage.byteLength / 2)]! ^= 1;
    await expect(verifyPhysicalConfidencePackage(corruptedPackage)).rejects.toThrow();
  }, 20_000);

  it("builds deterministic complete Basic, Hinged, and Sliding packages with zero model calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const first = await buildPhysicalConfidenceArtifactSet(SOFTWARE_PREFLIGHT);
    const second = await buildPhysicalConfidenceArtifactSet(SOFTWARE_PREFLIGHT);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first.summary.runtimeModelCalls).toBe(0);
    expect(first.summary.stage).toBe("software-preflight");
    expect(first.packages.map((item) => item.candidateId)).toEqual([
      "basic",
      "hinged",
      "sliding"
    ]);
    expect(first.packages.map((item) => item.sha256)).toEqual(
      second.packages.map((item) => item.sha256),
    );
    expect([...first.sharedReviewFiles]).toEqual([...second.sharedReviewFiles]);
    expect(first.sharedReviewFiles.has("material-fit-coupon-sheet-1.svg")).toBe(true);
    expect(first.sharedReviewFiles.has("optional-cut-width-test-sheet-1.svg")).toBe(true);
    for (let index = 0; index < first.packages.length; index += 1) {
      expect(first.packages[index]!.bytes).toEqual(second.packages[index]!.bytes);
    }

    for (const artifactPackage of first.packages) {
      const files = unzipSync(artifactPackage.bytes);
      const manifest = PhysicalConfidencePackageManifestSchema.parse(
        JSON.parse(strFromU8(files["manifest.json"]!)) as unknown,
      );
      expect(manifest.schemaVersion).toBe("sketchycut-physical-confidence-package@2.0.0");
      expect(manifest.generatorVersion).toBe("2.0.0");
      expect(manifest.requiredStudioKerfOffset).toBe("off / 0.00 mm");
      expect(manifest.runtimeModelCalls).toBe(0);
      expect(manifest.artifactGroups.map((item) => item.id)).toEqual([
        "product",
        "material-fit-coupon",
        "optional-cut-width-fit-test"
      ]);
      expect(manifest.artifactGroups[2]!.compensation).toBe("uncompensated-fit-test-cut");
      expect(manifest.artifactGroups[0]!.sheets.every(
        (sheet) => sheet.partDimensionsMm.length === sheet.partIds.length,
      )).toBe(true);
      expect(manifest.artifactGroups[0]!.sheets.every(
        (sheet) => sheet.scoreTreatmentPathCount > 0,
      )).toBe(true);
      expect(files["previews/assembled.svg"]).toBeDefined();
      expect(files["previews/exploded.svg"]).toBeDefined();
      expect(files["handoff/xtool-studio-checklist.md"]).toBeDefined();
      if (manifest.fabricationInput.cutWidth.source === "fixture-derived") {
        expect(files["cut-width-fixture-evidence.json"]).toBeDefined();
      }
      const studioChecklist = strFromU8(files["handoff/xtool-studio-checklist.md"]!);
      expect(studioChecklist).toContain("Import through Upload");
      expect(studioChecklist).toContain("Assign every operation");
      expect(files["numbered-assembly-instructions.md"]).toBeDefined();
      expect(artifactPackage.reviewFiles.has(
        `${artifactPackage.candidateId}-physical-observation-template.json`,
      )).toBe(true);
      for (const file of manifest.files) {
        expect(files[file.path]).toBeDefined();
        expect(files[file.path]!.byteLength).toBe(file.bytes);
        expect(await sha256(files[file.path]!)).toBe(file.sha256);
      }
      const provisionalObservation = buildPhysicalConfidenceObservationDraft(
        artifactPackage.sha256,
        manifest,
      );
      expect(evaluatePhysicalConfidenceObservation(
        provisionalObservation,
        artifactPackage.sha256,
        manifest,
      ).findings.map((item) => item.code)).toContain("OBSERVATION_NOT_CUT_CANDIDATE");
      const document = DesignDocumentV1Schema.parse(
        JSON.parse(strFromU8(files["canonical-project.json"]!)) as unknown,
      );
      expect(document.validation.status).toBe("pass");
      if (artifactPackage.candidateId === "basic") {
        const scoreFeatures = document.parts.flatMap((part) => part.features).filter(
          (feature) => feature.operation === "score" && feature.kind === "treatment",
        );
        expect(scoreFeatures.length).toBeGreaterThan(0);
      } else if (artifactPackage.candidateId === "hinged") {
        expect(document.externalStock?.some((item) => item.kind === "wooden-dowel")).toBe(true);
        expect(document.motionConstraints.some((item) => item.kind === "revolute")).toBe(true);
      } else {
        expect(document.motionConstraints.some((item) => item.kind === "prismatic")).toBe(true);
      }
    }
    fetchSpy.mockRestore();
  }, 20_000);
});
