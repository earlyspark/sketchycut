"use client";

import { useEffect, useRef, useState } from "react";

import {
  GenerationOutcomeV1Schema,
  GenerationSubmissionV1Schema,
  type GenerationOutcomeV1,
  type GenerationSubmissionV1
} from "../../interpretation/generation-protocol";
import {
  normalizeReferenceFiles,
  validateReferenceFiles,
  type ReferenceFileInput
} from "../../interpretation/image-normalization";
import type { ReferenceRole } from "../../interpretation/intent-graph";
import { M5_REPLAY_SCENARIOS } from "../../interpretation/m5-replay-corpus";
import { buildXToolStudioHandoff } from "../../projections/handoff";
import { compileFixtureRequest } from "../../workers/compile-service";
import type { ProductCompileWorkerRequest } from "../../workers/protocol";
import {
  DEFAULT_GENERATED_CONTROLS,
  GeneratedDeterministicControlsSchema,
  compileGeneratedProject,
  type GeneratedCompiledProject,
  type GeneratedDeterministicControls
} from "../content/generated-projects";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS,
  GeneratedFabricationControlsSchema,
  resolveGeneratedFabricationControls,
  type GeneratedFabricationControls
} from "../content/generated-setup";

import {
  CanonicalProjectWorkspace,
  type CanonicalHandoffState,
  type CanonicalProjectState
} from "./canonical-project-workspace";
import { GenerationComposer, type ComposerReference } from "./generation-composer";

type ControllerState =
  | { kind: "idle" }
  | { kind: "dispatching"; requestOrdinal: number }
  | { kind: "failure"; outcome: Extract<GenerationOutcomeV1, { kind: "failure" }> }
  | { kind: "concept-only"; outcome: Extract<GenerationOutcomeV1, { kind: "concept-only" }> }
  | {
      kind: "ready";
      outcome: Extract<GenerationOutcomeV1, { kind: "supported" | "simplified" }>;
    };

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("REFERENCE_DATA_URL_FAILED"));
    });
    reader.addEventListener("error", () => reject(new Error("REFERENCE_DATA_URL_FAILED")));
    reader.readAsDataURL(blob);
  });
}

function structuralKind(
  outcome: Extract<GenerationOutcomeV1, { kind: "supported" | "simplified" }>,
): ProductCompileWorkerRequest["structuralKind"] {
  return outcome.mapping.operatorGraph.graphId === "single-revolute-panel"
    ? "retained-pin"
    : outcome.mapping.operatorGraph.graphId === "single-prismatic-panel"
    ? "captured-slide"
    : "orthogonal-panel";
}

function projectState(compiled: GeneratedCompiledProject): CanonicalProjectState {
  return {
    status: "ready",
    requestId: `generated-workspace-${crypto.randomUUID()}`,
    document: compiled.document,
    geometryHash: compiled.geometryHash,
    bundle: compiled.bundle,
    evidence: compiled.evidence,
    svgs: compiled.svgs
  };
}

function failureCopy(outcome: Extract<GenerationOutcomeV1, { kind: "failure" }>): string {
  const stage = outcome.stage === "schema"
    ? "structured interpretation"
    : outcome.stage === "compilation"
    ? "deterministic compilation"
    : outcome.stage;
  return `Generation stopped at ${stage} (${outcome.code}). Your brief, references, and role edits are unchanged.`;
}

