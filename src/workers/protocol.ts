import { z } from "zod";

import type {
  CapturedSlideProgramV1,
  DesignDocumentV1,
  InputPolicyEvaluation,
  OrthogonalPanelProgramV1,
  ProjectionBundle,
  RetainedPinProgramV1
} from "../domain/contracts.js";
import {
  CapturedSlideProgramV1Schema,
  FabricationContextSchema,
  FitProfileSchema,
  InputPolicyEvaluationSchema,
  MachineProfileSchema,
  MaterialProfileSchema,
  OrthogonalPanelProgramV1Schema,
  ProcessRecipeSchema,
  RetainedPinProgramV1Schema
} from "../domain/contracts.js";
import type { NominalStockPresetId } from "../domain/stock-catalog.js";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler.js";
import type { FabricationEvidenceProjection } from "../projections/evidence.js";

type ProductCompileWorkerRequestBase = {
  kind: "product-compile";
  requestId: string;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
};

export type OrthogonalProductCompileWorkerRequest = ProductCompileWorkerRequestBase & {
  structuralKind: "orthogonal-panel";
  program: OrthogonalPanelProgramV1;
};

export type RetainedPinProductCompileWorkerRequest = ProductCompileWorkerRequestBase & {
  structuralKind: "retained-pin";
  program: RetainedPinProgramV1;
};

export type CapturedSlideProductCompileWorkerRequest = ProductCompileWorkerRequestBase & {
  structuralKind: "captured-slide";
  program: CapturedSlideProgramV1;
};

export type ProductCompileWorkerRequest =
  | OrthogonalProductCompileWorkerRequest
  | RetainedPinProductCompileWorkerRequest
  | CapturedSlideProductCompileWorkerRequest;

export class StructuralProgramMismatchError extends Error {
  readonly code = "STRUCTURAL_PROGRAM_MISMATCH";

  constructor(structuralKind: ProductCompileWorkerRequest["structuralKind"]) {
    super(`Program does not match the ${structuralKind} structural discriminator.`);
    this.name = "StructuralProgramMismatchError";
  }
}

export class ProductCompileRequestInvalidError extends Error {
  readonly code = "PRODUCT_COMPILE_REQUEST_INVALID";

  constructor() {
    super("Product compile request contains unsupported or malformed fields.");
    this.name = "ProductCompileRequestInvalidError";
  }
}

const CompileProfilesSchema = z
  .object({
    material: MaterialProfileSchema,
    machine: MachineProfileSchema,
    processRecipe: ProcessRecipeSchema,
    fabricationContext: FabricationContextSchema,
    fit: FitProfileSchema
  })
  .strict();

const ProductCompileWorkerRequestSchema = z.discriminatedUnion("structuralKind", [
  z
    .object({
      kind: z.literal("product-compile"),
      structuralKind: z.literal("orthogonal-panel"),
      requestId: z.string().min(1).max(200),
      program: OrthogonalPanelProgramV1Schema,
      profiles: CompileProfilesSchema,
      inputPolicyEvaluation: InputPolicyEvaluationSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("product-compile"),
      structuralKind: z.literal("retained-pin"),
      requestId: z.string().min(1).max(200),
      program: RetainedPinProgramV1Schema,
      profiles: CompileProfilesSchema,
      inputPolicyEvaluation: InputPolicyEvaluationSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("product-compile"),
      structuralKind: z.literal("captured-slide"),
      requestId: z.string().min(1).max(200),
      program: CapturedSlideProgramV1Schema,
      profiles: CompileProfilesSchema,
      inputPolicyEvaluation: InputPolicyEvaluationSchema
    })
    .strict()
]);

export function requireStructuralProgramMatch(
  request: ProductCompileWorkerRequest,
): ProductCompileWorkerRequest {
  const program = request.structuralKind === "orthogonal-panel"
    ? OrthogonalPanelProgramV1Schema.safeParse(request.program)
    : request.structuralKind === "retained-pin"
    ? RetainedPinProgramV1Schema.safeParse(request.program)
    : CapturedSlideProgramV1Schema.safeParse(request.program);
  if (!program.success) throw new StructuralProgramMismatchError(request.structuralKind);
  const parsed = ProductCompileWorkerRequestSchema.safeParse(request);
  if (!parsed.success) throw new ProductCompileRequestInvalidError();
  return parsed.data;
}

export type FixtureCompileWorkerRequest = {
  kind: "fixture-compile";
  requestId: string;
  stockPresetId: NominalStockPresetId;
};

export type CompileWorkerRequest =
  | ProductCompileWorkerRequest
  | FixtureCompileWorkerRequest;

export type ProductCompileWorkerSuccess = {
  kind: "product-success";
  requestId: string;
  status: "success";
  document: DesignDocumentV1;
  geometryHash: string;
  bundle: ProjectionBundle;
  evidence: FabricationEvidenceProjection;
  svgs: {
    sheetId: string;
    svg: string;
    sha256: string;
  }[];
};

export type FixtureCompileWorkerSuccess = {
  kind: "fixture-success";
  requestId: string;
  status: "success";
  document: DesignDocumentV1;
  geometryHash: string;
  bundle: ProjectionBundle;
  svgs: {
    sheetId: string;
    svg: string;
    sha256: string;
  }[];
};

export type CompileWorkerFailure = {
  kind: "product-error" | "fixture-error";
  requestId: string;
  status: "error";
  message: string;
};

export type CompileWorkerResponse =
  | ProductCompileWorkerSuccess
  | FixtureCompileWorkerSuccess
  | CompileWorkerFailure;
