"use client";

import { useEffect, useRef, useState } from "react";

import {
  GenerationOutcomeV2Schema,
  type GenerationOutcomeV2
} from "../../interpretation/generation-outcome-v2";
import {
  DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2,
  GenerationDeterministicControlsV2Schema,
  GenerationSubmissionV2Schema,
  type GenerationDeterministicControlsV2,
  type GenerationSubmissionV2
} from "../../interpretation/generation-submission-v2";
import {
  CurrentGenerationResponseSchema,
  CurrentProjectResponseSchema,
  type CurrentGenerationResponse
} from "../../server/generation/api-contracts-v2";
import {
  SemanticReferenceDescriptorSchema,
} from "../../interpretation/semantic-input-contracts";
import {
  normalizeReferenceFiles,
  validateReferenceFiles,
  type ReferenceFileInput
} from "../../interpretation/image-normalization";
import { CURRENT_FIXTURE_SCENARIOS } from "../../interpretation/current-fixture-corpus";
import { buildXToolStudioHandoff } from "../../projections/handoff";
import { compileAccumulatedKerfGauge } from "../../operators/accumulated-kerf-gauge";
import { buildMultiSheetProjectionBundle } from "../../projections/bundle";
import { nestPartsAcrossSheets } from "../../projections/fabrication/nesting";
import type { ProductCompileWorkerRequest } from "../../workers/protocol";
import type { GeneratedCompiledProject } from "../../interpretation/generated-project-contracts";
import {
  DEFAULT_GENERATED_FABRICATION_CONTROLS,
  GeneratedFabricationControlsSchema,
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
  | { kind: "failure"; outcome: Extract<GenerationOutcomeV2, { kind: "failure" }> }
  | { kind: "concept-only"; outcome: Extract<GenerationOutcomeV2, { kind: "concept-only" }> }
  | {
      kind: "ready";
      source: {
        kind: "supported" | "simplified";
        intent: Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["intent"];
        selectedPlan: Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["selectedPlan"];
        requirementRealization: Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["requirementRealization"];
        observationRealization: Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["observationRealization"];
        simplificationDisclosures: string[];
        transportMode: "fixture" | "live";
        compiled: GeneratedCompiledProject;
      };
    };

type ProjectSummary = NonNullable<CurrentGenerationResponse["project"]>;
type RequirementLedger = Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["requirementRealization"];
type ObservationLedger = Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>["source"]["observationRealization"];

function realizationDisclosures(requirements: RequirementLedger, observations: ObservationLedger): string[] {
  return [
    ...requirements.records.flatMap((record) => record.disclosure === null ? [] : [record.disclosure]),
    ...observations.records.flatMap((record) =>
      record.coverage === "prefer" && record.disclosure !== null ? [record.disclosure] : []
    )
  ];
}

function sourceKind(requirements: RequirementLedger, observations: ObservationLedger): "supported" | "simplified" {
  return requirements.records.some((record) => record.state === "simplified") ||
    observations.simplifiedObservationIds.length > 0 ? "simplified" : "supported";
}

function InterpretationRealizationSummary(props: {
  requirements: RequirementLedger;
  observations: ObservationLedger;
}) {
  const observed = props.observations.records.map((record) =>
    `${record.observationKind}: ${record.observationValue} (${record.relationship})`
  );
  const rows = ([
    ["Realized", "realized"],
    ["Simplified", "simplified"],
    ["Unsupported", "unsupported"],
    ["Conflict resolved", "conflict-resolved"],
    ["Uncertain", "uncertain"]
  ] as const).map(([label, state]) => ({
    label,
    items: [
      ...props.requirements.records.filter((record) => record.state === state)
        .map((record) => `Requirement: ${record.requirementKind}`),
      ...props.observations.records.filter((record) => record.state === state)
        .map((record) => `${record.observationKind}: ${record.observationValue}`)
    ]
  }));
  return (
    <section className="interpretation-realization" aria-labelledby="interpretation-realization-heading">
      <p className="section-kicker">Reference interpretation</p>
      <h3 id="interpretation-realization-heading">Observed versus deterministically realized</h3>
      <p>Image observations describe semantic evidence only. SketchyCut’s deterministic pipeline assigns every realization state and independently validates fabrication geometry.</p>
      <dl>
        <div>
          <dt>Observed</dt>
          <dd>{observed.length === 0 ? "No reference observations; this was a text-only interpretation." : (
            <ul>{observed.map((item, index) => <li key={`observed-${String(index)}-${item}`}>{item}</li>)}</ul>
          )}</dd>
        </div>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.items.length === 0 ? "None" : (
              <ul>{row.items.map((item, index) => (
                <li key={`${row.label}-${String(index)}-${item}`}>{item}</li>
              ))}</ul>
            )}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function structuralKind(
  outcome: Extract<ControllerState, { kind: "ready" }>["source"],
): ProductCompileWorkerRequest["structuralKind"] {
  return outcome.selectedPlan.topology.mechanism === "retained-pin"
    ? "retained-pin"
    : outcome.selectedPlan.topology.mechanism === "captured-slide"
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

// Plain-language copy for pre-dispatch quota and session failures. These stop
// the request before any model call, so inputs are always preserved.
const QUOTA_FAILURE_COPY: Record<string, string> = {
  GENERATION_SESSION_QUOTA:
    "This access session has used its four live generations. Your brief, references, and role edits are saved; start a new authorized session to continue.",
  GENERATION_SESSION_BUDGET:
    "This access session has reached its spending limit. Your brief, references, and role edits are saved; start a new authorized session to continue.",
  GENERATION_CLIENT_RATE:
    "You have reached the hourly limit for live generations. Your brief, references, and role edits are saved; try again in a little while.",
  GENERATION_GLOBAL_BUDGET:
    "The overall live-generation budget is used up for now. Your brief, references, and role edits are saved; try again later.",
  GENERATION_INTERVAL:
    "Generations are limited to one every few seconds. Your brief, references, and role edits are saved; wait a moment and try again.",
  GENERATION_SESSION_MISSING:
    "Your access session has ended. Your brief, references, and role edits are saved; log in again to continue.",
  GENERATION_SESSION_EXPIRED:
    "Your access session has expired. Your brief, references, and role edits are saved; log in again to continue.",
  GENERATION_RESERVATION_UNAVAILABLE:
    "We could not confirm generation availability. Your brief, references, and role edits are saved; try again."
};

function failureCopy(outcome: Extract<GenerationOutcomeV2, { kind: "failure" }>): string {
  if (outcome.code === "FIXTURE_NOT_FOUND") {
    return "Fixture mode has no recorded scenario for this exact brief. Choose a listed fixture scenario; live interpretation never starts implicitly.";
  }
  const quotaCopy = QUOTA_FAILURE_COPY[outcome.code];
  if (quotaCopy !== undefined) return quotaCopy;
  const stage = outcome.stage === "schema"
    ? "structured interpretation"
    : outcome.stage === "compilation"
    ? "deterministic compilation"
    : outcome.stage;
  return `Generation stopped at ${stage} (${outcome.code}). Your brief, references, and role edits are unchanged.`;
}

export function GeneratedProjectController(props: {
  generationExperience: "live" | "fixture";
}) {
  const [brief, setBrief] = useState(CURRENT_FIXTURE_SCENARIOS[0]!.brief);
  const [references, setReferences] = useState<ComposerReference[]>([]);
  const [deterministicControls, setDeterministicControls] = useState<GenerationDeterministicControlsV2>(
    () => structuredClone(DEFAULT_GENERATION_DETERMINISTIC_CONTROLS_V2),
  );
  const [fabricationControls, setFabricationControls] = useState<GeneratedFabricationControls>(
    () => structuredClone(DEFAULT_GENERATED_FABRICATION_CONTROLS),
  );
  const [appliedDeterministicControls, setAppliedDeterministicControls] =
    useState<GenerationDeterministicControlsV2 | null>(null);
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
  const lastSubmission = useRef<GenerationSubmissionV2 | null>(null);
  const retryContext = useRef<CurrentGenerationResponse["retryContext"]>(null);

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/create/project", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const restored = CurrentProjectResponseSchema.parse(await response.json() as unknown);
      if (!active) return;
      setDeterministicControls(structuredClone(restored.deterministicControls));
      setFabricationControls(structuredClone(restored.fabricationControls));
      setAppliedDeterministicControls(structuredClone(restored.deterministicControls));
      setAppliedFabricationControls(structuredClone(restored.fabricationControls));
      setPersistedProject(restored.project);
      setState({
        kind: "ready",
        source: {
          kind: sourceKind(restored.source.requirementRealization, restored.source.observationRealization),
          intent: restored.source.intent,
          selectedPlan: restored.source.selectedPlan,
          requirementRealization: restored.source.requirementRealization,
          observationRealization: restored.source.observationRealization,
          simplificationDisclosures: realizationDisclosures(
            restored.source.requirementRealization,
            restored.source.observationRealization
          ),
          compiled: restored.compiled,
          transportMode: props.generationExperience === "live" ? "live" : "fixture"
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
        compiled.document,
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
    outcome: Extract<GenerationOutcomeV2, { kind: "supported" | "simplified" }>,
    compiled: GeneratedCompiledProject,
    projectSummary: ProjectSummary | null,
  ): void => {
    setState({
      kind: "ready",
      source: {
        kind: outcome.kind,
        intent: outcome.source.intent,
        selectedPlan: outcome.source.selectedPlan,
        requirementRealization: outcome.source.requirementRealization,
        observationRealization: outcome.source.observationRealization,
        simplificationDisclosures: outcome.simplificationDisclosures,
        compiled,
        transportMode: outcome.transportMode
      }
    });
    setPersistedProject(projectSummary);
    setProject(projectState(compiled));
    setAppliedDeterministicControls(structuredClone(deterministicControls));
    setAppliedFabricationControls(structuredClone(fabricationControls));
    setLocalCompileError(null);
    setReferences((current) => current.map((reference) => ({ ...reference, rolesEdited: false })));
    void rebuildHandoff(compiled);
  };

  const dispatchSubmission = async (submission: GenerationSubmissionV2): Promise<void> => {
    requestOrdinal.current += 1;
    const ordinal = requestOrdinal.current;
    setState({ kind: "dispatching", requestOrdinal: ordinal });
    setInputError(null);
    try {
      const response = await fetch("/api/create/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
        cache: "no-store"
      });
      const generation = CurrentGenerationResponseSchema.parse(await response.json() as unknown);
      const outcome = generation.outcome;
      if (ordinal !== requestOrdinal.current) return;
      if (outcome.kind === "failure") {
        retryContext.current = generation.retryContext;
        if (!outcome.retryable) lastSubmission.current = null;
        setState({ kind: "failure", outcome });
        return;
      }
      // Normalized reference data URLs are retained only while an explicit retry can
      // reuse the exact dispatched request. Terminal outcomes no longer need the
      // request bytes, while the original File objects remain available in the form.
      lastSubmission.current = null;
      if (outcome.kind === "concept-only") {
        setState({ kind: "concept-only", outcome });
        setProject({ status: "loading", requestId: null });
        setHandoff({ status: "loading" });
        setReferences((current) => current.map((reference) => ({ ...reference, rolesEdited: false })));
        return;
      }
      if (generation.compiled === null) throw new Error("Generation response omitted compiled output.");
      acceptCompiledOutcome(outcome, generation.compiled, generation.project);
    } catch {
      if (ordinal !== requestOrdinal.current) return;
      setState({
        kind: "failure",
        outcome: GenerationOutcomeV2Schema.parse({
          schemaVersion: "2.0",
          kind: "failure",
          transportMode: props.generationExperience === "live" ? "live" : "fixture",
          requestId: `client-failure-${crypto.randomUUID()}`,
          semanticRequestDigest: "0".repeat(64),
          stage: "transport",
          code: "GENERATION_RESPONSE_UNAVAILABLE",
          retryable: true,
          attemptId: null,
          inputState: "preserved-by-caller",
          source: null,
          canonicalResult: null,
          fabricationCandidate: false,
          exportAllowed: false
        }) as Extract<GenerationOutcomeV2, { kind: "failure" }>
      });
    }
  };

  const createSubmission = async (): Promise<GenerationSubmissionV2> => {
    const normalized = await normalizeReferenceFiles(references.map((item) => item.file));
    const payloads = await Promise.all(normalized.map(async (item) => {
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
          const candidate = await response.json() as {
            descriptor?: unknown;
            dataUrl?: unknown;
            normalizationDisposition?: unknown;
          };
          const descriptor = SemanticReferenceDescriptorSchema.parse(candidate.descriptor);
          if (typeof candidate.dataUrl !== "string") throw new Error("Reference upload response was invalid.");
          const serverNormalizationDisposition = candidate.normalizationDisposition;
          if (serverNormalizationDisposition !== "preserved" &&
              serverNormalizationDisposition !== "normalized") {
            throw new Error("Reference upload normalization disclosure was invalid.");
          }
          const normalizationDisposition: "preserved" | "normalized" =
            item.normalizationDisposition === "normalized" ? "normalized" : serverNormalizationDisposition;
          return {
            descriptor,
            dataUrl: candidate.dataUrl,
            normalizationDisposition
          };
        }));
    setReferences((current) => current.map((reference, index) => ({
      ...reference,
      normalizationDisposition: payloads[index]?.normalizationDisposition ?? null
    })));
    return GenerationSubmissionV2Schema.parse({
      schemaVersion: "2.0",
      brief,
      references: payloads.map(({ descriptor, dataUrl }) => ({ descriptor, dataUrl })),
      roleConstraints: references.flatMap((reference, index) => reference.rolesEdited ? [{
        referenceId: payloads[index]!.descriptor.referenceId,
        roles: reference.roles
      }] : []),
      deterministicControls: GenerationDeterministicControlsV2Schema.parse(deterministicControls),
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
    const context = retryContext.current;
    if (context === null) return;
    const submission = GenerationSubmissionV2Schema.parse({
      ...prior,
      retry: context
    });
    lastSubmission.current = submission;
    await dispatchSubmission(submission);
  };

  const applyLocalChanges = async (): Promise<void> => {
    if (state.kind !== "ready") return;
    setLocalCompiling(true);
    setLocalCompileError(null);
    try {
      const deterministic = GenerationDeterministicControlsV2Schema.parse(deterministicControls);
      if (persistedProject === null) throw new Error("Saved project identity is unavailable.");
      const response = await fetch("/api/create/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "2.0",
          projectId: persistedProject.projectId,
          expectedRevision: persistedProject.revision,
          deterministicControls: deterministic,
          fabricationControls
        }),
        cache: "no-store"
      });
      if (!response.ok) throw new Error("The saved project changed or could not be updated.");
      const updated = CurrentProjectResponseSchema.parse(await response.json() as unknown);
      const compiled = updated.compiled;
      setPersistedProject(updated.project);
      setState({
        kind: "ready",
        source: {
          ...state.source,
          kind: sourceKind(updated.source.requirementRealization, updated.source.observationRealization),
          intent: updated.source.intent,
          selectedPlan: updated.source.selectedPlan,
          requirementRealization: updated.source.requirementRealization,
          observationRealization: updated.source.observationRealization,
          simplificationDisclosures: realizationDisclosures(
            updated.source.requirementRealization,
            updated.source.observationRealization
          ),
          compiled
        }
      });
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
          rolesEdited: false,
          normalizationDisposition: null
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

  const designAdvancedSizing = deterministicControls.advancedSizing;
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
          <legend>Project sizing</legend>
          <label>
            Sizing basis
            <select
              value={designAdvancedSizing.basis}
              onChange={(event) => setDeterministicControls({
                ...deterministicControls,
                advancedSizing: event.currentTarget.value === "auto"
                  ? { basis: "auto" }
                  : {
                      basis: event.currentTarget.value as "exact-external" | "exact-internal",
                      dimensions: {}
                    }
              })}
            >
              <option value="auto">Auto from intent</option>
              <option value="exact-external">Exact external</option>
              <option value="exact-internal">Exact internal</option>
            </select>
          </label>
          {designAdvancedSizing.basis === "auto" ? (
            <p>Scale and proportions are selected by the deterministic sizing solver.</p>
          ) : (["width", "depth", "height"] as const).map((dimension) => {
            const key = `${dimension}Mm` as const;
            return (
              <label key={dimension}>
                {dimension} (mm)
                <input
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  value={designAdvancedSizing.dimensions[key] ?? ""}
                  onChange={(event) => setDeterministicControls({
                    ...deterministicControls,
                    advancedSizing: {
                      basis: designAdvancedSizing.basis,
                      dimensions: {
                        ...designAdvancedSizing.dimensions,
                        [key]: event.currentTarget.value === ""
                          ? undefined
                          : Number(event.currentTarget.value)
                      }
                    }
                  })}
                />
              </label>
            );
          })}
        </fieldset>
        <fieldset>
          <legend>Sheet nesting</legend>
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
      <p>{state.source.intent.purpose}</p>
      <p>
        <strong>{state.source.kind === "simplified" ? "Supported with disclosed simplification" : "Supported"}</strong>
        {state.source.compiled.scaleDisclosure === null
          ? null
          : <> · {state.source.compiled.scaleDisclosure}</>}
      </p>
      {state.source.simplificationDisclosures.length === 0 ? null : (
        <ul>{state.source.simplificationDisclosures.map((item) => <li key={item}>{item}</li>)}</ul>
      )}
      {(state.source.compiled.document.applicationLimitations ?? []).map((limitation) => (
        <div className="application-limitation" role="note" key={limitation.code}>
          <strong>{limitation.code === "NON_HEATING_LIGHT_SOURCE_ONLY" ? "Non-heating light source only" : limitation.code}</strong>
          <span>{limitation.message}</span>
        </div>
      ))}
    </section>
  );

  const errorMessage = inputError ?? (state.kind === "failure" ? failureCopy(state.outcome) : null);

  return (
    <main className="create-page">
      <GenerationComposer
        generationExperience={props.generationExperience}
        fixtureScenarios={CURRENT_FIXTURE_SCENARIOS.map((scenario) => ({
          id: scenario.id,
          brief: scenario.brief,
          label: scenario.invalidOutput
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
        onRoleChange={(localId: string, roles: ("structure" | "motif")[]) => setReferences((current) =>
          current.map((reference) => reference.localId === localId
            ? { ...reference, roles, rolesEdited: true }
            : reference))}
        onRoleAuto={(localId: string) => setReferences((current) =>
          current.map((reference) => reference.localId === localId
            ? { ...reference, rolesEdited: false }
            : reference))}
        onDeterministicControlsChange={setDeterministicControls}
        onFabricationControlsChange={setFabricationControls}
        onSubmit={() => void generate()}
      />

      {state.kind === "failure" && state.outcome.retryable && retryContext.current !== null ? (
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
          <section className="concept-findings" aria-labelledby="concept-findings-heading">
            <h3 id="concept-findings-heading">Why generation stopped</h3>
            <ul>
              {state.outcome.findings.map((finding, index) => (
                <li key={`${finding.code}-${String(index)}`}>
                  <code>{finding.code}</code>
                  <span>{finding.message}</span>
                </li>
              ))}
            </ul>
          </section>
          <ul>{state.outcome.unresolvedNeeds.map((need) => <li key={need}>{need}</li>)}</ul>
          {state.outcome.requirementRealization === null || state.outcome.observationRealization === null
            ? null
            : <InterpretationRealizationSummary
                requirements={state.outcome.requirementRealization}
                observations={state.outcome.observationRealization}
              />}
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
              ? ` ${state.source.simplificationDisclosures.join(" ")}`
              : " Exact construction geometry was compiled and validated from the canonical document."}
            {" "}Current fabrication-export availability is shown with the canonical workspace below.
          </p>
          <InterpretationRealizationSummary
            requirements={state.source.requirementRealization}
            observations={state.source.observationRealization}
          />
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
    </main>
  );
}
