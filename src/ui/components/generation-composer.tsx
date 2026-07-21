"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type SyntheticEvent,
  useId,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  MAX_REFERENCE_BYTES,
  MAX_REFERENCE_COUNT,
  type ReferenceFileInput
} from "../../interpretation/image-normalization";
import type { GenerationDeterministicControlsV2 } from "../../interpretation/generation-submission-v2";
import type { GeneratedFabricationControls } from "../content/generated-setup";
import { GENERATED_STOCK_OPTIONS } from "../content/generated-setup";

export type ComposerReference = {
  localId: string;
  file: ReferenceFileInput;
  previewUrl: string;
  roles: ("structure" | "motif")[];
  rolesEdited: boolean;
  normalizationDisposition: "preserved" | "normalized" | null;
};

type Props = {
  generationExperience: "live" | "fixture";
  fixtureScenarios: readonly { id: string; brief: string; label: string }[];
  brief: string;
  references: readonly ComposerReference[];
  deterministicControls: GenerationDeterministicControlsV2;
  fabricationControls: GeneratedFabricationControls;
  dispatching: boolean;
  generated: boolean;
  errorMessage: string | null;
  rolesDirty: boolean;
  onBriefChange(value: string): void;
  onFixtureScenarioChange(brief: string): void;
  onFiles(files: readonly ReferenceFileInput[]): void;
  onUseSyntheticReference(): void;
  onRemove(localId: string): void;
  onRoleChange(localId: string, roles: ("structure" | "motif")[]): void;
  onRoleAuto(localId: string): void;
  onDeterministicControlsChange(value: GenerationDeterministicControlsV2): void;
  onFabricationControlsChange(value: GeneratedFabricationControls): void;
  onSubmit(): void;
};

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

function fileList(files: FileList | null): ReferenceFileInput[] {
  return files === null ? [] : Array.from(files);
}

function advancedDimensions(controls: GenerationDeterministicControlsV2) {
  return controls.advancedSizing.basis === "auto" ? {} : controls.advancedSizing.dimensions;
}

