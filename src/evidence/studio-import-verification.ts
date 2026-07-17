import { z } from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const VerificationSheetSchema = z
  .object({
    sheetId: z.string().min(1),
    svgSha256: Sha256Schema,
    expectedRootDimensionsMm: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
    expectedOccupiedBoundsUm: z
      .object({ minXUm: z.number().int(), minYUm: z.number().int(), maxXUm: z.number().int(), maxYUm: z.number().int() })
      .strict(),
    expectedAnchor: z.string().min(1),
    parsed: z.boolean().nullable(),
    importedRootDimensionsMm: z.object({ width: z.number().positive(), height: z.number().positive() }).strict().nullable(),
    importedOccupiedSelectionDimensionsMm: z.object({ width: z.number().positive(), height: z.number().positive() }).strict().nullable(),
    importedAnchorObservation: z.string().min(1).nullable(),
    dimensionResult: z.enum(["not-performed", "pass", "fail"]),
    rootWhitespaceBehavior: z.string().min(1).nullable(),
    objectsVisibleAndSelectable: z.boolean().nullable()
  })
  .strict();

export const StudioImportVerificationSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    milestone: z.literal("M3.1.1"),
    status: z.enum(["not-performed", "pass", "fail"]),
    scope: z.literal("import-only-no-processing"),
    artifactGroups: z
      .array(
        z
          .object({
            group: z.enum(["product", "optional-cut-width-fit-test"]),
            sourceDocumentHash: Sha256Schema,
            artifactSetHash: Sha256Schema,
            sheets: z.array(VerificationSheetSchema).min(1)
          })
          .strict(),
      )
      .length(2),
    environment: z
      .object({
        studioDesktopVersion: z.string().min(1).nullable(),
        operatingSystem: z.string().min(1).nullable(),
        svgDpi: z.number().positive().nullable(),
        vectorQuality: z.string().min(1).nullable(),
        oversizedImportPreference: z.enum(["ask-every-time", "keep-its-size"]).nullable()
      })
      .strict(),
    deviceContext: z.enum(["none", "registered-offline", "connected-powered-idle"]),
    observedOnImport: z
      .object({
        objectAndLayerCount: z.number().int().nonnegative().nullable(),
        initialOutputState: z.string().min(1).nullable(),
        initialOperationState: z.string().min(1).nullable(),
        initialParameterState: z.string().min(1).nullable(),
        engraveOneFilledObjectNoSeparateOutline: z.enum(["not-performed", "pass", "fail"])
      })
      .strict(),
    configuredForPreview: z
      .object({
        operationAssignmentsRecorded: z.boolean().nullable(),
        outputStatesRecorded: z.boolean().nullable(),
        orderRecorded: z.boolean().nullable(),
        kerfOffsetValuesRecorded: z.boolean().nullable()
      })
      .strict(),
    connectedPreflight: z
      .object({
        status: z.enum(["not-attempted", "pass", "deferred", "fail"]),
        prerequisiteReason: z.string().min(1).nullable(),
        firmwareVersion: z.string().min(1).nullable(),
        normalStartupHomingObserved: z.boolean().nullable(),
        operationOutputOrderKerfControlsObserved: z.boolean().nullable()
      })
      .strict(),
    preview: z
      .object({
        status: z.enum(["not-performed", "pass", "fail", "inconclusive"]),
        interiorBeforeOuter: z.boolean().nullable(),
        kerfOffsetProbe: z
          .object({
            status: z.enum(["not-performed", "visible-change", "no-visible-change", "inconclusive", "deferred-controls-unavailable"]),
            probeObjectId: z.string().min(1).nullable(),
            offsetMm: z.union([z.literal(1), z.null()]),
            observation: z.string().min(1).nullable(),
            restoredOrDiscarded: z.boolean().nullable()
          })
          .strict()
      })
      .strict(),
    processingPerformed: z.literal(false),
    reviewer: z.string().min(1).nullable(),
    date: z.iso.date().nullable(),
    evidencePaths: z.array(z.string().min(1))
  })
  .strict()
  .superRefine((value, context) => {
    const allSheetsPass = value.artifactGroups.every((group) =>
      group.sheets.every((sheet) =>
        sheet.parsed === true &&
        sheet.dimensionResult === "pass" &&
        sheet.objectsVisibleAndSelectable === true,
      ),
    );
    const engravePass = value.observedOnImport.engraveOneFilledObjectNoSeparateOutline === "pass";
    if (value.status === "pass" && (!allSheetsPass || !engravePass)) {
      context.addIssue({
        code: "custom",
        message: "Passing Studio import verification requires every exact sheet and the one-object Engrave gate to pass."
      });
    }
    if (value.connectedPreflight.status === "deferred" && value.connectedPreflight.prerequisiteReason === null) {
      context.addIssue({
        code: "custom",
        message: "Deferred connected preflight requires the exact prerequisite reason."
      });
    }
  });

export type StudioImportVerification = z.infer<typeof StudioImportVerificationSchema>;
