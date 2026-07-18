"use client";

import { useEffect, useRef, useState } from "react";

import {
  GenerationOutcomeV1Schema,
  GenerationSubmissionV1Schema,
  type GenerationOutcomeV1,
  type GenerationSubmissionV1
} from "../../interpretation/generation-protocol";
import {
  M6GenerationResponseSchema,
  M6ProjectResponseSchema,
  type M6GenerationResponse
} from "../../server/m6/api-contracts";
import {
  SemanticReferenceDescriptorSchema,
  type SemanticGenerationRequestV1
} from "../../interpretation/semantic-request";
import {
  normalizeReferenceFiles,
  validateReferenceFiles,
  type ReferenceFileInput
} from "../../interpretation/image-normalization";
import type { ReferenceRole } from "../../interpretation/intent-graph";
import { M5_REPLAY_SCENARIOS } from "../../interpretation/m5-replay-corpus";
import { buildXToolStudioHandoff } from "../../projections/handoff";
import { compileAccumulatedKerfGauge } from "../../operators/accumulated-kerf-gauge";
import { buildMultiSheetProjectionBundle } from "../../projections/bundle";
import { nestPartsAcrossSheets } from "../../projections/fabrication/nesting";
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
      source: Pick<
        Extract<GenerationOutcomeV1, { kind: "supported" | "simplified" }>,
        "kind" | "intent" | "mapping" | "compiled" | "transportMode"
      >;
    };

type ProjectSummary = NonNullable<M6GenerationResponse["project"]>;

function usesM5Sidecar(): boolean {
  return document.querySelector('meta[name="sketchycut-transport"][content="m5-sidecar"]') !== null;
}

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
  outcome: Extract<ControllerState, { kind: "ready" }>["source"],
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
  if (outcome.code === "REPLAY_FIXTURE_NOT_FOUND") {
    return "Fixture mode has no recorded scenario for this exact brief. Choose a listed replay scenario; live interpretation never starts implicitly.";
  }
  const stage = outcome.stage === "schema"
    ? "structured interpretation"
    : outcome.stage === "compilation"
    ? "deterministic compilation"
    : outcome.stage;
  return `Generation stopped at ${stage} (${outcome.code}). Your brief, references, and role edits are unchanged.`;
}

