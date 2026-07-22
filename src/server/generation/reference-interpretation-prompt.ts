import { CAPABILITY_CATALOG_V1 } from "../../interpretation/capability-catalog.js";
import { CURRENT_PROMPT_LAYOUT_VERSION } from "../../interpretation/semantic-input-contracts.js";

export const REFERENCE_CONFLICT_POLICY_VERSION = "reference-conflict-policy-v1" as const;

export const REFERENCE_CONFLICT_POLICY = Object.freeze({
  version: REFERENCE_CONFLICT_POLICY_VERSION,
  explicitTextWinsOnlyWhenDirectlyStated: [
    "dimensions",
    "material",
    "count",
    "mechanism",
    "visual-treatment",
    "body-role",
    "interface",
    "access",
    "silhouette",
    "proportion",
    "opening",
    "ornament",
    "visible-joint"
  ],
  referenceMayDetermineWhenTextIsSilent: [
    "body-role",
    "interface",
    "access",
    "silhouette",
    "proportion",
    "opening",
    "ornament",
    "visible-joint"
  ],
  backgroundAndOverlayTextAreNotRequirements: true
});

export const REFERENCE_POLICY_INSTRUCTIONS = `
Interpret maker intent into the strict registered semantic schema only.

Authority boundary:
- Never emit project dimensions, coordinates, contours, paths, transforms, exact ratios, construction selections, capability verdicts, validation results, or fabrication claims.
- Exact CAD, joints, fit, kerf, validation, assembly, and export remain deterministic.

Semantic relevance boundary:
- requirements contains design commitments only: functions, interactions, and operating conditions the requested construction itself must realize.
- A mentioned or pictured entity is not automatically a requirement. Use objects, scaleEvidence, referenceBrief, or assumptions when an entity only supplies fit, scale, appearance, or other interpretation context.
- Do not promote a possible conventional use, operating state, background prop, or inferred hazard into a design commitment. If the maker actually requires that state or operation for the result's essential purpose, emit the applicable registered requirement.
- Use thermal-source only when operating with heat or combustion is itself a design commitment. It does not describe an object merely being contained, supported, pictured, or used as a scale cue.
- Preserve a safe supported interpretation in assumptions when it narrows a nonessential possible use. Never silently remove an actual design commitment.

Registered cut-through intent:
- Emit cutThrough only for the finite lattice-grid, radial-rosette, circle-field, or ring-aperture families, using qualitative purpose, density, symmetry, repetition, eligible face roles, and evidence IDs.
- Use fixedTopAccess only for an evidenced cover-targeted ring aperture whose purpose is access. Never infer coordinates, diameter, bridge, edge margin, kerf, or contour geometry.

Reference brief:
- Emit exactly one referenceBrief entry per supplied reference, in the supplied order, citing that reference evidence ID.
- Use only registered observation kinds and values. Do not write a free-text image description.
- Describe the primary subject, not background props or overlay/OCR text. Overlay text is not maker intent unless the maker brief independently states it.
- "as close as possible" means reproduce. Reproduce defining and dominant visible observations; inspire makes them preferences; context supplies context without making a reproduction requirement.
- Role constraints are maker constraints. For a reference declared as structure only, do not emit ornament, operation-character, motif, or non-access patterned cut-through treatment sourced only from that reference. When roles are absent, infer relevant semantic observations without inventing a maker-set role.

Conflict policy:
- Explicit maker text wins only for the exact attribute it directly states; for example dimensions, material, count, mechanism, access, silhouette, proportion, opening, ornament, joint intent, or visual treatment.
- A reference may determine unstated body roles, interfaces, access, silhouette, qualitative proportions, openings, ornament, and visible joint intent.
- Record every actual conflict with the registered attribute, text evidence IDs, observation IDs, and scoped resolution.

Capability honesty:
- Observing a feature does not mean SketchyCut supports it. Keep observations in the reference brief so deterministic reconciliation can realize registered lattice/geometric cut-throughs or disclose and reject unsupported shapes such as arched apertures and botanical tracing.
- Do not replace a defining observed opening or ornament with an unrelated motif and claim fidelity.
`.trim();

export function stablePrefixInstructions(basePrompt: string): string {
  return [
    basePrompt.trim(),
    `Prompt layout: ${CURRENT_PROMPT_LAYOUT_VERSION}`,
    REFERENCE_POLICY_INSTRUCTIONS,
    `Abstract capability catalog (semantic constraints only):\n${JSON.stringify(CAPABILITY_CATALOG_V1)}`
  ].join("\n\n");
}

export function instructionsForPromptLayout(
  basePrompt: string,
  layout: "stable-prefix-v2" | "request-local-control-v1",
): string {
  return layout === "stable-prefix-v2" ? stablePrefixInstructions(basePrompt) : basePrompt.trim();
}

export function requestLocalControlPayload<T>(payload: T): {
  promptLayout: "request-local-control-v1";
  referencePolicyInstructions: string;
  abstractCapabilityCatalog: typeof CAPABILITY_CATALOG_V1;
  request: T;
} {
  return {
    promptLayout: "request-local-control-v1",
    referencePolicyInstructions: REFERENCE_POLICY_INSTRUCTIONS,
    abstractCapabilityCatalog: CAPABILITY_CATALOG_V1,
    request: payload
  };
}
