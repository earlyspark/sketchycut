import {
  CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION,
  SEMANTIC_ATOM_TEMPLATES
} from "../../interpretation/semantic-atom-registry.js";
import { CURRENT_PROMPT_LAYOUT_VERSION } from "../../interpretation/semantic-input-contracts.js";

export const SEMANTIC_EVIDENCE_POLICY_VERSION = "semantic-evidence-policy-v5" as const;

export const SEMANTIC_EVIDENCE_POLICY = Object.freeze({
  version: SEMANTIC_EVIDENCE_POLICY_VERSION,
  defaultCallCount: 1,
  openInventoryIsFabricationAuthority: false,
  exactBriefValuesRequireLiteralVerification: true,
  explicitAdvancedSizingPrecedence: "strongest",
  referenceOperatingConditionAuthority: false,
  backgroundAndOverlayContentAreNotMakerCommitments: true
});

export const SEMANTIC_INTERPRETATION_INSTRUCTIONS = `
Return one strict response containing only irreducible open semantic choices. Do not emit normalized IDs, normalized records, accounting, disclosures, or fabrication decisions.

Inventory:
- Record each distinct maker commitment, preference, or contextual fact once. Preserve unfamiliar meaning in the claim; never replace it with a familiar product label.
- Essential means omission defeats the request. Preference means omission is acceptable but must be disclosed. Context explains purpose, scale, comparison, scene content, or naming and is not a requirement.
- Keep familiar nouns contextual when the maker uses them only for scale, comparison, naming, payload description, storage purpose, storage destination, or scene exclusion. Keep an unfamiliar purpose contextual when the supported structural relationships fully express the requested build. A context-only item must use the context state, never unbound or uncertain.
- Cite only supplied evidence IDs and generic structure, surface, operation, or context aspects. Background objects, props, and overlay text remain context unless independently requested.
- Do not emit a separate aspects list. Deterministic code derives the unique aspect set from evidence bindings.
- Put typed relationships on the source item and identify the other item by its one-based ordinal. Do not emit relationship IDs, evidence arrays, precedence, or resolution; deterministic code derives them.
- Put measurement targets on their owning item. Identify a project envelope or generic contained/supported object role and cite the exact unchanged number-and-unit span. Never emit measurement IDs, owner IDs, object IDs, or a converted value.

Semantic resolution:
- Give every item exactly one structural state variant. Essential items and preferences choose bound, deferred, unbound, or uncertain. Context chooses the context variant, which has no separate importance field.
- Bound items carry one or more registered semantic atoms. Select meaning only; emit no projection object, normalized ID, capability ID, body ID, requirement ID, interface ID, or accounting array. Deterministic templates generate every normalized record and cross-reference.
- Every construction-affecting semantic relationship must receive registered typed authority. Preserving a relationship only in claim text is undercoverage; claim text never substitutes for a registered atom.
- Deferred is only for evidence excluded by an explicit maker-selected reference role; cite those excluded bindings once and emit no second evidence subset. Unbound carries only a stable reason. Uncertain carries a stable reason and the only uncertainty rationale. Do not emit another certainty flag or an empty bound atom array.
- Use the smallest complete set of atoms that expresses the requested relationships: one complete primary enclosure versus partial support, registered single-axis motion, qualitative proportion, structural aperture, and registered surface treatment.
- Every rigid primary enclosure uses exactly one primary-enclosure atom. It jointly contains enclosure, access, and space subchoices so none can be omitted, while each subchoice retains its own priority and evidence authority. Each subchoice selects one or more evidenceIds from the item's structure evidence bindings; do not repeat aspect or support because deterministic code derives them from the selected item bindings. Enclosure priority governs containment and rigidity, access priority governs access and closure, and space priority governs organization. Do not add standalone open-access or organization atoms for a primary enclosure; those atoms are support-only.
- Primary access is unspecified only when the evidence supplies no access commitment; deterministic code then uses the registered open-top default. Otherwise choose open-top, open-front, covered-top, or covered-front exactly as evidenced. Covered access does not imply a moving mechanism; choose a moving-cover atom only when the evidence supplies that interaction.
- Primary space is unspecified only when the evidence supplies no one-space or multiple-space commitment; deterministic code then uses one canonical space. Choose explicit-single-space for undivided, uninterrupted, one-space interiors. Choose count for an exact total from two through twelve, grid for exact rows and columns, or minimum-separated when multiple spaces are required without an exact count or arrangement. A grid uses positive registered rows and columns no greater than six and cannot be one by one. Never infer count or grid numbers. A payload, storage purpose, or destination alone does not require multiple spaces. When maintaining distinct groups or separated placement is part of the artifact's requested function, including when that function is expressed through its ordinary functional name, multiple spaces are required; choose minimum-separated unless an exact count or grid is supplied.
- A structural aperture independently describes a face opening. The primary-enclosure atom still carries the enclosure's access state; deterministic code derives whether an access-purpose aperture requires fixed-top covered access.
- Distinguish an object's payload or stated purpose from an operating condition. Containment or support may be essential, but bind an operation only when the evidence explicitly requires the build to perform, power, activate, or enable it.
- Fit criticality is not a semantic output. Put an exact maker measurement on its owning item only when the unchanged numeric span is supplied. Choose object-clearance only when the evidence explicitly requests close, ordinary-access, or easy-access clearance; do not infer clearance from verbs such as fit, hold, store, contain, or keep apart.
- A visible structural opening cut into an otherwise enclosing face requires a structural-aperture atom with access purpose. An open top, open side, or other access boundary is not such an aperture.
- When the brief supplies only a project-envelope measurement but still asks to make an object, preserve the measurement and use one primary-enclosure atom with unspecified access and space; do not invent a specialized purpose or mechanism.
- Do not make a supported build concept-only merely because its purpose or visual mood is unfamiliar. Bind the supported structure and keep unsupported nonessential appearance as a preference or intent-preserving simplification.

Authority:
- Free text preserves meaning and disclosure only. It is never fabrication authority. Registered atom enums are semantic requests, not fabrication decisions.
- Reference operation evidence is never authoritative. Every reference has a maker-selected role: Structure authorizes structure/context, Surface authorizes surface/context, and both authorize structure/surface/context.
- For an explicit reference-role selection, inventory selected structural proportions and structural openings that materially define support or access. Separately inventory salient excluded aspects so they remain disclosed, then mark them deferred with exact reference evidence. Never omit, bind, or project non-selected reference aspects.
- Never emit title/label decoration, omission or accounting prose, IDs, ownership arrays, unique-aspect bookkeeping, evidence propagation, precedence results, normalized projection records, capability bindings, export decisions, recovery metadata, or semantic patches. Deterministic code derives all of them without interpreting claim text.
- Never emit exact dimensions, converted measurements, construction selections, operators, coordinates, contours, SVG, transforms, toolpaths, kerf, fit, motion proof, validation, assembly, export, or machine claims. Deterministic code owns them.
`.trim();

export function stablePrefixInstructions(basePrompt: string): string {
  return [
    basePrompt.trim(),
    `Prompt layout: ${CURRENT_PROMPT_LAYOUT_VERSION}`,
    `Semantic evidence policy: ${SEMANTIC_EVIDENCE_POLICY_VERSION}`,
    SEMANTIC_INTERPRETATION_INSTRUCTIONS,
    `Registered semantic atom templates (${CURRENT_SEMANTIC_ATOM_TEMPLATE_VERSION}):\n${JSON.stringify(SEMANTIC_ATOM_TEMPLATES)}`
  ].join("\n\n");
}

export function instructionsForPromptLayout(basePrompt: string): string {
  return stablePrefixInstructions(basePrompt);
}