export function GeneratedProjectController() {
  const [brief, setBrief] = useState(M5_REPLAY_SCENARIOS[0]!.brief);
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const [deterministicControls, setDeterministicControls] = useState<GeneratedDeterministicControls>(
    () => structuredClone(DEFAULT_GENERATED_CONTROLS),
  );
  const [fabricationControls, setFabricationControls] = useState<GeneratedFabricationControls>(
    () => structuredClone(DEFAULT_GENERATED_FABRICATION_CONTROLS),
  );
  const [appliedDeterministicControls, setAppliedDeterministicControls] =
    useState<GeneratedDeterministicControls | null>(null);
  const [appliedFabricationControls, setAppliedFabricationControls] =
    useState<GeneratedFabricationControls | null>(null);
  const [state, setState] = useState<ControllerState>({ kind: "idle" });
  const [project, setProject] = useState<CanonicalProjectState>({
    status: "loading",
    requestId: null
  });
  const [handoff, setHandoff] = useState<CanonicalHandoffState>({ status: "loading" });
  const [inputError, setInputError] = useState<string | null>(null);
  const [localCompileError, setLocalCompileError] = useState<string | null>(null);
  const [localCompiling, setLocalCompiling] = useState(false);
  const requestOrdinal = useRef(0);
  const previewUrls = useRef(new Set<string>());
  const lastSubmission = useRef<GenerationSubmissionV1 | null>(null);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  const generated = state.kind === "ready" || state.kind === "concept-only";
  const rolesDirty = references.some((reference) => reference.rolesEdited);
  const stale = state.kind === "ready" && (
    JSON.stringify(deterministicControls) !== JSON.stringify(appliedDeterministicControls) ||
    JSON.stringify(fabricationControls) !== JSON.stringify(appliedFabricationControls)
  );

  const rebuildHandoff = async (compiled: GeneratedCompiledProject): Promise<void> => {
    setHandoff({ status: "loading" });
    try {
      const stockPresetId = compiled.document.resolvedInputs.material.nominalStock?.presetId;
      if (stockPresetId !== "stock-3mm-basswood-laser-plywood" &&
          stockPresetId !== "stock-3mm-birch-laser-plywood") {
        throw new Error("Generated project has no registered stock preset.");
      }
      const fixture = await compileFixtureRequest({
        kind: "fixture-compile",
        requestId: `generated-fit-test-${crypto.randomUUID()}`,
        stockPresetId
      });
      const next = await buildXToolStudioHandoff(
        compiled.document.resolvedInputs.machine,
        { fabrication: compiled.bundle.fabrication, svgs: compiled.svgs },
        { fabrication: fixture.bundle.fabrication, svgs: fixture.svgs },
        compiled.document.provenance.runtimeApplicationApiCalls,
      );
      setHandoff({ status: "ready", handoff: next });
    } catch (error) {
      setHandoff({
        status: "error",
        message: error instanceof Error ? error.message : "Handoff projection failed."
      });
    }
  };

  const acceptCompiledOutcome = (
    outcome: Extract<GenerationOutcomeV1, { kind: "supported" | "simplified" }>,
  ): void => {
    setState({ kind: "ready", outcome });
    setProject(projectState(outcome.compiled));
    setAppliedDeterministicControls(structuredClone(deterministicControls));
    setAppliedFabricationControls(structuredClone(fabricationControls));
    setLocalCompileError(null);
    setReferences((current) => current.map((reference, index) => ({
      ...reference,
      roles: [...(outcome.intent.references[index]?.inferredRoles ?? reference.roles)],
      rolesEdited: false
    })));
    void rebuildHandoff(outcome.compiled);
  };

  const dispatchSubmission = async (submission: GenerationSubmissionV1): Promise<void> => {
    requestOrdinal.current += 1;
    const ordinal = requestOrdinal.current;
    setState({ kind: "dispatching", requestOrdinal: ordinal });
    setInputError(null);
    try {
      const response = await fetch("/__sketchycut/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
        cache: "no-store"
      });
      const outcome = GenerationOutcomeV1Schema.parse(await response.json() as unknown);
      if (ordinal !== requestOrdinal.current) return;
      if (outcome.kind === "failure") {
        setState({ kind: "failure", outcome });
        return;
      }
      if (outcome.kind === "concept-only") {
        setState({ kind: "concept-only", outcome });
        setProject({ status: "loading", requestId: null });
        setHandoff({ status: "loading" });
        setReferences((current) => current.map((reference, index) => ({
          ...reference,
          roles: [...(outcome.intent.references[index]?.inferredRoles ?? reference.roles)],
          rolesEdited: false
        })));
        return;
      }
      acceptCompiledOutcome(outcome);
    } catch {
      if (ordinal !== requestOrdinal.current) return;
      setState({
        kind: "failure",
        outcome: GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          kind: "failure",
          transportMode: "replay",
          stage: "transport",
          code: "SIDECAR_RESPONSE_UNAVAILABLE",
          retryable: true,
          attempt: null
        }) as Extract<GenerationOutcomeV1, { kind: "failure" }>
      });
    }
  };

  const createSubmission = async (): Promise<GenerationSubmissionV1> => {
    const normalized = await normalizeReferenceFiles(references.map((item) => item.file));
    const payloads = await Promise.all(normalized.map(async (item) => ({
      descriptor: item.descriptor,
      dataUrl: await blobDataUrl(item.normalizedBlob)
    })));
    return GenerationSubmissionV1Schema.parse({
      schemaVersion: "1.0",
      brief,
      references: payloads,
      roleConstraints: references.flatMap((reference, index) => reference.rolesEdited ? [{
        referenceId: normalized[index]!.referenceId,
        roles: reference.roles
      }] : []),
      deterministicControls: GeneratedDeterministicControlsSchema.parse(deterministicControls),
      fabricationControls: GeneratedFabricationControlsSchema.parse(fabricationControls),
      retry: null
    });
  };

  const generate = async (): Promise<void> => {
    try {
      const submission = await createSubmission();
      lastSubmission.current = submission;
      await dispatchSubmission(submission);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Reference input is invalid.");
    }
  };

  const retry = async (): Promise<void> => {
    const prior = lastSubmission.current;
    if (prior === null || state.kind !== "failure") return;
    const attempt = state.outcome.attempt;
    const submission = GenerationSubmissionV1Schema.parse({
      ...prior,
      retry: attempt === null ? null : {
        priorAttemptId: attempt.attemptId,
        retryChainId: attempt.retryChainId,
        attemptOrdinal: attempt.attemptOrdinal + 1
      }
    });
    lastSubmission.current = submission;
    await dispatchSubmission(submission);
  };

  const applyLocalChanges = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    setLocalCompiling(true);
    setLocalCompileError(null);
    try {
      const deterministic = GeneratedDeterministicControlsSchema.parse(deterministicControls);
      const fabrication = resolveGeneratedFabricationControls(fabricationControls);
      const compiled = await compileGeneratedProject({
        requestId: `local-recompile-${crypto.randomUUID()}`,
        semanticRequest: state.outcome.semanticRequest,
        intent: state.outcome.intent,
        mapping: state.outcome.mapping,
        profiles: fabrication.profiles,
        inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
        pin: fabrication.pin,
        controls: deterministic,
        cacheResult: "hit",
        runtimeApplicationApiCalls:
          state.outcome.compiled.document.provenance.runtimeApplicationApiCalls
      });
      const outcome = GenerationOutcomeV1Schema.parse({
        ...state.outcome,
        compiled
      }) as Extract<GenerationOutcomeV1, { kind: "supported" | "simplified" }>;
      setState({ kind: "ready", outcome });
      setProject(projectState(compiled));
      setAppliedDeterministicControls(structuredClone(deterministic));
      setAppliedFabricationControls(structuredClone(fabricationControls));
      await rebuildHandoff(compiled);
    } catch (error) {
      setLocalCompileError(
        error instanceof Error ? error.message : "Deterministic recompile failed.",
      );
    } finally {
      setLocalCompiling(false);
    }
  };

  const discardLocalChanges = (): void => {
    if (appliedDeterministicControls !== null) {
      setDeterministicControls(structuredClone(appliedDeterministicControls));
    }
    if (appliedFabricationControls !== null) {
      setFabricationControls(structuredClone(appliedFabricationControls));
    }
    setLocalCompileError(null);
  };

  const addFiles = (files: readonly ReferenceFileInput[]): void => {
    try {
      const combined = [...references.map((item) => item.file), ...files];
      validateReferenceFiles(combined);
      const added = files.map((file, index): ComposerReference => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return {
          localId: `local-reference-${crypto.randomUUID()}`,
          file,
          previewUrl,
          roles: references.length + index === 0 ? ["structure"] : ["motif"],
          rolesEdited: false
        };
      });
      setReferences((current) => [...current, ...added]);
      setInputError(null);
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Reference input is invalid.");
    }
  };

  const removeReference = (localId: string): void => {
    setReferences((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target !== undefined) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrls.current.delete(target.previewUrl);
      }
      return current.filter((item) => item.localId !== localId);
    });
  };

  const useSyntheticReference = (): void => {
    const encoded = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    addFiles([
      new File([bytes], "synthetic-reference.png", { type: "image/png" })
    ]);
  };

  const designContent = state.kind !== "ready" ? null : (
    <section className="controls generated-design-controls" aria-label="Deterministic design controls">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Zero-call edits</p>
          <h2>Design and fabrication controls</h2>
        </div>
        <span className={stale ? "status-warning" : "status-pass"}>
          {stale ? "Draft changes not applied" : "Applied to canonical output"}
        </span>
      </div>
      <div className="generation-option-grid">
        <fieldset>
          <legend>Dimensions and nesting</legend>
          {(["width", "depth", "height"] as const).map((dimension) => (
            <label key={dimension}>
              {dimension} (mm)
              <input
                type="number"
                value={deterministicControls.dimensionsMm[dimension]}
                onChange={(event) => setDeterministicControls({
                  ...deterministicControls,
                  dimensionsMm: {
                    ...deterministicControls.dimensionsMm,
                    [dimension]: Number(event.currentTarget.value)
                  },
                  scaleSource: "user-specified"
                })}
              />
            </label>
          ))}
          <label>
            Stock width (mm)
            <input
              type="number"
              min="100"
              max="426"
              step="0.1"
              value={fabricationControls.stockFootprintMm.width}
              onChange={(event) => setFabricationControls({
                ...fabricationControls,
                stockFootprintMm: {
                  ...fabricationControls.stockFootprintMm,
                  width: Number(event.currentTarget.value)
                }
              })}
            />
          </label>
          <label>
            Stock height (mm)
            <input
              type="number"
              min="100"
              max="320"
              step="0.1"
              value={fabricationControls.stockFootprintMm.height}
              onChange={(event) => setFabricationControls({
                ...fabricationControls,
                stockFootprintMm: {
                  ...fabricationControls.stockFootprintMm,
                  height: Number(event.currentTarget.value)
                }
              })}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Motif placement</legend>
          <label>
            Scale (%)
            <input
              type="number"
              min="50"
              max="150"
              step="5"
              value={deterministicControls.motifPlacement.scalePermille / 10}
              onChange={(event) => setDeterministicControls({
                ...deterministicControls,
                motifPlacement: {
                  ...deterministicControls.motifPlacement,
                  scalePermille: Number(event.currentTarget.value) * 10
                }
              })}
            />
          </label>
          <label>
            Rotation
            <select
              value={deterministicControls.motifPlacement.rotationQuarterTurns}
              onChange={(event) => setDeterministicControls({
                ...deterministicControls,
                motifPlacement: {
                  ...deterministicControls.motifPlacement,
                  rotationQuarterTurns: Number(event.currentTarget.value)
                }
              })}
            >
              <option value={0}>0°</option>
              <option value={1}>90°</option>
              <option value={2}>180°</option>
              <option value={3}>270°</option>
            </select>
          </label>
          <label>
            Horizontal offset (%)
            <input
              type="number"
              min="-20"
              max="20"
              step="1"
              value={deterministicControls.motifPlacement.offsetXPermille / 10}
              onChange={(event) => setDeterministicControls({
                ...deterministicControls,
                motifPlacement: {
                  ...deterministicControls.motifPlacement,
                  offsetXPermille: Number(event.currentTarget.value) * 10
                }
              })}
            />
          </label>
          <label>
            Surface
            <select
              value={deterministicControls.motifPlacement.targetFace}
              onChange={(event) => setDeterministicControls({
                ...deterministicControls,
                motifPlacement: {
                  ...deterministicControls.motifPlacement,
                  targetFace: event.currentTarget.value as "front" | "back"
                }
              })}
            >
              <option value="front">Front</option>
              <option value="back">Back</option>
            </select>
          </label>
        </fieldset>
      </div>
      <div className="generation-actions">
        <button type="button" disabled={!stale || localCompiling} onClick={() => void applyLocalChanges()}>
          {localCompiling ? "Recompiling…" : "Apply design changes"}
        </button>
        <button type="button" disabled={!stale || localCompiling} onClick={discardLocalChanges}>
          Discard draft changes
        </button>
        <span>Local deterministic recompile · zero interpretation requests</span>
      </div>
      {localCompileError === null ? null : <p className="field-error">{localCompileError}</p>}
    </section>
  );

  const sourceSummary = state.kind !== "ready" ? null : (
    <section className="source-summary" aria-label="Interpreted source summary">
      <p className="section-kicker">Interpreted semantic source</p>
      <h2>{state.outcome.intent.title}</h2>
      <p>{state.outcome.intent.coreIntent}</p>
      <p>
        <strong>{state.outcome.kind === "simplified" ? "Supported with disclosed simplification" : "Supported"}</strong>
        {state.outcome.compiled.scaleDisclosure === null
          ? null
          : <> · {state.outcome.compiled.scaleDisclosure}</>}
      </p>
      {state.outcome.mapping.disclosures.length === 0 ? null : (
        <ul>{state.outcome.mapping.disclosures.map((item) => <li key={item}>{item}</li>)}</ul>
      )}
    </section>
  );

  const errorMessage = inputError ?? (state.kind === "failure" ? failureCopy(state.outcome) : null);

  return (
    <main className="create-page">
      <GenerationComposer
        brief={brief}
        references={references}
        deterministicControls={deterministicControls}
        fabricationControls={fabricationControls}
        dispatching={state.kind === "dispatching"}
        generated={generated}
        errorMessage={errorMessage}
        rolesDirty={rolesDirty}
        onBriefChange={setBrief}
        onFiles={addFiles}
        onUseSyntheticReference={useSyntheticReference}
        onRemove={removeReference}
        onRoleChange={(localId: string, roles: ReferenceRole[]) => setReferences((current) =>
          current.map((reference) => reference.localId === localId
            ? { ...reference, roles, rolesEdited: true }
            : reference))}
        onDeterministicControlsChange={setDeterministicControls}
        onFabricationControlsChange={setFabricationControls}
        onSubmit={() => void generate()}
      />

      {state.kind === "failure" && state.outcome.retryable ? (
        <section className="generation-outcome failure-outcome" aria-label="Generation failure">
          <h2>Nothing partial was accepted</h2>
          <p>{failureCopy(state.outcome)}</p>
          <button type="button" onClick={() => void retry()}>Retry the same request once</button>
        </section>
      ) : null}

      {state.kind === "concept-only" ? (
        <section className="generation-outcome concept-outcome" aria-label="Concept-only result">
          <p className="section-kicker">Concept only · fabrication export withheld</p>
          <h2>{state.outcome.intent.title}</h2>
          <p>The essential function is outside the registered deterministic construction catalog.</p>
          <ul>{state.outcome.mapping.unresolvedNeeds.map((need) => <li key={need}>{need}</li>)}</ul>
        </section>
      ) : null}

      {state.kind === "ready" ? (
        <section className="generation-outcome supported-outcome" aria-label="Deterministic support outcome">
          <p className="section-kicker">Deterministic support state</p>
          <h2>{state.outcome.kind === "simplified"
            ? "Supported with disclosed simplification"
            : "Supported without functional simplification"}</h2>
          <p>
            Every mandatory requirement has a registered deterministic evidence path.
            {state.outcome.kind === "simplified"
              ? ` ${state.outcome.mapping.disclosures.join(" ")}`
              : " Exact fabrication geometry was compiled and validated from the canonical document."}
          </p>
        </section>
      ) : null}

      {state.kind === "ready" ? (
        <CanonicalProjectWorkspace
          project={project}
          handoff={handoff}
          presentation={{
            sourceId: "generated-reference-project",
            structuralKind: structuralKind(state.outcome)
          }}
          designContent={designContent}
          sourceSummary={sourceSummary}
          stale={stale}
        />
      ) : null}

      <footer className="create-footer">
        <p>Fabrication candidate · physical verification required.</p>
        <a href="/examples">Open the zero-call guided examples</a>
      </footer>
    </main>
  );
}
