import { describe, expect, it } from "vitest";
import { applyPatch, pointerOf } from "../src/store/patch.js";

const doc = () => ({
  id: "s",
  frames: [
    {
      id: "f_a",
      root: {
        id: "n_root",
        type: "stack",
        children: [
          { id: "n_title", type: "text", props: { content: "Hello" } },
          { id: "n_row", type: "row", children: [{ id: "n_btn", type: "button", props: { label: "Go" } }] },
          { id: "n_bare", type: "divider" },
        ],
      },
    },
  ],
});

describe("node-addressed JSON Patch", () => {
  it("finds node and frame pointers", () => {
    expect(pointerOf(doc(), "n_btn")).toBe("/frames/0/root/children/1/children/0");
    expect(pointerOf(doc(), "f_a")).toBe("/frames/0");
    expect(pointerOf(doc(), "nope")).toBeUndefined();
  });

  it("replaces a prop relative to a node", () => {
    const out = applyPatch(doc(), [{ op: "replace", node: "n_btn", path: "/props/label", value: "Send" }]);
    expect(out.frames[0]!.root.children[1]!.children![0]!.props!.label).toBe("Send");
  });

  it("creates props when adding to a node without them", () => {
    const out = applyPatch(doc(), [{ op: "add", node: "n_bare", path: "/props/label", value: "or" }]);
    expect((out.frames[0]!.root.children[2] as any).props).toEqual({ label: "or" });
  });

  it("removes a whole node and appends children", () => {
    const out = applyPatch(doc(), [
      { op: "remove", node: "n_title" },
      { op: "add", node: "n_row", path: "/children/-", value: { type: "button", props: { label: "B" } } },
    ]);
    expect(out.frames[0]!.root.children.map((c) => c.id)).toEqual(["n_row", "n_bare"]);
    expect(out.frames[0]!.root.children[0]!.children).toHaveLength(2);
  });

  it("moves a node into another container by id", () => {
    const out = applyPatch(doc(), [{ op: "move", fromNode: "n_btn", node: "n_root", path: "/children/0" }]);
    expect(out.frames[0]!.root.children.map((c) => c.id)).toEqual(["n_btn", "n_title", "n_row", "n_bare"]);
    expect(out.frames[0]!.root.children[2]!.children).toEqual([]);
  });

  it("refuses to move a node into itself", () => {
    expect(() => applyPatch(doc(), [{ op: "move", fromNode: "n_row", node: "n_btn", path: "/props/x" }])).toThrow(/into itself/);
  });

  it("is all-or-nothing and does not mutate the input", () => {
    const input = doc();
    expect(() =>
      applyPatch(input, [
        { op: "replace", node: "n_btn", path: "/props/label", value: "X" },
        { op: "remove", node: "missing" },
      ]),
    ).toThrow(/no node or frame/);
    expect(input.frames[0]!.root.children[1]!.children![0]!.props!.label).toBe("Go");
  });

  it("supports test ops", () => {
    expect(() => applyPatch(doc(), [{ op: "test", node: "n_title", path: "/props/content", value: "Nope" }])).toThrow(/test failed/);
  });
});
