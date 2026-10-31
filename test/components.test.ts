import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../src/components/index.js";
import { renderScreenPage } from "../src/renderer/render.js";
import { screenHotspots } from "../src/schema/flow.js";
import { Screen } from "../src/schema/screen.js";
import { resolveTheme } from "../src/themes/resolve.js";
import { BUILTIN_THEMES } from "../src/themes/builtin.js";

const theme = await resolveTheme(BUILTIN_THEMES["wire-mid-light"] as never, async () => undefined);
const page = (children: unknown[], device = "desktop") => {
  const screen = Screen.parse({ id: "s", name: "S", frames: [{ id: "f", device, root: { type: "stack", children } }] });
  return renderScreenPage(screen, theme);
};

describe("component registry", () => {
  it("has ~40 components, each with an example that validates and renders cleanly", () => {
    expect(Object.keys(COMPONENTS).length).toBeGreaterThanOrEqual(40);
    for (const def of Object.values(COMPONENTS)) {
      const { width: _w, ...ex } = def.example;
      const nodes = [{ type: def.type, ...ex }, ...(def.variants ?? []).map((props) => ({ type: def.type, props, ...(ex.children ? { children: ex.children } : {}) }))];
      const r = page(nodes);
      expect(r.warnings, def.type).toEqual([]);
      expect(r.html.split("</head>")[1], def.type).not.toContain("fx-unknown");
    }
  });
});

describe("chart", () => {
  it("draws a deterministic sketch without data", () => {
    const a = page([{ id: "c1", type: "chart", props: { kind: "line" } }]).html;
    expect(a).toContain("fx-chart--sketch");
    expect(page([{ id: "c1", type: "chart", props: { kind: "line" } }]).html).toBe(a);
  });

  it("scales bars to a nice axis and splits donuts by value", () => {
    const bar = page([{ type: "chart", props: { kind: "bar", labels: ["a", "b"], series: [{ values: [40, 80] }] } }]).html;
    expect(bar).toContain(">80</span>"); // axis top is a nice number at or above the max
    expect(bar).toMatch(/top:0\.00%;height:100\.00%/); // the max bar reaches the top
    const donut = page([{ type: "chart", props: { kind: "donut", series: [{ values: [3, 1] }] } }]).html;
    expect(donut).toContain('stroke-dasharray="75.000 25.000"');
    expect(donut).toContain('stroke-dasharray="25.000 75.000"');
  });
});

describe("feedback and overlays", () => {
  it("makes action buttons editable hotspots", () => {
    const doc = { id: "s", name: "S", frames: [{ id: "f", device: "desktop", root: { id: "m", type: "modal", props: { title: "Sure?", actions: [{ label: "Cancel" }, { label: "Go", variant: "primary", to: "next" }] } } }] };
    const html = renderScreenPage(Screen.parse(doc), theme).html;
    expect(html).toContain('data-to="next"');
    expect(html).toContain('data-prop="/actions/1/label"');
    expect(screenHotspots(doc)).toEqual([expect.objectContaining({ node: "m", to: "next" })]);
  });

  it("puts overlays on the frame's first viewport", () => {
    const html = page([{ type: "toast", props: { title: "Saved" } }], "phone").html;
    expect(html).toContain("--fx-vh:844px");
    expect(html).toContain("fx-overlay--toast");
  });
});
