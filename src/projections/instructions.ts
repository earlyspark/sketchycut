import {
  InstructionsProjectionSchema,
  type AssemblyAction,
  type CutThroughApplication,
  type DesignDocumentV1,
  type InstructionsProjection
} from "../domain/contracts.js";

export function buildInstructionsProjection(
  assemblyPlan: readonly AssemblyAction[],
  sourceDocumentHash: string,
  sheetByPartId: ReadonlyMap<string, string>,
  cutThroughApplications: readonly CutThroughApplication[] = [],
  applicationLimitations: NonNullable<DesignDocumentV1["applicationLimitations"]> = [],
): InstructionsProjection {
  return InstructionsProjectionSchema.parse({
    schemaVersion: "2.0",
    sourceDocumentHash,
    steps: assemblyPlan
      .map((action) => {
        const sheetIds = [...new Set(action.partIds.map((partId) => {
          const sheetId = sheetByPartId.get(partId);
          if (sheetId === undefined) {
            throw new Error(`Assembly action ${action.id} references an unplaced part ${partId}.`);
          }
          return sheetId;
        }))].sort();
        const relatedApplications = cutThroughApplications.filter((application) =>
          application.targetPartIds.some((partId) => action.partIds.includes(partId))
        );
        const relatedApplicationIds = new Set(relatedApplications.map((application) => application.id));
        const relatedLimitations = applicationLimitations.filter((limitation) =>
          limitation.relatedIds.some((id) => relatedApplicationIds.has(id) || action.partIds.includes(id))
        );
        return {
          id: `${action.id}-instruction`,
          order: action.order,
          instructionKey: action.instructionKey,
          partIds: action.partIds,
          ...(action.stockItemIds === undefined ? {} : { stockItemIds: action.stockItemIds }),
          jointIds: action.jointIds,
          sheetIds,
          ...(relatedApplications.length === 0 ? {} : {
            cutThroughApplicationIds: relatedApplications.map((application) => application.id).sort(),
            cutThroughFeatureIds: relatedApplications.flatMap((application) => application.featureIds).sort(),
            cutThroughPurposes: [...new Set(relatedApplications.map((application) => application.purpose))].sort()
          }),
          ...(relatedLimitations.length === 0 ? {} : {
            limitationCodes: relatedLimitations.map((limitation) => limitation.code).sort()
          }),
          ...(action.phase === undefined ? {} : { phase: action.phase })
        };
      })
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  });
}
