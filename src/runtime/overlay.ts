import { h } from "./dom.js";
import type { Editor } from "./editor.js";
import { frameOf, locate, type JsonSchema } from "./model.js";

/*
 * Selection, hover and drop indicators plus the floating toolbar. Everything lives in an
 * untransformed fixed layer positioned from getBoundingClientRect(), so it stays crisp at
 * any zoom (docs/04-editor-runtime.md).
 */

const TOOLBAR_PROPS = ["role", "variant", "size", "tone", "layout", "align", "justify", "orientation", "direction", "side"];

export interface DropIndicator {
  target: DOMRect;
  line?: { x: number; y: number; w: number; h: number };
}

export class Overlay {
  drop: DropIndicator | undefined;
  marquee: { x: number; y: number; w: number; h: number } | undefined;
  private raf = 0;

  constructor(
    private readonly ed: Editor,
    readonly el: HTMLElement,
  ) {
    window.addEventListener("resize", () => this.schedule());
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private box(r: DOMRect, cls: string) {
    return h("div", { class: `fx-ov-box ${cls}`, style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` });
  }

  draw() {
    const ed = this.ed;
    this.el.replaceChildren();
    if (ed.mode !== "design") return;
    const parts: HTMLElement[] = [];

    // Hover
    if (ed.hover && !ed.selection.includes(ed.hover) && !ed.dragging) {
      const r = ed.rectOf(ed.hover);
      if (r) {
        parts.push(this.box(r, "fx-ov-hover"));
        parts.push(h("div", { class: "fx-ov-tag", style: `left:${r.left}px;top:${r.top}px;opacity:.85` }, this.label(ed.hover)));
      }
    }

    // Parent of a single selected node, dashed, for context.
    if (ed.selection.length === 1) {
      const loc = locate(ed.doc, ed.selection[0]!);
      const pr = loc?.parent?.id ? ed.rectOf(loc.parent.id) : undefined;
      if (pr) parts.push(this.box(pr, "fx-ov-parent"));
    }

    // Selection
    for (const id of ed.selection) {
      const r = ed.rectOf(id);
      if (!r) continue;
      parts.push(this.box(r, "fx-ov-sel"));
      if (ed.selection.length === 1 && !ed.editing) {
        const tag = h("div", { class: "fx-ov-tag", style: `left:${r.left}px;top:${r.top}px` }, this.label(id));
        parts.push(tag);
        for (const [hname, x, y] of [["e", r.right, r.top + r.height / 2], ["s", r.left + r.width / 2, r.bottom], ["se", r.right, r.bottom]] as const) {
          const handle = h("div", { class: "fx-ov-handle", "data-h": hname, "data-for": id, style: `left:${x}px;top:${y}px` });
          parts.push(handle);
        }
      }
    }

    if (this.drop) {
      parts.push(this.box(this.drop.target, "fx-ov-drop-target"));
      const l = this.drop.line;
      if (l) parts.push(h("div", { class: "fx-ov-drop", style: `left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px` }));
    }
    if (this.marquee) {
      const m = this.marquee;
      parts.push(h("div", { class: "fx-ov-marquee", style: `left:${m.x}px;top:${m.y}px;width:${m.w}px;height:${m.h}px` }));
    }

    if (ed.selection.length && !ed.dragging && !ed.editing) {
      const tb = this.toolbar();
      if (tb) parts.push(tb);
    }
    this.el.append(...parts);
    if (this.toolbarEl) this.placeToolbar();
  }

  private label(id: string): string {
    const f = frameOf(this.ed.doc, id);
    if (f) return `Frame · ${f.name ?? (typeof f.device === "string" ? f.device : `${f.device.width}×${f.device.height}`)}`;
    const loc = locate(this.ed.doc, id);
    return loc ? loc.node.type : id;
  }

  // ---------- toolbar ----------

  private toolbarEl: HTMLElement | undefined;

  private toolbar(): HTMLElement | undefined {
    const ed = this.ed;
    const sel = ed.selection;
    const items: Array<HTMLElement | null> = [];
    const btn = (label: string, title: string, on: () => void, opts: { on?: boolean; cls?: string; style?: string } = {}) =>
      h("button", { title, class: [opts.on ? "is-on" : "", opts.cls ?? ""].join(" ").trim() || undefined, style: opts.style, onclick: (e: Event) => (e.stopPropagation(), on()), onpointerdown: (e: Event) => e.stopPropagation() }, label);
    const sep = () => h("span", { class: "fx-tb-sep" });

    if (sel.length > 1) {
      items.push(h("span", { class: "fx-tb-type" }, `${sel.length} selected`), sep(), btn("⧉", "Duplicate (⌘D)", () => ed.duplicateSelection()), btn("🗑", "Delete (⌫)", () => ed.deleteSelection(), { cls: "fx-tb-danger" }));
    } else {
      const id = sel[0]!;
      const frame = frameOf(ed.doc, id);
      if (frame) {
        const devices = ["desktop", "laptop", "tablet", "phone"];
        const current = typeof frame.device === "string" ? frame.device : "custom";
        const select = h("select", { title: "Device", onpointerdown: (e: Event) => e.stopPropagation(), onchange: (e: Event) => ed.commit([{ op: "replace", node: id, path: "/device", value: (e.target as HTMLSelectElement).value }], { render: "canvas" }) });
        for (const d of [...devices, ...(current === "custom" ? ["custom"] : [])]) select.append(h("option", { value: d, selected: d === current, disabled: d === "custom" }, d === "custom" ? `${(frame.device as { width: number }).width}×${(frame.device as { height: number }).height}` : d));
        items.push(h("span", { class: "fx-tb-type" }, "Frame"), select, sep(), btn("⧉", "Duplicate frame (⌘D)", () => ed.duplicateSelection()), ed.doc.frames.length > 1 ? btn("🗑", "Delete frame (⌫)", () => ed.deleteSelection(), { cls: "fx-tb-danger" }) : null);
      } else {
        const loc = locate(ed.doc, id);
        if (!loc) return undefined;
        const meta = ed.meta.components[loc.node.type];
        const props = (loc.node.props ?? {}) as Record<string, unknown>;
        items.push(h("span", { class: "fx-tb-type" }, loc.node.type));
        const schemaProps = meta?.props.properties ?? {};
        let shown = 0;
        for (const key of TOOLBAR_PROPS) {
          const s = schemaProps[key];
          const values = s ? enumValues(s) : undefined;
          if (!values || shown >= 3) continue;
          shown++;
          const cur = (props[key] ?? s!.default) as string | undefined;
          const select = h("select", {
            title: key,
            onpointerdown: (e: Event) => e.stopPropagation(),
            onchange: (e: Event) => ed.setProp(id, key, (e.target as HTMLSelectElement).value || undefined),
          });
          if (s!.default === undefined) select.append(h("option", { value: "" }, `${key}…`));
          for (const v of values) select.append(h("option", { value: v, selected: v === cur }, v));
          items.push(select);
        }
        if (loc.node.type === "text") {
          const weight = props.weight as string | undefined;
          items.push(
            sep(),
            btn("B", "Bold", () => ed.setProp(id, "weight", weight === "bold" ? undefined : "bold"), { on: weight === "bold" || weight === "semibold", style: "font-weight:700" }),
            btn("I", "Italic", () => ed.setProp(id, "italic", props.italic ? undefined : true), { on: !!props.italic, style: "font-style:italic" }),
            btn("U", "Underline", () => ed.setProp(id, "underline", props.underline ? undefined : true), { on: !!props.underline, style: "text-decoration:underline" }),
            btn("M", "Muted", () => ed.setProp(id, "muted", props.muted ? undefined : true), { on: !!props.muted }),
          );
        }
        if ("fullWidth" in schemaProps) items.push(sep(), btn("↔", "Full width", () => ed.setProp(id, "fullWidth", props.fullWidth ? undefined : true), { on: !!props.fullWidth }));
        items.push(
          sep(),
          loc.parent ? btn("↰", "Select parent (Esc)", () => ed.select([loc.parent!.id!])) : null,
          btn("⧉", "Duplicate (⌘D)", () => ed.duplicateSelection()),
          loc.parent ? btn("🗑", "Delete (⌫)", () => ed.deleteSelection(), { cls: "fx-tb-danger" }) : null,
        );
      }
    }
    this.toolbarEl = h("div", { class: "fx-toolbar", onpointerdown: (e: Event) => e.stopPropagation() }, ...items.filter((x): x is HTMLElement => !!x));
    return this.toolbarEl;
  }

  private placeToolbar() {
    const tb = this.toolbarEl;
    if (!tb || !tb.isConnected) return;
    const rects = this.ed.selection.map((id) => this.ed.rectOf(id)).filter((r): r is DOMRect => !!r);
    if (!rects.length) return void tb.remove();
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = Math.min(...rects.map((r) => r.left));
    const vp = this.ed.viewport.el.getBoundingClientRect();
    const th = tb.offsetHeight;
    let y = top - th - 30;
    if (y < vp.top + 6) y = Math.min(bottom + 10, vp.bottom - th - 6);
    const x = Math.min(Math.max(left, vp.left + 6), vp.right - tb.offsetWidth - 6);
    tb.style.left = `${x}px`;
    tb.style.top = `${y}px`;
  }
}

/** String enum values of a schema (direct enum, or the enum branch of a union). */
export function enumValues(s: JsonSchema): string[] | undefined {
  if (s.enum) return s.enum.filter((v): v is string => typeof v === "string");
  const branch = s.anyOf?.find((a) => a.enum);
  return s.anyOf && s.anyOf.length === 1 ? branch?.enum?.filter((v): v is string => typeof v === "string") : undefined;
}