export function GeneratedProjectController(props: {
  generationExperience: "live" | "replay-fixture";
}) {
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
  const [persistedProject, setPersistedProject] = useState<ProjectSummary | null>(null);
  const requestOrdinal = useRef(0);
  const previewUrls = useRef(new Set<string>());
  const lastSubmission = useRef<GenerationSubmissionV1 | null>(null);
  const lastSemanticRequest = useRef<SemanticGenerationRequestV1 | null>(null);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (usesM5Sidecar()) return;
    let active = true;
    void fetch("/api/create/project", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const restored = M6ProjectResponseSchema.parse(await response.json() as unknown);
      if (!active) return;
      setDeterministicControls(structuredClone(restored.source.deterministicControls));
      setFabricationControls(structuredClone(restored.source.fabricationControls));
      setAppliedDeterministicControls(structuredClone(restored.source.deterministicControls));
      setAppliedFabricationControls(structuredClone(restored.source.fabricationControls));
      setPersistedProject(restored.project);
      setState({
        kind: "ready",
        source: {
          kind: restored.source.kind,
          intent: restored.source.intent,
          mapping: restored.source.mapping,
          compiled: restored.compiled,
          transportMode: props.generationExperience === "live" ? "live" : "replay"
        }
      });
      setProject(projectState(restored.compiled));
      void rebuildHandoff(restored.compiled);
    }).catch(() => undefined);
    return () => { active = false; };
  // Restore exactly once for a fresh protected workspace.
  }, [props.generationExperience]);

  const generated = state.kind === "ready" || state.kind === "concept-only";
  const rolesDirty = references.some((reference) => reference.rolesEdited);
  const stale = state.kind === "ready" && (
    JSON.stringify(deterministicControls) !== JSON.stringify(appliedDeterministicControls) ||
    JSON.stringify(fabricationControls) !== JSON.stringify(appliedFabricationControls)
  );

  const rebuildHandoff = async (compiled: GeneratedCompiledProject): Promise<void> => {
    setHandoff({ status: "loading" });
    try {
      const profiles = {
        material: compiled.document.resolvedInputs.material,
        machine: compiled.document.resolvedInputs.machine,
        processRecipe: compiled.document.resolvedInputs.processRecipe,
        fabricationContext: compiled.document.resolvedInputs.fabricationContext,
        fit: compiled.document.resolvedInputs.fit
      };
      const fixtureDocument = await compileAccumulatedKerfGauge(
        profiles,
        compiled.document.provenance.inputPolicyEvaluation,
      );
      const fixture = await buildMultiSheetProjectionBundle(
        fixtureDocument,
        nestPartsAcrossSheets(
          fixtureDocument.parts,
          profiles.machine,
          profiles.material,
          profiles.processRecipe,
          profiles.fabricationContext,
        ),
      );
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
    projectSummary: ProjectSummary | null,
  ): void => {
    lastSemanticRequest.current = outcome.semanticRequest;
    setState({
      kind: "ready",
      source: {
        kind: outcome.kind,
        intent: outcome.intent,
        mapping: outcome.mapping,
        compiled: outcome.compiled,
        transportMode: outcome.transportMode
      }
    });
    setPersistedProject(projectSummary);
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
      const sidecar = usesM5Sidecar();
      const response = await fetch(sidecar ? "/__sketchycut/generate" : "/api/create/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
        cache: "no-store"
      });
      const payload = await response.json() as unknown;
      const generation = sidecar
        ? { outcome: GenerationOutcomeV1Schema.parse(payload), project: null }
        : M6GenerationResponseSchema.parse(payload);
      const outcome = generation.outcome;
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
      acceptCompiledOutcome(outcome, generation.project);
    } catch {
      if (ordinal !== requestOrdinal.current) return;
      setState({
        kind: "failure",
        outcome: GenerationOutcomeV1Schema.parse({
          schemaVersion: "1.0",
          kind: "failure",
          transportMode: props.generationExperience === "live" ? "live" : "replay",
          stage: "transport",
          code: "GENERATION_RESPONSE_UNAVAILABLE",
          retryable: true,
          attempt: null
        }) as Extract<GenerationOutcomeV1, { kind: "failure" }>
      });
    }
  };

  const createSubmission = async (): Promise<GenerationSubmissionV1> => {
    const sidecar = usesM5Sidecar();
    const normalized = await normalizeReferenceFiles(references.map((item) => item.file));
    const payloads = sidecar
      ? await Promise.all(normalized.map(async (item) => ({
          descriptor: item.descriptor,
          dataUrl: await blobDataUrl(item.normalizedBlob)
        })))
      : await Promise.all(normalized.map(async (item) => {
          const response = await fetch("/api/create/upload", {
            method: "POST",
            headers: {
              "content-type": item.normalizedBlob.type,
              "x-sketchycut-reference-id": item.referenceId
            },
            body: item.normalizedBlob,
            cache: "no-store"
          });
          if (!response.ok) throw new Error("Reference upload could not be accepted.");
          const candidate = await response.json() as { descriptor?: unknown; dataUrl?: unknown };
          const descriptor = SemanticReferenceDescriptorSchema.parse(candidate.descriptor);
          if (typeof candidate.dataUrl !== "string") throw new Error("Reference upload response was invalid.");
          return {
            descriptor,
            dataUrl: candidate.dataUrl
          };
        }));
    return GenerationSubmissionV1Schema.parse({
      schemaVersion: "1.0",
      brief,
      references: payloads,
      roleConstraints: references.flatMap((reference, index) => reference.rolesEdited ? [{
        referenceId: payloads[index]!.descriptor.referenceId,
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
      let compiled: GeneratedCompiledProject;
      if (usesM5Sidecar()) {
        const semanticRequest = lastSemanticRequest.current;
        if (semanticRequest === null) throw new Error("Semantic provenance is unavailable.");
        compiled = await compileGeneratedProject({
          requestId: `local-recompile-${crypto.randomUUID()}`,
          semanticRequest,
          intent: state.source.intent,
          mapping: state.source.mapping,
          profiles: fabrication.profiles,
          inputPolicyEvaluation: fabrication.inputPolicyEvaluation,
          pin: fabrication.pin,
          controls: deterministic,
          cacheResult: "hit",
          runtimeApplicationApiCalls:
            state.source.compiled.document.provenance.runtimeApplicationApiCalls
        });
        setState({ kind: "ready", source: { ...state.source, compiled } });
      } else {
        if (persistedProject === null) throw new Error("Saved project identity is unavailable.");
        const response = await fetch("/api/create/project", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            schemaVersion: "1.0",
            projectId: persistedProject.projectId,
            expectedRevision: persistedProject.revision,
            deterministicControls: deterministic,
            fabricationControls
          }),
          cache: "no-store"
        });
        if (!response.ok) throw new Error("The saved project changed or could not be updated.");
        const updated = M6ProjectResponseSchema.parse(await response.json() as unknown);
        compiled = updated.compiled;
        setPersistedProject(updated.project);
        setState({
          kind: "ready",
          source: {
            ...state.source,
            kind: updated.source.kind,
            intent: updated.source.intent,
            mapping: updated.source.mapping,
            compiled
          }
        });
      }
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
      <h2>{state.source.intent.title}</h2>
      <p>{state.source.intent.coreIntent}</p>
      <p>
        <strong>{state.source.kind === "simplified" ? "Supported with disclosed simplification" : "Supported"}</strong>
        {state.source.compiled.scaleDisclosure === null
          ? null
          : <> · {state.source.compiled.scaleDisclosure}</>}
      </p>
      {state.source.mapping.disclosures.length === 0 ? null : (
        <ul>{state.source.mapping.disclosures.map((item) => <li key={item}>{item}</li>)}</ul>
      )}
    </section>
  );

  const errorMessage = inputError ?? (state.kind === "failure" ? failureCopy(state.outcome) : null);

  return (
    <main className="create-page">
      <GenerationComposer
        generationExperience={props.generationExperience}
        fixtureScenarios={M5_REPLAY_SCENARIOS.map((scenario) => ({
          id: scenario.id,
          brief: scenario.brief,
          label: scenario.id === "invalid-output"
            ? "Invalid output (failure-preservation fixture)"
            : scenario.id.replaceAll("-", " ")
        }))}
        brief={brief}
        references={references}
        deterministicControls={deterministicControls}
        fabricationControls={fabricationControls}
        dispatching={state.kind === "dispatching"}
        generated={generated}
        errorMessage={errorMessage}
        rolesDirty={rolesDirty}
        onBriefChange={setBrief}
        onFixtureScenarioChange={(nextBrief) => {
          setBrief(nextBrief);
          setInputError(null);
        }}
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
          <h2>{state.source.kind === "simplified"
            ? "Supported with disclosed simplification"
            : "Supported without functional simplification"}</h2>
          <p>
            Every mandatory requirement has a registered deterministic evidence path.
            {state.source.kind === "simplified"
              ? ` ${state.source.mapping.disclosures.join(" ")}`
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
            structuralKind: structuralKind(state.source)
          }}
          designContent={designContent}
          sourceSummary={sourceSummary}
          stale={stale}
          {...(persistedProject === null ? {} : {
            packageDownload: {
              projectId: persistedProject.projectId,
              label: "Download complete fabrication package"
            }
          })}
        />
      ) : null}

      <footer className="create-footer">
        <p>Fabrication candidate · physical verification required.</p>
        <a href="/examples">Open the zero-call guided examples</a>
      </footer>
    </main>
  );
}