export function GenerationComposer(props: Props) {
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const remainingCharacters = 4_000 - props.brief.length;
  const [announcedRemaining, setAnnouncedRemaining] = useState(remainingCharacters);
  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncedRemaining(remainingCharacters), 500);
    return () => window.clearTimeout(timeout);
  }, [remainingCharacters]);
  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSubmit();
  };
  const receiveFiles = (files: readonly ReferenceFileInput[]): void => {
    if (files.length > 0) props.onFiles(files);
    if (fileInput.current !== null) fileInput.current.value = "";
  };
  const onInput = (event: ChangeEvent<HTMLInputElement>): void => {
    receiveFiles(fileList(event.currentTarget.files));
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    receiveFiles(fileList(event.dataTransfer.files));
  };

  return (
    <section className={`generation-composer ${props.generated ? "generated" : ""}`} aria-labelledby="generation-heading">
      <div className="generation-heading-row">
        <div>
          <p className="eyebrow">Reference interpretation</p>
          <h1 id="generation-heading">Describe what you want to make</h1>
          <p>
            Optionally add up to 3 reference images. The interpretation identifies semantic intent;
            deterministic SketchyCut code owns every dimension, joint, fit, path, and export decision.
          </p>
        </div>
        {props.generated ? <span className="status-pass">Interpreted and validated</span> : null}
      </div>

      <form className="generation-editor" onSubmit={submit}>
        {props.generationExperience === "fixture" ? (
          <label className="generation-fixture-scenario">
            Fixture scenario
            <select
              value={props.brief}
              disabled={props.dispatching}
              onChange={(event) => props.onFixtureScenarioChange(event.currentTarget.value)}
            >
              {props.fixtureScenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.brief}>{scenario.label}</option>
              ))}
            </select>
            <small>Fixture mode uses a tracked deterministic scenario and makes no model request.</small>
          </label>
        ) : null}
        <label className="generation-brief">
          Prompt
          <textarea
            value={props.brief}
            maxLength={4_000}
            rows={4}
            disabled={props.dispatching}
            readOnly={props.generationExperience === "fixture"}
            onChange={(event) => props.onBriefChange(event.currentTarget.value)}
          />
          <small className="character-counter">
            {remainingCharacters.toLocaleString("en-US")} characters remaining · 4,000 maximum
          </small>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {announcedRemaining.toLocaleString("en-US")} characters remaining
          </span>
          <small>{props.generationExperience === "fixture"
            ? "This exact brief is part of the selected regression fixture."
            : "Say which function is essential and whether each reference informs structure, surface treatment, or both."}</small>
        </label>

        <div
          className="reference-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileInput}
            id={inputId}
            className="sr-only"
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            disabled={props.dispatching || props.references.length >= MAX_REFERENCE_COUNT}
            onChange={onInput}
          />
          <label htmlFor={inputId} className="button-like">
            Add reference images
          </label>
          {props.references.length === 0 ? (
            <button type="button" className="quiet-button" onClick={() => props.onUseSyntheticReference()}>
              Use a synthetic sample
            </button>
          ) : null}
          <span>or drop JPEG, PNG, or WebP here</span>
          <small>
            0–{MAX_REFERENCE_COUNT} images · up to {String(MAX_REFERENCE_BYTES / 1024 / 1024)} MB each · compatible image bytes are preserved; oversized images are fidelity-normalized once
          </small>
          <small className="reference-privacy-copy">
            {props.generationExperience === "live"
              ? "Images are sent to OpenAI for interpretation and are not stored by SketchyCut."
              : "Fixture mode makes no model request; image bytes are used only for request processing and are not stored by SketchyCut."}
          </small>
        </div>

        {props.references.length === 0 ? null : (
          <ul className="reference-grid" aria-label="Selected references">
            {props.references.map((reference, index) => (
              <li key={reference.localId}>
                <img src={reference.previewUrl} alt={`Reference ${String(index + 1)} preview`} />
                <div>
                  <strong>Reference {String(index + 1)}</strong>
                  <small>
                    {reference.normalizationDisposition === "preserved"
                      ? "Source image bytes preserved for interpretation."
                      : reference.normalizationDisposition === "normalized"
                      ? "Image exceeded a transport bound and was fidelity-normalized once."
                      : "Image processing is determined when you generate."}
                  </small>
                  <fieldset>
                    <legend>Reference role</legend>
                    {reference.rolesEdited ? (<>
                      {(["structure", "motif"] as const).map((role) => (
                        <label key={role}>
                          <input
                            type="checkbox"
                            checked={reference.roles.includes(role)}
                            disabled={props.dispatching}
                            onChange={(event) => {
                              const next = event.currentTarget.checked
                                ? [...reference.roles, role]
                                : reference.roles.filter((item) => item !== role);
                              if (next.length > 0) props.onRoleChange(reference.localId, next);
                            }}
                          />
                          {role === "structure" ? "Structure" : "Surface treatment"}
                        </label>
                      ))}
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={props.dispatching}
                        onClick={() => props.onRoleAuto(reference.localId)}
                      >Use Auto role</button>
                    </>) : (<>
                      <p><strong>Auto</strong> · no maker-set role is submitted</p>
                      <button
                        type="button"
                        className="quiet-button"
                        disabled={props.dispatching}
                        onClick={() => props.onRoleChange(reference.localId, reference.roles)}
                      >Set role manually</button>
                    </>)}
                  </fieldset>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={props.dispatching}
                    onClick={() => props.onRemove(reference.localId)}
                  >Remove reference {String(index + 1)}</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="generation-options">
          <summary>Optional size and fabrication details</summary>
          <div className="generation-option-grid">
            <fieldset>
              <legend>Advanced sizing</legend>
              <label>
                Sizing basis
                <select
                  value={props.deterministicControls.advancedSizing.basis}
                  disabled={props.dispatching}
                  onChange={(event) => props.onDeterministicControlsChange({
                    ...props.deterministicControls,
                    advancedSizing: event.currentTarget.value === "auto"
                      ? { basis: "auto" }
                      : {
                          basis: event.currentTarget.value as "exact-external" | "exact-internal",
                          // The form may be temporarily incomplete; strict submission parsing
                          // requires at least one actual maker-entered axis before dispatch.
                          dimensions: {}
                        }
                  })}
                >
                  <option value="auto">Auto from intent</option>
                  <option value="exact-external">Exact external</option>
                  <option value="exact-internal">Exact internal</option>
                </select>
              </label>
              {props.deterministicControls.advancedSizing.basis === "auto" ? (
                <small>No hidden project dimensions are sent or applied. Deterministic sizing uses semantic evidence and disclosed policy fallbacks.</small>
              ) : (["width", "depth", "height"] as const).map((dimension) => (
                <label key={dimension}>
                  {dimension[0]!.toUpperCase() + dimension.slice(1)} (mm)
                  <input
                    type="number"
                    min="0.01"
                    max="1000"
                    step="0.01"
                    value={advancedDimensions(props.deterministicControls)[`${dimension}Mm`] ?? ""}
                    disabled={props.dispatching}
                    onChange={(event) => {
                      if (props.deterministicControls.advancedSizing.basis === "auto") return;
                      const key = `${dimension}Mm` as const;
                      const dimensions = { ...props.deterministicControls.advancedSizing.dimensions };
                      dimensions[key] = event.currentTarget.value === ""
                        ? undefined
                        : Number(event.currentTarget.value);
                      props.onDeterministicControlsChange({
                        ...props.deterministicControls,
                        advancedSizing: { basis: props.deterministicControls.advancedSizing.basis, dimensions }
                      });
                    }}
                  />
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Material and fit</legend>
              <label>
                Stock
                <select
                  aria-label="Stock material"
                  value={props.fabricationControls.stockPresetId}
                  disabled={props.dispatching}
                  onChange={(event) => props.onFabricationControlsChange({
                    ...props.fabricationControls,
                    stockPresetId: event.currentTarget.value as GeneratedFabricationControls["stockPresetId"]
                  })}
                >
                  {GENERATED_STOCK_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Fit bias
                <select
                  aria-label="Fit bias"
                  value={props.fabricationControls.fitBiasMm}
                  disabled={props.dispatching}
                  onChange={(event) => props.onFabricationControlsChange({
                    ...props.fabricationControls,
                    fitBiasMm: Number(event.currentTarget.value) as -0.05 | 0 | 0.05
                  })}
                >
                  <option value={0}>Registered provisional ladder</option>
                  <option value={-0.05}>Tighter by 0.05 mm</option>
                  <option value={0.05}>Looser by 0.05 mm</option>
                </select>
              </label>
              <label>
                Full cut width (mm)
                <input
                  type="number"
                  min="0.05"
                  max="0.40"
                  step="0.01"
                  value={props.fabricationControls.fullCutWidthMm}
                  disabled={props.dispatching}
                  onChange={(event) => props.onFabricationControlsChange({
                    ...props.fabricationControls,
                    fullCutWidthMm: Number(event.currentTarget.value)
                  })}
                />
              </label>
            </fieldset>
          </div>
        </details>

        {props.errorMessage === null ? null : <p className="field-error" role="alert">{props.errorMessage}</p>}
        <div className="generation-actions">
          <button
            type="submit"
            disabled={props.dispatching || props.brief.trim().length === 0}
          >
            {props.dispatching
              ? "Interpreting…"
              : props.generated && props.rolesDirty
              ? "Regenerate with these roles"
              : props.generated
              ? "Regenerate project"
              : "Generate project"}
          </button>
        </div>
      </form>
    </section>
  );
}
