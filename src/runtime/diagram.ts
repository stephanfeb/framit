// Framit diagram editor runtime: select, drag to pin (with live re-routing), connect nodes,
// edit text in place, inspector, undo. Same shell and patch pipeline as the screen editor.

import { applyOps, invertOps, type Op } from "../shared/patch-core.js";
import { labelAnchor, pathData, routeOrthogonal, type Box } from "../shared/route.js";
import { cssEscape, h } from "./dom.js";
import { Viewport } from "./viewport.js";

type Sel = { kind: "node" | "edge" | "group"; id: string } | null;
interface DNode {
  id: string;
  label: string;
  kind: string;
  tech?: string;
  description?: string;
  group?: string;
  icon?: string;
  emphasis?: boolean;
  position?: { x: number; y: number };
}
interface DEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: string;
  bidirectional?: boolean;
}
interface DGroup {
  id: string;
  label: string;
  lane?: boolean;
}
interface DiagramDoc {
  id: string;
  name: string;
  revision: number;
  direction?: "LR" | "TB";
  nodes: DNode[];
  edges: DEdge[];
  groups: DGroup[];
  [k: string]: unknown;
}

const KINDS = ["service", "database", "queue", "cache", "storage", "external", "actor", "client", "function", "note"];

export class DiagramEditor {
  doc!: DiagramDoc;
  revision: number;
  selection: Sel = null;
  readonly clientId = `tab_${Math.random().toString(36).slice(2, 8)}`;
  readonly canvas = document.getElementById("fx-canvas")!;
  readonly overlay = document.getElementById("fx-overlay")!;
  readonly inspector = document.getElementById("fx-inspector")!;
  readonly viewport: Viewport;
  private undoStack: Array<{ ops: Op[]; inverse: Op[] }> = [];
  private redoStack: Array<{ ops: Op[]; inverse: Op[] }> = [];
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private spaceDown = false;
  private editing: { span: HTMLElement; target: string; path: string; original: string } | undefined;
  private busy = false;

  constructor(readonly boot: { id: string; revision: number }) {
    this.revision = boot.revision;
    this.viewport = new Viewport(document.getElementById("fx-viewport")!, this.canvas, `fx-view:d:${boot.id}`);
    this.viewport.onChange = () => {
      this.drawOverlay();
      document.getElementById("fx-zoom")!.textContent = `${Math.round(this.viewport.view.z * 100)}%`;
    };
    this.viewport.onChange();
  }

