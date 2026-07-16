import {
  DesignDocumentV1Schema,
  SheetPartSchema,
  type DesignDocumentV1,
  type SheetPart
} from "../domain/contracts.js";
import { hashCanonical } from "../domain/hash.js";

export function parseDesignDocument(value: unknown): DesignDocumentV1 {
  return DesignDocumentV1Schema.parse(value);
}

export async function canonicalPartHash(part: SheetPart): Promise<string> {
  return hashCanonical(SheetPartSchema.parse(part));
}

export async function canonicalGeometryHash(document: DesignDocumentV1): Promise<string> {
  const parsed = parseDesignDocument(document);
  return hashCanonical({
    hashKind: "sketchycut-nominal-geometry@1.0.0",
    material: {
      materialKind: parsed.resolvedInputs.material.materialKind,
      measuredThicknessUm: Math.round(parsed.resolvedInputs.material.measuredThicknessMm * 1_000)
    },
    parts: parsed.parts.map((part) => ({
      id: part.id,
      role: part.role,
      markingCode: part.markingCode,
      thicknessUm: part.thicknessUm,
      grainVector: part.grainVector,
      nominalRegion: part.nominalRegion,
      features: part.features.map((feature) => ({
        id: feature.id,
        kind: feature.kind,
        operation: feature.operation,
        toolpathCompensation: feature.toolpathCompensation,
        fitClass: feature.fitClass,
        jointId: feature.jointId,
        region: feature.region,
        path: feature.path,
        parametersUm: feature.parametersUm
      })),
      assembledFrame: part.assembledFrame,
      explodedOffset: part.explodedOffset,
      assemblyDependencyPartIds: part.assemblyDependencyPartIds
    })),
    joints: parsed.joints,
    motionConstraints: parsed.motionConstraints,
    assemblyPlan: parsed.assemblyPlan
  });
}

export async function canonicalEvaluatedDocumentHash(
  document: DesignDocumentV1,
): Promise<string> {
  return hashCanonical(parseDesignDocument(document));
}

export const canonicalDocumentHash = canonicalEvaluatedDocumentHash;
