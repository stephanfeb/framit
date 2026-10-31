import { describe, expect, it } from "vitest";
import { lintScreen } from "../src/server/lint.js";

const screen = (children: unknown[]) => ({ id: "s", name: "S", frames: [{ id: "f", device: "phone", root: { id: "root", type: "stack", children } }] });
const rules = (issues: Array<{ rule: string }>) => issues.map((i) => i.rule);

describe("lintScreen", () => {
  it("flags raw colours but not tokens", () => {
    const issues = lintScreen(screen([{ id: "a", type: "text", props: { content: "x" }, style: { color: "#f00", background: "surface" } }]), { screens: new Set() });
    expect(issues).toEqual([expect.objectContaining({ rule: "raw-colour", frame: "f", node: "a", message: expect.stringContaining('"#f00"') })]);
  });

  it("flags fields without labels, except search inputs", () => {
    const issues = lintScreen(
      screen([
        { id: "a", type: "input", props: { placeholder: "Email" } },
        { id: "b", type: "input", props: { type: "search", placeholder: "Search" } },
        { id: "c", type: "select", props: { label: "Zone", options: ["UTC"] } },
        { id: "d", type: "textarea", props: {} },
      ]),
      { screens: new Set() },
    );
    expect(issues.map((i) => i.node)).toEqual(["a", "d"]);
    expect(issues[0]!.message).toContain('placeholder "Email"');
  });

  it("flags empty containers and hotspots to missing screens", () => {
    const issues = lintScreen(screen([{ id: "r", type: "row", children: [] }, { id: "b", type: "button", props: { label: "Next", to: "step-2" } }]), { screens: new Set(["s"]) });
    expect(rules(issues)).toEqual(["empty-container", "missing-screen"]);
    expect(lintScreen(screen([{ id: "b", type: "button", props: { label: "Next", to: "step-2" } }]), { screens: new Set(["s", "step-2"]) })).toEqual([]);
  });

  it("flags dead-end primary buttons only mid-flow and only when no flow edge starts there", () => {
    const doc = screen([{ id: "go", type: "button", props: { label: "Continue", variant: "primary" } }]);
    expect(lintScreen(doc, { screens: new Set() })).toEqual([]);
    expect(rules(lintScreen(doc, { screens: new Set(), flows: [{ id: "onb", last: false, linked: new Set() }] }))).toEqual(["dead-end"]);
    expect(lintScreen(doc, { screens: new Set(), flows: [{ id: "onb", last: true, linked: new Set() }] })).toEqual([]);
    expect(lintScreen(doc, { screens: new Set(), flows: [{ id: "onb", last: false, linked: new Set(["go"]) }] })).toEqual([]);
  });
});