  async start() {
    this.doc = await this.fetchJson<DiagramDoc>(`/api/doc/diagram/${encodeURIComponent(this.boot.id)}`);
    this.revision = this.doc.revision;
    this.bindPointer();
    this.bindKeys();
    this.bindBar();
    this.renderInspector();
    const es = new EventSource("/api/events");
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as { kind: string; id: string; revision: number | null; source?: string };
        if (e.kind === "theme") return location.reload();
        if (e.kind !== "diagram" || e.id !== this.doc.id || e.source === this.clientId || e.revision === null || e.revision <= this.revision) return;
        this.undoStack = [];
        this.redoStack = [];
        this.queue = this.queue.then(async () => {
          await this.reload();
          this.toast(e.source === "mcp" ? "Updated by Claude" : "Updated from another tab");
        });
      } catch {
        /* ignore */
      }
    };
    (window as unknown as { framitDiagram: DiagramEditor }).framitDiagram = this;
    document.body.dataset.ready = "1";
  }

  // ---------- server ----------

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  get board(): HTMLElement {
    return this.canvas.querySelector<HTMLElement>(".fx-board")!;
  }
  get offset() {
    return { x: Number(this.board.dataset.ox), y: Number(this.board.dataset.oy) };
  }

  async rerender() {
    const r = await this.fetchJson<{ html: string; revision: number }>(`/api/render/diagram/${encodeURIComponent(this.doc.id)}`);
    this.canvas.innerHTML = r.html;
    if (this.selection && !this.exists(this.selection)) this.selection = null;
    this.applySelectionClasses();
    this.drawOverlay();
    this.renderInspector();
  }

  async reload() {
    this.doc = await this.fetchJson<DiagramDoc>(`/api/doc/diagram/${encodeURIComponent(this.doc.id)}`);
    this.revision = this.doc.revision;
    await this.rerender();
  }

  private status(text: string, error = false) {
    const el = document.getElementById("fx-status")!;
    el.textContent = text;
    el.classList.toggle("is-error", error);
  }

  toast(text: string, error = false) {
    const t = h("div", { class: `fx-toast${error ? " is-error" : ""}` }, text);
    document.getElementById("fx-toasts")!.append(t);
    setTimeout(() => t.remove(), error ? 5000 : 2600);
  }

  /** Apply ops locally, record them for undo and send them; the board re-renders from the server. */
  commit(ops: Op[], opts: { history?: boolean; then?: () => void } = {}) {
    if (!ops.length) return;
    let inverse: Op[];
    try {
      inverse = invertOps(this.doc, ops);
      this.doc = applyOps(this.doc, ops);
    } catch (err) {
      this.toast((err as Error).message, true);
      return;
    }
    if (opts.history !== false) {
      this.undoStack.push({ ops, inverse });
      this.redoStack = [];
    }
    this.syncHistory();
    this.pending++;
    this.status("Saving…");
    this.queue = this.queue.then(async () => {
      try {
        const res = await fetch(`/api/doc/diagram/${encodeURIComponent(this.doc.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", "x-framit-client": this.clientId },
          body: JSON.stringify({ baseRevision: this.revision, ops }),
        });
        const body = (await res.json().catch(() => ({}))) as { revision?: number; doc?: DiagramDoc; message?: string; hint?: string };
        if (!res.ok) {
          this.toast(`${body.message ?? res.statusText}${body.hint ? ` ${body.hint}` : ""}`, true);
          this.undoStack = this.undoStack.filter((u) => u.ops !== ops);
          await this.reload();
        } else {
          this.doc = body.doc!;
          this.revision = body.revision!;
          await this.rerender();
          opts.then?.();
        }
      } catch (err) {
        this.toast(`Server unreachable: ${(err as Error).message}`, true);
      } finally {
        this.pending--;
        this.status(this.pending ? "Saving…" : `Saved · rev ${this.revision}`);
        this.syncHistory();
      }
    });
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this.redoStack.push(e);
    this.commit(e.inverse, { history: false });
  }
  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.undoStack.push(e);
    this.commit(e.ops, { history: false });
  }
  private syncHistory() {
    (document.getElementById("fx-undo") as HTMLButtonElement).disabled = !this.undoStack.length;
    (document.getElementById("fx-redo") as HTMLButtonElement).disabled = !this.redoStack.length;
  }

  // ---------- model helpers ----------

  node = (id: string) => this.doc.nodes.find((n) => n.id === id);
  edge = (id: string) => this.doc.edges.find((e) => e.id === id);
  group = (id: string) => this.doc.groups.find((g) => g.id === id);
  private exists(s: NonNullable<Sel>) {
    return s.kind === "node" ? !!this.node(s.id) : s.kind === "edge" ? !!this.edge(s.id) : !!this.group(s.id);
  }
  nodeEl = (id: string) => this.board.querySelector<HTMLElement>(`[data-dnode="${cssEscape(id)}"]`);
  edgeEl = (id: string) => this.board.querySelector<SVGGElement>(`[data-dedge="${cssEscape(id)}"]`);

  /** Board-space box of a node element (left/top/width/height styles). */
  private boxOf(el: HTMLElement): Box {
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
  }

  /** Set a field: add, replace or remove depending on the current value. */
  setField(target: string, path: string, current: unknown, value: unknown) {
    if (value === current || (value === "" && current === undefined)) return;
    if (value === undefined || value === "") return current === undefined ? undefined : this.commit([{ op: "remove", node: target, path }]);
    this.commit([{ op: current === undefined ? "add" : "replace", node: target, path, value }]);
  }

  select(sel: Sel) {
    this.selection = sel;
    this.applySelectionClasses();
    this.drawOverlay();
    this.renderInspector();
  }

  private applySelectionClasses() {
    this.board?.querySelectorAll(".is-selected").forEach((e) => e.classList.remove("is-selected"));
    if (this.selection?.kind === "edge") this.edgeEl(this.selection.id)?.classList.add("is-selected");
  }

  // ---------- overlay ----------

  private drawOverlay() {
    const parts: HTMLElement[] = [];
    if (this.selection?.kind === "node") {
      const el = this.nodeEl(this.selection.id);
      if (el) {
        const r = el.getBoundingClientRect();
        parts.push(h("div", { class: "fx-ov-box", style: `left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border-radius:10px` }));
        const port = h("div", { class: "fx-ov-port", title: "Drag to another node to connect", "data-port": this.selection.id, style: `left:${r.right + 3}px;top:${r.top + r.height / 2}px` });
        parts.push(port);
      }
    } else if (this.selection?.kind === "group") {
      const el = this.board.querySelector<HTMLElement>(`[data-dgroup="${cssEscape(this.selection.id)}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        parts.push(h("div", { class: "fx-ov-box", style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` }));
      }
    }
    this.overlay.replaceChildren(...parts);
  }

  // ---------- pointer ----------

  private bindPointer() {
    const vp = this.viewport.el;
    vp.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    vp.addEventListener("dblclick", (e) => this.onDoubleClick(e));
    this.overlay.addEventListener("pointerdown", (e) => {
      const port = (e.target as HTMLElement).closest<HTMLElement>("[data-port]");
      if (port) this.startConnect(e, port.dataset.port!);
    });
    vp.addEventListener("pointermove", (e) => {
      if (this.busy) return;
      const g = (e.target as Element).closest?.("g[data-dedge]");
      this.board?.querySelectorAll("g.is-hover").forEach((x) => x !== g && x.classList.remove("is-hover"));
      g?.classList.add("is-hover");
    });
  }

  private onPointerDown(e: PointerEvent) {
    const el = e.target as HTMLElement;
    if (this.editing) {
      if (this.editing.span.contains(el)) return;
      this.endEdit(true);
    }
    if (this.spaceDown || e.button === 1) return this.startPan(e);
    if (e.button !== 0) return;
    const nodeEl = el.closest<HTMLElement>("[data-dnode]");
    if (nodeEl) {
      this.select({ kind: "node", id: nodeEl.dataset.dnode! });
      return this.startDrag(e, nodeEl);
    }
    const edge = el.closest<SVGGElement>("g[data-dedge]") ?? el.closest<HTMLElement>("[data-dedge-label]");
    if (edge) return this.select({ kind: "edge", id: (edge as HTMLElement).dataset.dedge ?? (edge as HTMLElement).dataset.dedgeLabel! });
    const group = el.closest<HTMLElement>("[data-dgroup]");
    if (group && el.closest(".fx-dg-group-label")) return this.select({ kind: "group", id: group.dataset.dgroup! });
    this.select(null);
    this.startPan(e);
  }

  private startPan(e: PointerEvent) {
    const start = { x: e.clientX, y: e.clientY, vx: this.viewport.view.x, vy: this.viewport.view.y };
    document.body.classList.add("fx-panning");
    const move = (m: PointerEvent) => {
      this.viewport.view.x = start.vx + m.clientX - start.x;
      this.viewport.view.y = start.vy + m.clientY - start.y;
      this.viewport.apply();
      this.viewport.onChange();
    };
    const up = () => {
      document.body.classList.remove("fx-panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag a node: it moves and its edges re-route live; dropping pins it there. */
  private startDrag(e: PointerEvent, el: HTMLElement) {
    const id = el.dataset.dnode!;
    const z = this.viewport.view.z;
    const box0 = this.boxOf(el);
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    const incident = this.doc.edges.filter((ed) => ed.from === id || ed.to === id);
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / z;
      const dy = (m.clientY - start.y) / z;
      if (!moved && Math.hypot(dx, dy) * z < 4) return;
      if (!moved) {
        moved = true;
        this.busy = true;
        el.classList.add("is-dragging");
      }
      el.style.left = `${Math.round(box0.x + dx)}px`;
      el.style.top = `${Math.round(box0.y + dy)}px`;
      this.rerouteLive(incident);
      this.drawOverlay();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.busy = false;
      el.classList.remove("is-dragging");
      if (!moved) return;
      const b = this.boxOf(el);
      const o = this.offset;
      const value = { x: Math.round(b.x - o.x), y: Math.round(b.y - o.y) };
      this.commit([{ op: this.node(id)?.position ? "replace" : "add", node: id, path: "/position", value }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Re-route the given edges from the nodes' current DOM boxes (while dragging). */
  private rerouteLive(edges: DEdge[]) {
    const boxes = new Map<string, Box>();
    this.board.querySelectorAll<HTMLElement>("[data-dnode]").forEach((n) => boxes.set(n.dataset.dnode!, this.boxOf(n)));
    const all = [...boxes.values()];
    for (const ed of edges) {
      const a = boxes.get(ed.from), b = boxes.get(ed.to);
      const g = this.edgeEl(ed.id);
      if (!a || !b || !g) continue;
      const pts = ed.from === ed.to ? [] : routeOrthogonal(a, b, all);
      const d = pathData(pts);
      g.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
      const label = this.board.querySelector<HTMLElement>(`[data-dedge-label="${cssEscape(ed.id)}"]`);
      if (label && pts.length) {
        const at = labelAnchor(pts);
        label.style.left = `${Math.round(at.x)}px`;
        label.style.top = `${Math.round(at.y)}px`;
      }
    }
  }

  /** Drag from a node's port to another node to add an edge. */
  private startConnect(e: PointerEvent, from: string) {
    e.preventDefault();
    e.stopPropagation();
    this.busy = true;
    const wire = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wire.setAttribute("class", "fx-ov-wire");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wire.append(path);
    document.body.append(wire);
    const target = h("div", { class: "fx-ov-target" });
    const sx = e.clientX, sy = e.clientY;
    let over: string | undefined;
    const move = (m: PointerEvent) => {
      path.setAttribute("d", `M${sx},${sy} L${m.clientX},${m.clientY}`);
      const hit = document.elementsFromPoint(m.clientX, m.clientY).map((x) => x.closest<HTMLElement>("[data-dnode]")).find(Boolean);
      over = hit && hit.dataset.dnode !== from ? hit.dataset.dnode : undefined;
      if (over && hit) {
        const r = hit.getBoundingClientRect();
        target.setAttribute("style", `left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`);
        if (!target.isConnected) this.overlay.append(target);
      } else target.remove();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      wire.remove();
      target.remove();
      this.busy = false;
      if (!over) return;
      const id = this.newId("e", this.doc.edges.map((x) => x.id));
      this.commit([{ op: "add", path: "/edges/-", value: { id, from, to: over } }], {
        then: () => {
          this.select({ kind: "edge", id });
          (this.inspector.querySelector<HTMLInputElement>('[data-field="label"]'))?.focus();
        },
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private newId(prefix: string, taken: string[]) {
    const all = new Set([...taken, ...this.doc.nodes.map((n) => n.id), ...this.doc.groups.map((g) => g.id), ...this.doc.edges.map((e) => e.id)]);
    let i = 1;
    let id = `${prefix}${i}`;
    while (all.has(id)) id = `${prefix}${++i}`;
    return id;
  }

  // ---------- text editing ----------

  private onDoubleClick(e: MouseEvent) {
    const span = (e.target as HTMLElement).closest<HTMLElement>("[data-prop]");
    if (!span) return;
    const owner = span.closest<HTMLElement>("[data-dnode], [data-dedge-label], [data-dgroup]");
    if (!owner) return;
    const target = owner.dataset.dnode ?? owner.dataset.dedgeLabel ?? owner.dataset.dgroup!;
    this.startEdit(span, target, span.dataset.prop!);
  }

  startEdit(span: HTMLElement, target: string, path: string) {
    this.editing = { span, target, path, original: span.textContent ?? "" };
    span.contentEditable = "plaintext-only";
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    span.addEventListener("keydown", (k) => {
      if (k.key === "Enter") {
        k.preventDefault();
        this.endEdit(true);
      } else if (k.key === "Escape") {
        k.preventDefault();
        this.endEdit(false);
      }
      k.stopPropagation();
    });
    span.addEventListener("blur", () => this.endEdit(true), { once: true });
  }

  endEdit(save: boolean) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = undefined;
    ed.span.removeAttribute("contenteditable");
    const next = (ed.span.textContent ?? "").trim();
    if (!save || next === ed.original || (!next && ed.path === "/label" && !this.edge(ed.target))) {
      ed.span.textContent = ed.original;
      return;
    }
    this.commit([next ? { op: "replace", node: ed.target, path: ed.path, value: next } : { op: "remove", node: ed.target, path: ed.path }]);
  }

  // ---------- commands ----------

  deleteSelection() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === "node") {
      // Remove the node's edges explicitly so undo restores them too.
      const ops: Op[] = this.doc.edges.filter((e) => e.from === s.id || e.to === s.id).map((e) => ({ op: "remove", node: e.id }));
      ops.push({ op: "remove", node: s.id });
      this.selection = null;
      this.commit(ops);
    } else if (s.kind === "edge") {
      this.selection = null;
      this.commit([{ op: "remove", node: s.id }]);
    } else {
      const g = s.id;
      const ops: Op[] = this.doc.nodes.filter((n) => n.group === g).map((n) => ({ op: "remove", node: n.id, path: "/group" }));
      ops.push({ op: "remove", node: g });
      this.selection = null;
      this.commit(ops);
    }
  }

  addNode() {
    const id = this.newId("node-", []);
    const group = this.selection?.kind === "node" ? this.node(this.selection.id)?.group : this.selection?.kind === "group" ? this.selection.id : undefined;
    this.commit([{ op: "add", path: "/nodes/-", value: { id, label: "New node", kind: "service", ...(group ? { group } : {}) } }], {
      then: () => {
        this.select({ kind: "node", id });
        const span = this.nodeEl(id)?.querySelector<HTMLElement>(".fx-dg-label");
        if (span) this.startEdit(span, id, "/label");
      },
    });
  }

  autoLayout() {
    const ops: Op[] = this.doc.nodes.filter((n) => n.position).map((n) => ({ op: "remove", node: n.id, path: "/position" }));
    if (!ops.length) return this.toast("Nothing is pinned; the layout is already automatic.");
    this.commit(ops);
  }

  // ---------- inspector ----------

  private row(label: string, input: HTMLElement) {
    return h("div", { class: "fx-field-row" }, h("label", {}, label), input);
  }
  private text(field: string, value: string | undefined, onChange: (v: string) => void) {
    const i = h("input", { type: "text", "data-field": field }) as HTMLInputElement;
    i.value = value ?? "";
    i.addEventListener("change", () => onChange(i.value.trim()));
    i.addEventListener("keydown", (k) => k.key === "Enter" && i.blur());
    return i;
  }
  private select_(field: string, options: string[], value: string | undefined, onChange: (v: string) => void, empty?: string) {
    const s = h("select", { "data-field": field }) as HTMLSelectElement;
    if (empty !== undefined) s.append(h("option", { value: "" }, empty));
    for (const o of options) s.append(h("option", { value: o, selected: o === value }, o));
    s.addEventListener("change", () => onChange(s.value));
    return s;
  }
  private check(field: string, value: boolean | undefined, onChange: (v: boolean) => void) {
    const c = h("input", { type: "checkbox", "data-field": field }) as HTMLInputElement;
    c.checked = !!value;
    c.addEventListener("change", () => onChange(c.checked));
    return c;
  }
  private head(type: string, id: string, summary: string) {
    return h("div", { class: "fx-insp-head" }, h("div", { class: "fx-insp-type" }, type, h("span", { class: "fx-insp-id" }, id)), h("div", { class: "fx-insp-summary" }, summary));
  }

  renderInspector() {
    const s = this.selection;
    const sec = (title: string, ...rows: HTMLElement[]) => h("div", { class: "fx-insp-section" }, h("h4", {}, title), ...rows);
    if (s?.kind === "node") {
      const n = this.node(s.id);
      if (!n) return;
      const pin = n.position
        ? h("div", { class: "fx-insp-actions" }, h("button", { type: "button", onclick: () => this.commit([{ op: "remove", node: n.id, path: "/position" }]) }, "Unpin (auto-place)"))
        : h("div", { class: "fx-insp-summary" }, "Placed automatically. Drag to pin.");
      this.inspector.replaceChildren(
        this.head("Node", n.id, `${this.doc.edges.filter((e) => e.from === n.id || e.to === n.id).length} connections`),
        sec(
          "Node",
          this.row("label", this.text("label", n.label, (v) => v && this.setField(n.id, "/label", n.label, v))),
          this.row("kind", this.select_("kind", KINDS, n.kind, (v) => this.setField(n.id, "/kind", n.kind, v))),
          this.row("tech", this.text("tech", n.tech, (v) => this.setField(n.id, "/tech", n.tech, v))),
          this.row("description", this.text("description", n.description, (v) => this.setField(n.id, "/description", n.description, v))),
          this.row("group", this.select_("group", this.doc.groups.map((g) => g.id), n.group, (v) => this.setField(n.id, "/group", n.group, v || undefined), "—")),
          this.row("icon", this.text("icon", n.icon, (v) => this.setField(n.id, "/icon", n.icon, v))),
          this.row("emphasis", this.check("emphasis", n.emphasis, (v) => this.setField(n.id, "/emphasis", n.emphasis, v || undefined))),
        ),
        sec("Position", pin),
        sec("", h("div", { class: "fx-insp-actions" }, h("button", { type: "button", onclick: () => this.deleteSelection() }, "Delete node"))),
      );
    } else if (s?.kind === "edge") {
      const e = this.edge(s.id);
      if (!e) return;
      this.inspector.replaceChildren(
        this.head("Arrow", e.id, `${this.node(e.from)?.label ?? e.from} → ${this.node(e.to)?.label ?? e.to}`),
        sec(
          "Arrow",
          this.row("label", this.text("label", e.label, (v) => this.setField(e.id, "/label", e.label, v))),
          this.row("style", this.select_("style", ["solid", "dashed", "dotted"], e.style ?? "solid", (v) => this.setField(e.id, "/style", e.style, v))),
          this.row("both ways", this.check("bidirectional", e.bidirectional, (v) => this.setField(e.id, "/bidirectional", e.bidirectional, v || undefined))),
        ),
        sec(
          "",
          h(
            "div",
            { class: "fx-insp-actions" },
            h("button", { type: "button", onclick: () => this.commit([{ op: "replace", node: e.id, path: "/from", value: e.to }, { op: "replace", node: e.id, path: "/to", value: e.from }]) }, "Reverse"),
            h("button", { type: "button", onclick: () => this.deleteSelection() }, "Delete arrow"),
          ),
        ),
      );
    } else if (s?.kind === "group") {
      const g = this.group(s.id);
      if (!g) return;
      this.inspector.replaceChildren(
        this.head(g.lane ? "Lane" : "Group", g.id, `${this.doc.nodes.filter((n) => n.group === g.id).length} nodes`),
        sec("Group", this.row("label", this.text("label", g.label, (v) => v && this.setField(g.id, "/label", g.label, v))), this.row("lane", this.check("lane", g.lane, (v) => this.setField(g.id, "/lane", g.lane, v || undefined)))),
        sec("", h("div", { class: "fx-insp-actions" }, h("button", { type: "button", onclick: () => this.deleteSelection() }, "Remove group (keep nodes)"))),
      );
    } else {
      const pinned = this.doc.nodes.filter((n) => n.position).length;
      this.inspector.replaceChildren(
        this.head("Diagram", this.doc.id, `${this.doc.nodes.length} nodes · ${this.doc.edges.length} arrows · ${pinned} pinned`),
        sec(
          "Diagram",
          this.row("name", this.text("name", this.doc.name, (v) => v && this.commit([{ op: "replace", path: "/name", value: v }]))),
          this.row("direction", this.select_("direction", ["LR", "TB"], this.doc.direction ?? "LR", (v) => this.commit([{ op: this.doc.direction ? "replace" : "add", path: "/direction", value: v }]))),
        ),
        h("div", { class: "fx-insp-empty" }, h("kbd", {}, "Drag"), " a node to move and pin it · ", h("kbd", {}, "Drag"), " the ● handle to another node to connect · ", h("kbd", {}, "Dbl-click"), " text to edit · ", h("kbd", {}, "⌫"), " delete · ", h("kbd", {}, "N"), " add node · ", h("kbd", {}, "⌘Z"), " undo"),
      );
    }
  }

  // ---------- keyboard & bar ----------

  private bindBar() {
    document.getElementById("fx-undo")!.addEventListener("click", () => this.undo());
    document.getElementById("fx-redo")!.addEventListener("click", () => this.redo());
    document.getElementById("fx-add")!.addEventListener("click", () => this.addNode());
    document.getElementById("fx-tidy")!.addEventListener("click", () => this.autoLayout());
    document.getElementById("fx-zoom")!.addEventListener("click", () => this.viewport.fit());
    document.getElementById("fx-panel-toggle")!.addEventListener("click", () => document.body.classList.toggle("fx-panel-hidden"));
  }

  private bindKeys() {
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        document.body.classList.remove("fx-space");
      }
    });
    window.addEventListener("keydown", (e) => {
      if (this.editing) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (e.code === "Space") {
        this.spaceDown = true;
        document.body.classList.add("fx-space");
        return e.preventDefault();
      }
      if (mod && k.toLowerCase() === "z") return void (e.preventDefault(), e.shiftKey ? this.redo() : this.undo());
      if (mod && k === "\\") return void (e.preventDefault(), document.body.classList.toggle("fx-panel-hidden"));
      if (e.shiftKey && (k === "!" || e.code === "Digit1")) return void (e.preventDefault(), this.viewport.fit());
      if (k === "Backspace" || k === "Delete") return void (e.preventDefault(), this.deleteSelection());
      if (k === "Escape") return this.select(null);
      if (!mod && k.toLowerCase() === "n") return void (e.preventDefault(), this.addNode());
      if (k === "Enter" && this.selection && this.selection.kind !== "edge") {
        e.preventDefault();
        const owner = this.selection.kind === "node" ? this.nodeEl(this.selection.id) : this.board.querySelector<HTMLElement>(`[data-dgroup="${cssEscape(this.selection.id)}"]`);
        const span = owner?.querySelector<HTMLElement>("[data-prop]");
        if (span) this.startEdit(span, this.selection.id, span.dataset.prop!);
      }
    });
  }
}

const bootEl = document.getElementById("fx-boot");
if (bootEl) {
  new DiagramEditor(JSON.parse(bootEl.textContent ?? "{}")).start().catch((err) => {
    console.error(err);
    document.getElementById("fx-status")!.textContent = `Editor failed to start: ${(err as Error).message}`;
  });
}
