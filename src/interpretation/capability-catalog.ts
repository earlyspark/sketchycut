import { z } from "zod";

import { hashCanonical } from "../domain/hash.js";

export const M5_CAPABILITY_CATALOG_VERSION = "1.0.0" as const;

export const RegisteredMotifPrimitiveSchema = z.enum([
  "parallel-line-field",
  "inset-score-frame",
  "corner-score-ticks",
  "filled-dot-repeat",
  "filled-diamond-focal"
]);

const CapabilityEntrySchema = z
  .object({
    capabilityId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    bodyClasses: z.array(z.enum(["planar", "shell", "rod"])),
    interfaceBehaviors: z.array(z.enum(["rigid", "revolute", "prismatic"])),
    operatorIds: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).min(1),
    permittedStock: z.array(z.enum(["sheet-part", "wooden-pin"])),
    preconditions: z.array(z.string().min(1).max(240)),
    exclusions: z.array(z.string().min(1).max(240))
  })
  .strict();

export const CapabilityCatalogV1Schema = z
  .object({
    catalogId: z.literal("sketchycut-semantic-capabilities"),
    version: z.literal(M5_CAPABILITY_CATALOG_VERSION),
    capabilities: z.array(CapabilityEntrySchema).min(1),
    motifPrimitiveFamilies: z.array(RegisteredMotifPrimitiveSchema).min(1)
  })
  .strict();

export const CAPABILITY_CATALOG_V1 = CapabilityCatalogV1Schema.parse({
  catalogId: "sketchycut-semantic-capabilities",
  version: M5_CAPABILITY_CATALOG_VERSION,
  capabilities: [
    {
      capabilityId: "rigid-orthogonal-sheet-assembly",
      bodyClasses: ["planar", "shell"],
      interfaceBehaviors: ["rigid"],
      operatorIds: [
        "orthogonal-panel-layout",
        "panel-tab-slot-mate",
        "edge-finger-mate"
      ],
      permittedStock: ["sheet-part"],
      preconditions: [
        "Connected planar or shell topology",
        "Rigid interfaces admit orthogonal sheet construction",
        "Every mandatory containment or assembly need is represented"
      ],
      exclusions: [
        "Curved or freeform structural profiles",
        "Added glue",
        "Unregistered moving interfaces"
      ]
    },
    {
      capabilityId: "single-axis-retained-revolute",
      bodyClasses: ["planar", "shell"],
      interfaceBehaviors: ["rigid", "revolute"],
      operatorIds: ["retained-pin-revolute"],
      permittedStock: ["sheet-part", "wooden-pin"],
      preconditions: [
        "Exactly one essential revolute interface",
        "Coaxial hinge semantics",
        "A retained permitted wooden pin realization"
      ],
      exclusions: ["Multiple moving panels", "Compound axes", "Unretained shafts"]
    },
    {
      capabilityId: "single-axis-captured-prismatic",
      bodyClasses: ["planar", "shell"],
      interfaceBehaviors: ["rigid", "prismatic"],
      operatorIds: ["captured-panel-slide"],
      permittedStock: ["sheet-part"],
      preconditions: [
        "Exactly one essential prismatic interface",
        "Motion lies along a supported panel width or depth axis",
        "Captured normal travel and an explicit removal state"
      ],
      exclusions: ["Vertical lift", "Multiple moving panels", "Compound travel"]
    },
    {
      capabilityId: "safe-procedural-surface-treatment",
      bodyClasses: ["planar"],
      interfaceBehaviors: [],
      operatorIds: ["procedural-surface-treatment"],
      permittedStock: ["sheet-part"],
      preconditions: [
        "Registered procedural primitive family",
        "Real part-local safe surface remains after keep-outs",
        "Score is centerline geometry and vector Engrave is a closed fillable region"
      ],
      exclusions: [
        "Reference tracing or vectorization",
        "Decorative cut-through",
        "Open or unfilled vector Engrave"
      ]
    }
  ],
  motifPrimitiveFamilies: [
    "parallel-line-field",
    "inset-score-frame",
    "corner-score-ticks",
    "filled-dot-repeat",
    "filled-diamond-focal"
  ]
});

export async function capabilityCatalogHash(): Promise<string> {
  return hashCanonical(CAPABILITY_CATALOG_V1);
}

export type CapabilityCatalogV1 = z.infer<typeof CapabilityCatalogV1Schema>;
export type RegisteredMotifPrimitive = z.infer<typeof RegisteredMotifPrimitiveSchema>;
