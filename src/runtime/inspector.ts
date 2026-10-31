import { h } from "./dom.js";
import type { Editor } from "./editor.js";
import { frameOf, locate, type JsonSchema } from "./model.js";

/*
 * Right-hand inspector: a form generated from the selected component's JSON Schema
 * (docs/04-editor-runtime.md "Inspector panel"). Each field commits one replace/remove op
 * on change.
 */

const STYLE_FIELDS = ["width", "maxWidth", "minHeight", "padding", "margin", "gap", "background", "color", "textAlign"];

export class Inspector {
  private renderedFor = "";

  constructor(
    private readonly ed: Editor,
    readonly el: HTMLElement,
  ) {}

  /** Rebuild unless the user is typing in a field for the same selection. */
  refresh(force = false) {
    const key = `${this.ed.selection.join(",")}@${this.ed.revision}`;
    if (!force && this.el.contains(document.activeElement) && this.renderedFor.split("@")[0] === this.ed.selection.join(",")) return;
    if (!force && key === this.renderedFor) return;
    this.renderedFor = key;
    this.render();
  }

  private render() {
    const ed = this.ed;
    const sel = ed.selection;
    if (sel.length !== 1) {
      this.el.replaceChildren(
        h("div", { class: "fx-insp-empty" }, sel.length ? `${sel.length} items selected.` : ""),
      );
      if (!sel.length) this.el.firstElementChild!.innerHTML = `Select something to inspect it.<br><br><kbd>Click</kbd> select · <kbd>Click</kbd> again to go deeper · <kbd>Dbl-click</kbd> edit text · <kbd>Esc</kbd> parent · <kbd>/</kbd> insert · <kbd>⌘Z</kbd> undo · <kbd>Space</kbd>+drag pan · <kbd>⌘</kbd>+scroll zoom`;
      return;
    }
    const id = sel[0]!;
    const frame = frameOf(ed.doc, id);
    if (frame) return this.renderFrame(id);
    const loc = locate(ed.doc, id);
    if (!loc) return this.el.replaceChildren();
    const meta = ed.meta.components[loc.node.type];
    const props = (loc.node.props ?? {}) as Record<string, unknown>;

    const crumbs = h("div", { class: "fx-insp-crumbs" });
    loc.path.slice(0, -1).forEach((pid) => {
      const p = locate(ed.doc, pid);
      crumbs.append(h("a", { onclick: () => ed.select([pid]) }, p?.node.type ?? pid), " › ");
    });
    const head = h(
      "div",
      { class: "fx-insp-head" },
      crumbs,
      h("div", { class: "fx-insp-type" }, loc.node.type, h("span", { class: "fx-insp-id" }, id)),
      meta ? h("div", { class: "fx-insp-summary" }, meta.summary) : null,
    );

    const propsSection = h("div", { class: "fx-insp-section" }, h("h4", {}, "Props"));
    const schemaProps = meta?.props.properties ?? {};
    const required = new Set(meta?.props.required ?? []);
    for (const [key, schema] of Object.entries(schemaProps)) {
      propsSection.append(this.field(key, schema, props[key], required.has(key), (v) => ed.setProp(id, key, v)));
    }
    if (!Object.keys(schemaProps).length) propsSection.append(h("div", { class: "fx-insp-summary" }, "No props."));

    const style = (loc.node.style ?? {}) as Record<string, unknown>;
    const styleSection = h("div", { class: "fx-insp-section" }, h("h4", {}, "Style overrides"));
    for (const key of STYLE_FIELDS) {
      styleSection.append(
        this.field(key, { anyOf: [{ type: "string" }, { type: "number" }] }, style[key], false, (v) =>
          ed.commit([v === undefined ? (style[key] === undefined ? null : { op: "remove", node: id, path: `/style/${key}` }) : { op: style[key] === undefined ? "add" : "replace", node: id, path: `/style/${key}`, value: v }].filter((o): o is NonNullable<typeof o> => !!o) as never, { render: "frame" }),
        ),
      );
    }

    const notes = h("textarea", { rows: 3, placeholder: "Designer notes (not rendered)" }) as HTMLTextAreaElement;
    notes.style.fontFamily = "inherit";
    notes.value = loc.node.notes ?? "";
    notes.addEventListener("change", () => {
      const v = notes.value.trim();
      if (v === (loc.node.notes ?? "")) return;
      ed.commit([v ? { op: loc.node.notes === undefined ? "add" : "replace", node: id, path: "/notes", value: v } : { op: "remove", node: id, path: "/notes" }], { render: "none" });
    });
    const notesSection = h("div", { class: "fx-insp-section" }, h("h4", {}, "Notes"), h("div", { class: "fx-field-row is-wide" }, notes));

    const actions = h(
      "div",
      { class: "fx-insp-section" },
      h("h4", {}, "Arrange"),
      h(
        "div",
        { class: "fx-insp-actions" },
        h("button", { onclick: () => ed.moveSelected(-1) }, "Move up"),
        h("button", { onclick: () => ed.moveSelected(1) }, "Move down"),
        h("button", { onclick: () => ed.duplicateSelection() }, "Duplicate"),
        h("button", { onclick: () => ed.deleteSelection() }, "Delete"),
      ),
    );
    this.el.replaceChildren(head, propsSection, styleSection, notesSection, actions);
  }

