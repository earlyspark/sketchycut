const PUBLIC_COMPILATION_CODE = /^[A-Z][A-Z0-9_]+$/;

export class DeterministicCompilationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    if (!PUBLIC_COMPILATION_CODE.test(code)) {
      throw new Error("DETERMINISTIC_COMPILATION_ERROR_CODE_INVALID");
    }
    super(message);
    this.name = "DeterministicCompilationError";
    this.code = code;
  }
}

export function deterministicCompilationFailureCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "DETERMINISTIC_COMPILATION_FAILED";
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && PUBLIC_COMPILATION_CODE.test(code)
    ? code
    : "DETERMINISTIC_COMPILATION_FAILED";
}
