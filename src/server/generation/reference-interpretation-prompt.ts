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
- Never emit project dimensions, coordinates, contours, paths, transforms, construction selections, capability verdicts, validation results, or fabrication claims.
- Exact CAD, joints, fit, kerf, validation, assembly, and export remain deterministic.

Reference brief:
- Emit exactly one referenceBrief entry per supplied reference, in the supplied order, citing that reference evidence ID.
- Use only registered observation kinds and values. Do not write a free-text image description.
- Describe the primary subject, not background props or overlay/OCR text. Overlay text is not maker intent unless the maker brief independently states it.
- "as close as possible" means reproduce. Reproduce defining and dominant visible observations; inspire makes them preferences; context supplies context without making a reproduction requirement.
- Role constraints are maker constraints. When absent, infer relevant semantic observations without inventing a maker-set role.

Conflict policy:
- Explicit maker text wins only for the exact attribute it directly states; for example dimensions, material, count, mechanism, access, silhouette, proportion, opening, ornament, joint intent, or visual treatment.
- A reference may determine unstated body roles, interfaces, access, silhouette, qualitative proportions, openings, ornament, and visible joint intent.
- Record every actual conflict with the registered attribute, text evidence IDs, observation IDs, and scoped resolution.

Capability honesty:
- Observing a feature does not mean SketchyCut supports it. Keep known-unsupported observations such as visible cut-through apertures in the reference brief so deterministic reconciliation can disclose or reject them.
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
  layout: "stable-prefix-v1" | "request-local-control-v1",
): string {
  return layout === "stable-prefix-v1" ? stablePrefixInstructions(basePrompt) : basePrompt.trim();
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
