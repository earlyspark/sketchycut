import type {
  DesignDocumentV1,
  InputPolicyEvaluation,
  RetainedPinProgramV1,
  ProjectionBundle
} from "../domain/contracts";
import type { OrthogonalCompileProfiles } from "../operators/orthogonal-compiler";

export type CompileWorkerRequest = {
  requestId: string;
  program: RetainedPinProgramV1;
  profiles: OrthogonalCompileProfiles;
  inputPolicyEvaluation: InputPolicyEvaluation;
};

export type CompileWorkerSuccess = {
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
  calibration: {
    document: DesignDocumentV1;
    geometryHash: string;
    bundle: ProjectionBundle;
    svgs: {
      sheetId: string;
      svg: string;
      sha256: string;
    }[];
  };
};

export type CompileWorkerFailure = {
  requestId: string;
  status: "error";
  message: string;
};

export type CompileWorkerResponse = CompileWorkerSuccess | CompileWorkerFailure;