  private renderFrame(id: string) {
    const ed = this.ed;
    const f = frameOf(ed.doc, id)!;
    const custom = typeof f.device === "object" ? f.device : undefined;
    const set = (path: string, cur: unknown, v: unknown) =>
      ed.commit([v === undefined ? { op: "remove", node: id, path } : { op: cur === undefined ? "add" : "replace", node: id, path, value: v }], { render: "canvas" });
    const section = h(
      "div",
      { class: "fx-insp-section" },
      h("h4", {}, "Frame"),
      this.field("name", { type: "string" }, f.name, false, (v) => set("/name", f.name, v)),
      this.field("device", { enum: ["desktop", "laptop", "tablet", "phone"] }, custom ? undefined : f.device, true, (v) => v && set("/device", f.device, v)),
      this.field("width", { type: "number" }, custom?.width, false, (v) => typeof v === "number" && set("/device", f.device, { width: v, height: custom?.height ?? ed.rectOf(id)!.height / ed.viewport.view.z })),
      this.field("height", { type: "number" }, custom?.height, false, (v) => typeof v === "number" && set("/device", f.device, { width: custom?.width ?? ed.rectOf(id)!.width / ed.viewport.view.z, height: v })),
      this.field("background", { type: "string" }, f.background, false, (v) => set("/background", f.background, v)),
    );
    this.el.replaceChildren(
      h("div", { class: "fx-insp-head" }, h("div", { class: "fx-insp-type" }, "Frame", h("span", { class: "fx-insp-id" }, id)), h("div", { class: "fx-insp-summary" }, "Drag the label to move. Drag the edge handles to resize.")),
      section,
    );
  }

  private field(key: string, schema: JsonSchema, value: unknown, required: boolean, onChange: (v: unknown) => void): HTMLElement {
    const row = h("div", { class: "fx-field-row" }, h("label", { title: schema.description ?? key }, key));
    const kind = fieldKind(schema);
    const placeholder = schema.default !== undefined ? String(JSON.stringify(schema.default)).replace(/^"|"$/g, "") : "";

    if (kind === "enum") {
      const sel = h("select", {}) as HTMLSelectElement;
      if (!required || value === undefined) sel.append(h("option", { value: "" }, schema.default !== undefined ? `default (${placeholder})` : "—"));
      for (const v of enumOf(schema)!) sel.append(h("option", { value: v, selected: v === value }, v));
      sel.addEventListener("change", () => onChange(sel.value === "" ? undefined : sel.value));
      row.append(sel);
    } else if (kind === "boolean") {
      const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
      cb.checked = value === undefined ? schema.default === true : !!value;
      cb.addEventListener("change", () => onChange(cb.checked === (schema.default === true) && !required ? undefined : cb.checked));
      row.append(cb);
    } else if (kind === "json") {
      row.classList.add("is-wide");
      const ta = h("textarea", { rows: 4, placeholder: placeholder || "JSON" }) as HTMLTextAreaElement;
      ta.value = value === undefined ? "" : JSON.stringify(value, null, 1);
      ta.addEventListener("input", () => {
        try {
          if (ta.value.trim()) JSON.parse(ta.value);
          ta.classList.remove("is-invalid");
        } catch {
          ta.classList.add("is-invalid");
        }
      });
      ta.addEventListener("change", () => {
        if (!ta.value.trim()) return onChange(undefined);
        try {
          onChange(JSON.parse(ta.value));
        } catch {
          this.ed.toast(`${key}: invalid JSON`, true);
        }
      });
      row.firstElementChild!.textContent = `${key}${required ? "" : ""}`;
      row.append(ta);
    } else {
      const input = h("input", { type: kind === "number" ? "number" : "text", placeholder }) as HTMLInputElement;
      input.value = value === undefined || value === null ? "" : String(value);
      const tokens = tokenList(schema);
      if (tokens) {
        const listId = `fx-dl-${key}`;
        input.setAttribute("list", listId);
        row.append(h("datalist", { id: listId }, ...tokens.map((t) => h("option", { value: t }))));
      }
      input.addEventListener("change", () => {
        const raw = input.value;
        if (raw === "") return onChange(required ? "" : undefined);
        const numeric = /^-?\d+(\.\d+)?$/.test(raw);
        if (kind === "number") return onChange(Number(raw));
        if (numeric && acceptsNumber(schema) && !acceptsString(schema, raw)) return onChange(Number(raw));
        if (numeric && acceptsNumber(schema) && tokens) return onChange(Number(raw));
        onChange(raw);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
      });
      row.append(input);
    }
    return row;
  }
}

function enumOf(s: JsonSchema): string[] | undefined {
  if (s.enum) return s.enum.map(String);
  return undefined;
}

function fieldKind(s: JsonSchema): "enum" | "boolean" | "number" | "text" | "json" {
  if (s.enum) return "enum";
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "boolean") return "boolean";
  if (t === "number" || t === "integer") return "number";
  if (t === "string") return "text";
  if (t === "array" || t === "object") return "json";
  if (s.anyOf) {
    const kinds = s.anyOf.map(fieldKind);
    if (kinds.some((k) => k === "json")) return "json";
    return "text";
  }
  return "text";
}

function tokenList(s: JsonSchema): string[] | undefined {
  const e = s.anyOf?.find((a) => a.enum)?.enum;
  return e ? e.map(String) : undefined;
}
const acceptsNumber = (s: JsonSchema): boolean => ["number", "integer"].includes(String(s.type)) || !!s.anyOf?.some(acceptsNumber);
const acceptsString = (s: JsonSchema, v: string): boolean => (s.type === "string" && !s.enum) || (s.enum?.includes(v) ?? false) || !!s.anyOf?.some((a) => acceptsString(a, v));
