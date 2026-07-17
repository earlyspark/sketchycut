import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StockFitControls } from "../../src/ui/components/stock-fit-controls.js";

function render(capabilityInputs: ReactNode) {
  return renderToStaticMarkup(createElement(StockFitControls, {
    stockPresetId: "stock-3mm-basswood-laser-plywood",
    mode: "starter",
    showModeChooser: false,
    stale: true,
    canApply: true,
    appliedSummary: createElement("p", null, "Last-applied shared setup"),
    invalidMessage: null,
    findings: [],
    measurementControls: null,
    capabilityInputs,
    optionalTools: createElement("p", null, "Optional cut-width fit test"),
    onStockChange: () => undefined,
    onModeChange: () => undefined,
    onApply: () => undefined,
    onDiscard: () => undefined
  }));
}

describe("named fabrication-setup component slots", () => {
  it("omits the capability wrapper entirely when the active construction needs none", () => {
    const html = render(null);
    expect(html).not.toMatch(/pin|hardware|dowel|skewer/i);
    expect(html).not.toContain("capability-input-slot");
    expect(html).not.toContain("Required construction inputs");
    expect(html).toContain("Optional cut-width fit test");
  });

  it("orders required capability input before status/actions and optional tools after actions", () => {
    const html = render(createElement(
      "fieldset",
      null,
      createElement("legend", null, "Retained wooden pin"),
    ));
    const pin = html.indexOf("Retained wooden pin");
    const status = html.indexOf("Changes are not applied");
    const apply = html.indexOf("Apply pending settings");
    const optional = html.indexOf("Optional cut-width fit test");
    expect(pin).toBeGreaterThan(-1);
    expect(pin).toBeLessThan(status);
    expect(status).toBeLessThan(apply);
    expect(apply).toBeLessThan(optional);
    expect(html).toContain("Pending settings are valid and ready to apply");
  });
});
