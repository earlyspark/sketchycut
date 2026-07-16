import {
  InstructionsProjectionSchema,
  type AssemblyAction,
  type InstructionsProjection
} from "../domain/contracts.js";

export function buildInstructionsProjection(
  assemblyPlan: readonly AssemblyAction[],
  sourceDocumentHash: string,
  sheetByPartId: ReadonlyMap<string, string>,
): InstructionsProjection {
  return InstructionsProjectionSchema.parse({
    schemaVersion: "1.0",
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
        return {
          id: `${action.id}-instruction`,
          order: action.order,
          instructionKey: action.instructionKey,
          partIds: action.partIds,
          jointIds: action.jointIds,
          sheetIds
        };
      })
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  });
}
