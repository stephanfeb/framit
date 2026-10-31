import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FramitError } from "../src/errors.js";
import { Screen, validate } from "../src/schema/screen.js";

const screen = (root: unknown) => ({ id: "s", name: "S", frames: [{ device: "desktop", root }] });

function issue(input: unknown) {
  try {
    validate(Screen, input, "screen");
  } catch (e) {
    expect(e).toBeInstanceOf(FramitError);
    return e as FramitError;
  }
  throw new Error("expected validation to fail");
}

describe("screen schema", () => {
  it("accepts a nested layout", () => {
    const doc = validate(
      Screen,
      screen({
        type: "app-shell",
        children: [
          { type: "sidebar", props: { brand: "Acme" }, children: [{ type: "nav", props: { items: [{ label: "Home", active: true }] } }] },
          { type: "row", props: { justify: "between" }, children: [{ type: "text", props: { role: "h1", content: "Hi" } }, { type: "button", props: { label: "Go", variant: "primary" } }] },
        ],
      }),
      "screen",
    );
    expect(doc.frames[0]!.device).toBe("desktop");
  });

  it("rejects positioning in style with the ADR-002 hint", () => {
    const e = issue(screen({ type: "text", props: { content: "x" }, style: { position: "absolute", top: 10 } }));
    expect(e.message).toContain("position");
    expect(e.hint).toContain("flow layout");
  });

  it("suggests the closest component type", () => {
    const e = issue(screen({ type: "buton", props: { label: "x" } }));
    expect(e.message).toContain('unknown component type "buton"');
    expect(e.hint).toMatch(/Closest: button/);
  });

  it("lists valid props for an unknown prop", () => {
    const e = issue(screen({ type: "button", props: { text: "Go" } }));
    expect(e.message).toContain("unknown button props: text");
    expect(e.hint).toContain("label");
  });

  it("explains that leaf components cannot have children", () => {
    const e = issue(screen({ type: "stack", children: [{ type: "button", props: { label: "a" }, children: [] }] }));
    expect(e.message).toContain("button cannot have children");
  });

  it("points at props when settings are put on the node itself", () => {
    const e = issue(screen({ type: "text", content: "Hello" }));
    expect(e.hint).toContain('"props"');
  });

  it("exports JSON Schema with a recursive Node definition", () => {
    const js = z.toJSONSchema(Screen, { io: "input", unrepresentable: "any" }) as any;
    expect(js.$defs?.Node).toBeDefined();
    expect(JSON.stringify(js)).toContain('"app-shell"');
  });
});
