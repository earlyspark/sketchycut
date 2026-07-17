import type {
  DesignDocumentV1,
  InputPolicyEvaluation,
  ProjectionBundle,
  RetainedPinProgramV1
} from "../domain/contracts";
import type { NominalStockPresetId } from "../domain/stock-catalog";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler";
import type { FabricationEvidenceProjection } from "../projections/evidence";

export type ProductCompileWorkerRequest = {
  kind: "product-compile";
  requestId: string;
  program: RetainedPinProgramV1;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
};

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
