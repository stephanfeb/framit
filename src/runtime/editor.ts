// Framit browser editor runtime (docs/04-editor-runtime.md). Vanilla TS, no framework.

import { applyOps, invertOps, type Op } from "../shared/patch-core.js";
import { Api } from "./api.js";
import { Comments } from "./comments.js";
import { cssEscape, h } from "./dom.js";
import { Inspector } from "./inspector.js";
import { frameOf, getPointer, isContainer, isDescendant, locate, newId, withFreshIds, type Meta, type Node, type ScreenDoc } from "./model.js";
import { Overlay } from "./overlay.js";
import { openPalette } from "./palette.js";
import { crossfade, frameInfoOf, injectPrototypeCss, pickFrame, prototypeClick } from "./prototype.js";
import { Viewport } from "./viewport.js";

export const FRAMIT_RUNTIME_VERSION = "0.1.0";

type RenderMode = "none" | "frame" | "canvas";
type Mode = "design" | "preview" | "comment";
interface HistoryEntry {
  ops: Op[];
  inverse: Op[];
  render: RenderMode;
  frame?: string;
}
interface Editing {
  span: HTMLElement;
  node: string;
  pointer: string;
  original: string;
  originalHtml: string;
}

export class Editor {
  doc!: ScreenDoc;
  meta!: Meta;
  revision: number;
  selection: string[] = [];
  hover: string | undefined;
  mode: Mode = "design";
  editing: Editing | undefined;
  dragging = false;
  paletteOpen = false;

  readonly api: Api;
  readonly viewport: Viewport;
  readonly overlay: Overlay;
  readonly inspector: Inspector;
  readonly comments: Comments;
  readonly canvas: HTMLElement;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private spaceDown = false;
  /** Preview-mode navigation: what each navigated frame slot showed before, newest last. */
  private navStack: Array<{ slot: string; html: string }> = [];

  constructor(boot: { id: string; revision: number }) {
    const clientId = `tab_${newId("c").slice(2)}`;
    this.api = new Api(boot.id, clientId);
    this.revision = boot.revision;
    this.canvas = document.getElementById("fx-canvas")!;
    this.viewport = new Viewport(document.getElementById("fx-viewport")!, this.canvas, `fx-view:${boot.id}`);
    this.overlay = new Overlay(this, document.getElementById("fx-overlay")!);
    this.inspector = new Inspector(this, document.getElementById("fx-inspector")!);
    this.comments = new Comments(this, document.getElementById("fx-pins")!, document.getElementById("fx-comments")!);
    this.viewport.onChange = () => {
      this.overlay.schedule();
      this.comments.schedule(false);
      document.getElementById("fx-zoom")!.textContent = `${Math.round(this.viewport.view.z * 100)}%`;
    };
    this.viewport.onChange();
    injectPrototypeCss();
  }

  async start() {
    [this.doc, this.meta] = await Promise.all([this.api.doc(), this.api.meta()]);
    this.revision = this.doc.revision;
    this.bindPointer();
    this.bindKeys();
    this.bindBar();
    this.comments.schedule();
    this.api.events((e) => this.onRemoteChange(e));
    (window as unknown as { framit: Editor }).framit = this;
    document.body.dataset.ready = "1";
  }

  // ---------- geometry ----------

  elOf(id: string): HTMLElement | undefined {
    const frame = this.canvas.querySelector<HTMLElement>(`.fx-frame[data-frame="${cssEscape(id)}"]`);
    return frame ?? this.canvas.querySelector<HTMLElement>(`[data-node="${cssEscape(id)}"]`) ?? undefined;
  }

  rectOf(id: string): DOMRect | undefined {
    const el = this.elOf(id);
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return r.width === 0 && r.height === 0 ? undefined : r;
  }

  // ---------- selection ----------

  select(ids: string[]) {
    this.selection = [...new Set(ids)].filter((id) => frameOf(this.doc, id) || locate(this.doc, id));
    this.canvas.querySelectorAll(".fx-frame-slot.is-selected").forEach((s) => s.classList.remove("is-selected"));
    for (const id of this.selection) this.canvas.querySelector(`.fx-frame-slot[data-slot="${cssEscape(id)}"]`)?.classList.add("is-selected");
    this.overlay.schedule();
    this.inspector.refresh(true);
  }

  /** The node ids from the frame root down to the clicked element. */
  private chainAt(el: Element): string[] {
    const chain: string[] = [];
    let cur = el.closest<HTMLElement>("[data-node]");
    while (cur && this.canvas.contains(cur)) {
      chain.unshift(cur.dataset.node!);
      cur = cur.parentElement?.closest<HTMLElement>("[data-node]") ?? null;
    }
    return chain;
  }

  /**
   * Figma-like selection depth: the first click picks a top-level block; clicking inside the
   * selection drills one level; clicking a sibling keeps the current depth; ⌘/Ctrl picks the leaf.
   */
  pick(el: Element, opts: { deep: boolean; drill: boolean }): string | undefined {
    const chain = this.chainAt(el);
    if (!chain.length) return undefined;
    if (opts.deep) return chain[chain.length - 1];
    const sel = this.selection.length === 1 ? this.selection[0]! : undefined;
    if (sel) {
      const i = chain.indexOf(sel);
      if (i >= 0) return opts.drill ? chain[Math.min(i + 1, chain.length - 1)] : sel;
      const parent = locate(this.doc, sel)?.parent?.id;
      const pi = parent ? chain.indexOf(parent) : -1;
      if (pi >= 0) return chain[pi + 1];
    }
    return chain[Math.min(1, chain.length - 1)];
  }

  // ---------- commits ----------

  status(text: string, error = false) {
    const el = document.getElementById("fx-status")!;
    el.textContent = text;
    el.classList.toggle("is-error", error);
  }

  toast(text: string, error = false) {
    const t = h("div", { class: `fx-toast${error ? " is-error" : ""}` }, text);
    document.getElementById("fx-toasts")!.append(t);
    setTimeout(() => t.remove(), error ? 5000 : 2600);
  }

  /**
   * Apply ops optimistically to the local document, record them for undo, and send them to
   * the server in order. `render` says how to refresh the DOM once the server has them.
   */
  commit(ops: Op[], opts: { render?: RenderMode; frame?: string; history?: boolean } = {}) {
    if (!ops.length) return;
    const render = opts.render ?? "frame";
    let inverse: Op[];
    try {
      inverse = invertOps(this.doc, ops);
      this.doc = applyOps(this.doc, ops);
    } catch (err) {
      this.toast((err as Error).message, true);
      return;
    }
    const frame = opts.frame ?? this.frameForOps(ops);
    if (opts.history !== false) {
      this.undoStack.push({ ops, inverse, render, frame });
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.syncHistoryButtons();
    this.send(ops, render, frame);
  }

  private send(ops: Op[], render: RenderMode, frame: string | undefined) {
    this.pending++;
    this.status("Saving…");
    this.queue = this.queue.then(async () => {
      const r = await this.api.patch(this.revision, ops);
      this.pending--;
      if (r.ok) {
        this.revision = r.revision;
        this.doc = r.doc;
        if (!this.pending) this.status(r.rebased ? "Saved (merged with newer changes)" : "Saved");
        await this.rerender(r.rebased ? "canvas" : render, frame);
      } else {
        this.status("Not saved", true);
        this.toast(`${r.error.message}${r.error.hint ? ` ${r.error.hint}` : ""}`, true);
        await this.reload();
      }
    });
  }

  private frameForOps(ops: Op[]): string | undefined {
    const frames = new Set<string>();
    for (const op of ops) {
      for (const id of [op.node, op.fromNode]) {
        if (!id) continue;
        if (frameOf(this.doc, id)) return undefined; // frame-level change: whole canvas
        const loc = locate(this.doc, id);
        if (!loc) return undefined;
        frames.add(loc.frame.id!);
      }
    }
    return frames.size === 1 ? [...frames][0] : undefined;
  }

  async rerender(mode: RenderMode, frame?: string) {
    if (mode === "none") return this.afterRender();
    if (mode === "frame" && frame) {
      const r = await this.api.frame(frame);
      const old = this.canvas.querySelector(`.fx-frame[data-frame="${cssEscape(frame)}"]`);
      if (r && old) {
        old.outerHTML = r.html;
        return this.afterRender();
      }
    }
    const c = await this.api.canvas();
    this.canvas.innerHTML = c.html;
    this.afterRender();
  }

  private afterRender() {
    this.select(this.selection);
    this.inspector.refresh();
    this.comments.schedule();
  }

  async reload() {
    this.navStack = [];
    this.doc = await this.api.doc();
    this.revision = this.doc.revision;
    await this.rerender("canvas");
  }

  private onRemoteChange(e: { kind: string; id: string; revision: number | null; source?: string }) {
    if (e.kind === "theme") return location.reload();
    if (e.kind !== "screen" || e.id !== this.doc.id || e.source === this.api.clientId) return;
    if (e.revision === null) return this.toast("This screen was deleted.", true);
    if (e.revision <= this.revision) return;
    // Remote edits invalidate local inverse ops that touched the same nodes; keep it simple.
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryButtons();
    this.queue = this.queue.then(async () => {
      await this.reload();
      this.toast(e.source === "mcp" ? "Updated by Claude" : "Updated from another tab");
    });
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(entry);
    this.applyHistory(entry.inverse, entry);
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(entry);
    this.applyHistory(entry.ops, entry);
  }

  private applyHistory(ops: Op[], entry: HistoryEntry) {
    try {
      this.doc = applyOps(this.doc, ops);
    } catch (err) {
      this.toast(`Can't undo: ${(err as Error).message}`, true);
      this.undoStack = [];
      this.redoStack = [];
      this.syncHistoryButtons();
      return;
    }
    this.syncHistoryButtons();
    this.send(ops, entry.render === "none" ? "frame" : entry.render, entry.frame);
  }

  private syncHistoryButtons() {
    (document.getElementById("fx-undo") as HTMLButtonElement).disabled = !this.undoStack.length;
    (document.getElementById("fx-redo") as HTMLButtonElement).disabled = !this.redoStack.length;
  }

  // ---------- edit operations ----------

  setProp(id: string, key: string, value: unknown) {
    const loc = locate(this.doc, id);
    if (!loc) return;
    const cur = loc.node.props?.[key];
    if (JSON.stringify(cur) === JSON.stringify(value)) return;
    if (value === undefined) {
      if (cur !== undefined) this.commit([{ op: "remove", node: id, path: `/props/${key}` }]);
    } else this.commit([{ op: cur === undefined ? "add" : "replace", node: id, path: `/props/${key}`, value }]);
  }

  deleteSelection() {
    const nodes = this.selection.filter((id) => locate(this.doc, id)?.parent);
    const frames = this.selection.filter((id) => frameOf(this.doc, id));
    if (frames.length && frames.length >= this.doc.frames.length) return this.toast("A screen needs at least one frame.", true);
    // Drop nodes inside other selected nodes; their ancestor's removal covers them.
    const top = nodes.filter((id) => !nodes.some((o) => o !== id && isDescendant(this.doc, o, id)) && !frames.some((f) => locate(this.doc, id)?.frame.id === f));
    const ops: Op[] = [...top.map((id) => ({ op: "remove" as const, node: id })), ...frames.map((id) => ({ op: "remove" as const, node: id }))];
    if (!ops.length) return;
    const parent = top.length === 1 ? locate(this.doc, top[0]!)?.parent?.id : undefined;
    this.commit(ops, { render: frames.length ? "canvas" : undefined });
    this.select(parent ? [parent] : []);
  }

  duplicateSelection() {
    const ops: Op[] = [];
    const fresh: string[] = [];
    for (const id of this.selection) {
      const frame = frameOf(this.doc, id);
      if (frame) {
        const copy = withFreshIds(frame);
        const r = this.elOf(id)?.getBoundingClientRect();
        const slot = this.canvas.querySelector<HTMLElement>(`.fx-frame-slot[data-slot="${cssEscape(id)}"]`);
        const x = Number(slot?.dataset.x ?? 0) + (r ? r.width / this.viewport.view.z : 400) + 80;
        copy.position = { x, y: Number(slot?.dataset.y ?? 0) };
        copy.name = frame.name ? `${frame.name} copy` : undefined;
        if (!copy.name) delete copy.name;
        ops.push(...this.pinFramesOps(), { op: "add", path: "/frames/-", value: copy });
        fresh.push(copy.id!);
        continue;
      }
      const loc = locate(this.doc, id);
      if (!loc?.parent?.id) continue;
      const copy = withFreshIds(loc.node);
      ops.push({ op: "add", node: loc.parent.id, path: `/children/${loc.index + 1}`, value: copy });
      fresh.push(copy.id!);
    }
    if (!ops.length) return;
    this.commit(ops, { render: this.selection.some((id) => frameOf(this.doc, id)) ? "canvas" : "frame" });
    this.select(fresh);
  }

  moveSelected(delta: number) {
    if (this.selection.length !== 1) return;
    const loc = locate(this.doc, this.selection[0]!);
    if (!loc?.parent?.id) return;
    const n = loc.parent.children?.length ?? 0;
    const to = loc.index + delta;
    if (to < 0 || to >= n) return;
    this.commit([{ op: "move", fromNode: loc.node.id!, node: loc.parent.id, path: `/children/${to}` }]);
  }

  /** Where an inserted component goes: inside a selected container (or frame root), else after the selected node. */
  insertTarget(): { parent: string; index: number; inside: boolean; label: string } | undefined {
    if (this.selection.length !== 1) return undefined;
    const id = this.selection[0]!;
    const frame = frameOf(this.doc, id);
    const node = frame ? frame.root : locate(this.doc, id)?.node;
    if (!node?.id) return undefined;
    if (isContainer(this.meta, node.type)) return { parent: node.id, index: node.children?.length ?? 0, inside: true, label: frame ? "frame" : node.type };
    const loc = locate(this.doc, id);
    if (!loc?.parent?.id) return undefined;
    return { parent: loc.parent.id, index: loc.index + 1, inside: false, label: loc.node.type };
  }

  insert(type: string) {
    const where = this.insertTarget();
    if (!where) return this.toast("Select a node or frame first.", true);
    const example = this.meta.components[type]?.example;
    if (!example) return;
    const value = withFreshIds(example as Node);
    this.commit([{ op: "add", node: where.parent, path: `/children/${where.index}`, value }]);
    this.select([value.id!]);
  }

  /** Frames placed automatically get explicit positions before any frame moves, so nothing jumps. */
  private pinFramesOps(): Op[] {
    const ops: Op[] = [];
    for (const f of this.doc.frames) {
      if (f.position || !f.id) continue;
      const slot = this.canvas.querySelector<HTMLElement>(`.fx-frame-slot[data-slot="${cssEscape(f.id)}"]`);
      if (slot) ops.push({ op: "add", node: f.id, path: "/position", value: { x: Number(slot.dataset.x), y: Number(slot.dataset.y) } });
    }
    return ops;
  }

  // ---------- text editing ----------

  startEdit(span: HTMLElement) {
    const nodeEl = span.closest<HTMLElement>("[data-node]");
    if (!nodeEl || this.editing) return;
    const node = nodeEl.dataset.node!;
    const pointer = span.dataset.prop!;
    const loc = locate(this.doc, node);
    if (!loc) return;
    const value = getPointer(loc.node.props ?? {}, pointer);
    const original = value === undefined || value === null ? span.textContent ?? "" : String(value);
    this.select([node]);
    this.editing = { span, node, pointer, original, originalHtml: span.innerHTML };
    span.textContent = original;
    span.setAttribute("contenteditable", "plaintext-only");
    span.classList.add("fx-ov-editing");
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
    span.addEventListener("blur", this.onEditBlur);
    span.addEventListener("keydown", this.onEditKey);
    this.overlay.schedule();
  }

  private onEditBlur = () => this.endEdit(true);

  private onEditKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      this.endEdit(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.endEdit(true);
    }
  };

  endEdit(save: boolean) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = undefined;
    ed.span.removeEventListener("blur", this.onEditBlur);
    ed.span.removeEventListener("keydown", this.onEditKey);
    ed.span.removeAttribute("contenteditable");
    ed.span.classList.remove("fx-ov-editing");
    getSelection()?.removeAllRanges();
    const next = (ed.span.innerText ?? "").replace(/\n$/, "");
    if (!save || next === ed.original) {
      ed.span.innerHTML = ed.originalHtml;
    } else {
      this.commit([{ op: "replace", node: ed.node, path: `/props${ed.pointer}`, value: next }]);
    }
    this.overlay.schedule();
  }

  // ---------- pointer ----------

  private bindPointer() {
    const vp = this.viewport.el;

    // In design mode the frames' own controls must not react (no focus, no select popups).
    for (const type of ["click", "dblclick", "mousedown", "auxclick", "contextmenu"] as const) {
      vp.addEventListener(
        type,
        (e) => {
          if (this.mode === "preview") return;
          if (this.editing && this.editing.span.contains(e.target as Element)) return;
          if (type !== "contextmenu") e.preventDefault();
          if (type === "dblclick" && this.mode === "design") this.onDoubleClick(e as MouseEvent);
          if (type === "click" && this.mode === "comment") this.comments.onCanvasClick(e as MouseEvent);
        },
        true,
      );
    }

    vp.addEventListener("pointermove", (e) => {
      if (this.mode === "preview" || this.dragging) return;
      const el = e.target as Element;
      const id = el.closest(".fx-frame-label") ? (el.closest<HTMLElement>(".fx-frame-label")!.dataset.frameLabel) : this.pick(el, { deep: this.mode === "comment" || e.metaKey || e.ctrlKey, drill: false });
      if (id !== this.hover) {
        this.hover = id;
        if (this.mode === "comment") this.comments.schedule(false);
        else this.overlay.schedule();
      }
    });
    vp.addEventListener("pointerleave", () => {
      this.hover = undefined;
      this.overlay.schedule();
    });

    vp.addEventListener("click", (e) => {
      if (this.mode === "preview") prototypeClick(e, (to, frame) => void this.previewNavigate(to, frame));
    });
    window.addEventListener("popstate", (e) => void this.previewBack((e.state as { fxNav?: number } | null)?.fxNav ?? 0));

    vp.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.overlay.el.addEventListener("pointerdown", (e) => {
      const handle = (e.target as HTMLElement).closest<HTMLElement>(".fx-ov-handle");
      if (handle) this.startResize(e, handle.dataset.for!, handle.dataset.h as "e" | "s" | "se");
    });
  }

  private onDoubleClick(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const span = el.closest<HTMLElement>("[data-prop]");
    if (span && this.canvas.contains(span)) return this.startEdit(span);
    const id = this.pick(el, { deep: false, drill: true });
    if (id) this.select([id]);
  }

  private onPointerDown(e: PointerEvent) {
    if (this.mode !== "design") return;
    const el = e.target as HTMLElement;
    if (this.editing) {
      if (this.editing.span.contains(el)) return;
      this.endEdit(true);
    }
    // Pan: space+drag or middle button.
    if (this.spaceDown || e.button === 1) return this.startPan(e);
    if (e.button !== 0) return;

    const label = el.closest<HTMLElement>(".fx-frame-label");
    if (label) return this.startFrameDrag(e, label.dataset.frameLabel!);

    if (!el.closest(".fx-frame")) return this.startMarquee(e);

    const already = this.selection.length === 1 && this.chainAt(el).includes(this.selection[0]!) ? this.selection[0]! : undefined;
    const target = this.pick(el, { deep: e.metaKey || e.ctrlKey, drill: false }) ?? el.closest<HTMLElement>(".fx-frame")?.dataset.frame;
    if (!target) return;
    if (e.shiftKey) {
      this.select(this.selection.includes(target) ? this.selection.filter((s) => s !== target) : [...this.selection, target]);
      return;
    }
    if (!already) this.select([target]);
    // Press on a selected node: drag to reorder, or click to drill deeper.
    const dragId = this.selection[0]!;
    this.trackDrag(e, {
      onMove: (ev, started) => started && locate(this.doc, dragId)?.parent && this.dragReorder(ev, dragId),
      onEnd: (ev, moved) => {
        if (moved) return this.dropReorder(dragId);
        if (already) {
          const deeper = this.pick(ev.target as Element, { deep: false, drill: true });
          if (deeper && deeper !== already) this.select([deeper]);
        }
      },
    });
  }

  private trackDrag(e: PointerEvent, h: { onMove: (e: PointerEvent, started: boolean) => unknown; onEnd: (e: PointerEvent, moved: boolean) => unknown }) {
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) {
        started = true;
        this.dragging = true;
      }
      h.onMove(ev, started);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.dragging = false;
      h.onEnd(ev, started);
      this.overlay.drop = undefined;
      this.overlay.marquee = undefined;
      this.overlay.schedule();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  private startPan(e: PointerEvent) {
    e.preventDefault();
    let lx = e.clientX;
    let ly = e.clientY;
    document.body.classList.add("fx-panning");
    this.trackDrag(e, {
      onMove: (ev) => {
        this.viewport.panBy(ev.clientX - lx, ev.clientY - ly);
        lx = ev.clientX;
        ly = ev.clientY;
      },
      onEnd: () => document.body.classList.remove("fx-panning"),
    });
  }

  private startMarquee(e: PointerEvent) {
    const sx = e.clientX;
    const sy = e.clientY;
    this.trackDrag(e, {
      onMove: (ev, started) => {
        if (!started) return;
        this.overlay.marquee = { x: Math.min(sx, ev.clientX), y: Math.min(sy, ev.clientY), w: Math.abs(ev.clientX - sx), h: Math.abs(ev.clientY - sy) };
        this.overlay.schedule();
      },
      onEnd: (_ev, moved) => {
        const m = this.overlay.marquee;
        if (!moved || !m) return this.select([]);
        const hits = this.doc.frames.filter((f) => {
          const r = f.id ? this.rectOf(f.id) : undefined;
          return r && r.right > m.x && r.left < m.x + m.w && r.bottom > m.y && r.top < m.y + m.h;
        });
        this.select(hits.map((f) => f.id!));
      },
    });
  }

  private startFrameDrag(e: PointerEvent, fid: string) {
    const slot = this.canvas.querySelector<HTMLElement>(`.fx-frame-slot[data-slot="${cssEscape(fid)}"]`);
    if (!slot) return;
    this.select([fid]);
    const x0 = Number(slot.dataset.x);
    const y0 = Number(slot.dataset.y);
    const z = this.viewport.view.z;
    let nx = x0;
    let ny = y0;
    this.trackDrag(e, {
      onMove: (ev, started) => {
        if (!started) return;
        nx = Math.round(x0 + (ev.clientX - e.clientX) / z);
        ny = Math.round(y0 + (ev.clientY - e.clientY) / z);
        slot.style.left = `${nx}px`;
        slot.style.top = `${ny}px`;
        this.overlay.schedule();
      },
      onEnd: (_ev, moved) => {
        if (!moved || (nx === x0 && ny === y0)) return;
        const frame = frameOf(this.doc, fid)!;
        const ops = this.pinFramesOps().filter((o) => o.node !== fid);
        ops.push({ op: frame.position ? "replace" : "add", node: fid, path: "/position", value: { x: nx, y: ny } });
        slot.dataset.x = String(nx);
        slot.dataset.y = String(ny);
        this.commit(ops, { render: "none" });
      },
    });
  }

  private startResize(e: PointerEvent, id: string, dir: "e" | "s" | "se") {
    e.preventDefault();
    e.stopPropagation();
    const el = this.elOf(id);
    if (!el) return;
    const frame = frameOf(this.doc, id);
    const z = this.viewport.view.z;
    const r = el.getBoundingClientRect();
    const w0 = r.width / z;
    const h0 = r.height / z;
    let w = w0;
    let hgt = h0;
    this.trackDrag(e, {
      onMove: (ev, started) => {
        if (!started) return;
        if (dir !== "s") w = Math.max(frame ? 240 : 24, Math.round(w0 + (ev.clientX - e.clientX) / z));
        if (dir !== "e") hgt = Math.max(frame ? 240 : 16, Math.round(h0 + (ev.clientY - e.clientY) / z));
        if (dir !== "s") el.style.width = `${w}px`;
        if (dir !== "e") el.style.minHeight = `${hgt}px`;
        this.overlay.schedule();
      },
      onEnd: (_ev, moved) => {
        if (!moved) return;
        if (frame) {
          const ops = this.pinFramesOps();
          ops.push({ op: "replace", node: id, path: "/device", value: { width: w, height: Math.max(240, hgt) } });
          return this.commit(ops, { render: "canvas" });
        }
        const loc = locate(this.doc, id)!;
        const style = loc.node.style ?? {};
        const ops: Op[] = [];
        if (dir !== "s") ops.push({ op: style.width === undefined ? "add" : "replace", node: id, path: "/style/width", value: w });
        if (dir !== "e") ops.push({ op: style.minHeight === undefined ? "add" : "replace", node: id, path: "/style/minHeight", value: hgt });
        this.commit(ops);
      },
    });
  }

  // ---------- reorder / reparent ----------

  private dropPlan: { parent: string; index: number } | undefined;

  private dragReorder(e: PointerEvent, dragId: string) {
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((n) => this.canvas.contains(n) && n.closest("[data-node]"));
    this.dropPlan = undefined;
    this.overlay.drop = undefined;
    if (!under) return this.overlay.schedule();
    // Nearest container under the pointer that is not the dragged node or inside it.
    const chain = this.chainAt(under);
    let parentId: string | undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      const loc = locate(this.doc, chain[i]!);
      if (!loc || chain[i] === dragId || isDescendant(this.doc, dragId, chain[i]!)) continue;
      if (isContainer(this.meta, loc.node.type)) {
        parentId = chain[i];
        break;
      }
    }
    if (!parentId) return this.overlay.schedule();
    const parent = locate(this.doc, parentId)!.node;
    const parentRect = this.rectOf(parentId)!;
    const kids = (parent.children ?? []).map((c) => ({ id: c.id!, r: c.id ? this.rectOf(c.id) : undefined })).filter((k): k is { id: string; r: DOMRect } => !!k.r && k.id !== dragId);
    // Axis from the container's own layout; fall back to sibling geometry for grids and slots.
    const cs = getComputedStyle(this.elOf(parentId)!);
    const vertical = cs.display.includes("flex")
      ? !cs.flexDirection.startsWith("row")
      : kids.length < 2 || Math.abs(kids[1]!.r.top - kids[0]!.r.top) >= Math.abs(kids[1]!.r.left - kids[0]!.r.left);
    let idx = kids.findIndex((k) => (vertical ? e.clientY < k.r.top + k.r.height / 2 : e.clientX < k.r.left + k.r.width / 2));
    if (idx < 0) idx = kids.length;
    const ref = kids[idx] ?? kids[idx - 1];
    const after = !kids[idx];
    let line: { x: number; y: number; w: number; h: number } | undefined;
    if (ref) {
      line = vertical
        ? { x: ref.r.left, y: (after ? ref.r.bottom : ref.r.top) - 1.5, w: ref.r.width, h: 3 }
        : { x: (after ? ref.r.right : ref.r.left) - 1.5, y: ref.r.top, w: 3, h: ref.r.height };
    }
    // Map the index among visible siblings (excluding the dragged node) to a model index.
    const all = (parent.children ?? []).map((c) => c.id);
    const modelIndex = idx < kids.length ? all.filter((x) => x !== dragId).indexOf(kids[idx]!.id) : all.filter((x) => x !== dragId).length;
    this.dropPlan = { parent: parentId, index: modelIndex };
    this.overlay.drop = { target: parentRect, line };
    this.overlay.schedule();
  }

  private dropReorder(dragId: string) {
    const plan = this.dropPlan;
    this.dropPlan = undefined;
    if (!plan) return;
    const loc = locate(this.doc, dragId);
    if (!loc?.parent) return;
    if (loc.parent.id === plan.parent && loc.index === plan.index) return;
    this.commit([{ op: "move", fromNode: dragId, node: plan.parent, path: `/children/${plan.index}` }], { render: loc.frame.id === locate(this.doc, plan.parent)?.frame.id ? "frame" : "canvas" });
  }

  // ---------- keyboard & bar ----------

  // ---------- preview navigation ----------

  /** Swap a frame for the target screen's frame of the same device, like the player does. */
  async previewNavigate(to: string, frameEl: HTMLElement) {
    const slot = frameEl.closest<HTMLElement>(".fx-frame-slot");
    if (!slot) return;
    let frames;
    try {
      frames = await this.api.screenFrames(to);
    } catch {
      return this.toast(`No screen “${to}”.`, true);
    }
    const target = pickFrame(frames.map((f) => ({ ...f, screen: to })), frameInfoOf(frameEl));
    if (!target) return;
    this.navStack.push({ slot: slot.dataset.slot!, html: frameEl.outerHTML });
    history.pushState({ fxNav: this.navStack.length }, "");
    await crossfade(slot, () => (frameEl.outerHTML = target.html));
  }

  /** Browser Back in preview: restore frames until the stack matches the history entry. */
  private async previewBack(depth: number) {
    // Take the entries off synchronously: a navigation during the fade must not be undone too.
    const undo = this.navStack.splice(depth).reverse();
    for (const prev of undo) {
      const slot = this.canvas.querySelector<HTMLElement>(`.fx-frame-slot[data-slot="${cssEscape(prev.slot)}"]`);
      const cur = slot?.querySelector<HTMLElement>(".fx-frame");
      if (slot && cur) await crossfade(slot, () => (cur.outerHTML = prev.html));
    }
  }

  /** Present mode: the player, starting at the selected frame (or the first). */
  present() {
    const sel = this.selection[0];
    const frame = sel ? (frameOf(this.doc, sel)?.id ?? locate(this.doc, sel)?.frame.id) : undefined;
    location.href = `/p/screen/${encodeURIComponent(this.doc.id)}${frame ? `?frame=${encodeURIComponent(frame)}` : ""}`;
  }

  setMode(mode: Mode) {
    if (this.editing) this.endEdit(true);
    if (mode === "design" && this.navStack.length) {
      this.navStack = [];
      void this.rerender("canvas");
    }
    this.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll<HTMLElement>("[data-mode-btn]").forEach((b) => b.classList.toggle("is-on", b.dataset.modeBtn === mode));
    if (mode !== "design") this.hover = undefined;
    if (mode !== "comment") this.comments.closeComposer();
    this.overlay.schedule();
    this.comments.schedule();
  }

  private bindBar() {
    document.querySelectorAll<HTMLElement>("[data-mode-btn]").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.modeBtn as Mode)));
    document.getElementById("fx-undo")!.addEventListener("click", () => this.undo());
    document.getElementById("fx-redo")!.addEventListener("click", () => this.redo());
    document.getElementById("fx-insert")!.addEventListener("click", () => openPalette(this));
    document.getElementById("fx-present")!.addEventListener("click", () => this.present());
    document.getElementById("fx-zoom")!.addEventListener("click", () => this.viewport.fit());
    document.getElementById("fx-panel-toggle")!.addEventListener("click", () => this.togglePanel());
  }

  private togglePanel() {
    document.body.classList.toggle("fx-panel-hidden");
    this.overlay.schedule();
  }

  private bindKeys() {
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        document.body.classList.remove("fx-space");
      }
    });
    window.addEventListener("keydown", (e) => {
      if (this.editing || this.paletteOpen) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (e.code === "Space" && this.mode === "design") {
        this.spaceDown = true;
        document.body.classList.add("fx-space");
        e.preventDefault();
        return;
      }
      if (mod && e.shiftKey && k.toLowerCase() === "p") return void (e.preventDefault(), this.present());
      if (mod && k.toLowerCase() === "z") return void (e.preventDefault(), e.shiftKey ? this.redo() : this.undo());
      if (mod && k.toLowerCase() === "y") return void (e.preventDefault(), this.redo());
      if (mod && k === "\\") return void (e.preventDefault(), this.togglePanel());
      if (e.shiftKey && (k === "!" || e.code === "Digit1")) return void (e.preventDefault(), this.viewport.fit());
      if (e.shiftKey && (k === ")" || e.code === "Digit0")) return void (e.preventDefault(), this.viewport.zoomAt(innerWidth / 2, innerHeight / 2, 1));
      if (mod && (k === "=" || k === "+")) return void (e.preventDefault(), this.viewport.zoomBy(1.25));
      if (mod && k === "-") return void (e.preventDefault(), this.viewport.zoomBy(0.8));
      if (!mod && k.toLowerCase() === "p") return this.setMode("preview");
      if (!mod && k.toLowerCase() === "v") return this.setMode("design");
      if (!mod && k.toLowerCase() === "c") return this.setMode("comment");
      if (this.mode === "comment" && k === "Escape") return void (this.comments.closeComposer() || this.setMode("design"));
      if (this.mode !== "design") return;
      if ((mod && k.toLowerCase() === "k") || k === "/") return void (e.preventDefault(), openPalette(this));
      if (mod && k.toLowerCase() === "d") return void (e.preventDefault(), this.duplicateSelection());
      if (k === "Backspace" || k === "Delete") return void (e.preventDefault(), this.deleteSelection());
      if (k === "Escape") {
        const loc = this.selection.length === 1 ? locate(this.doc, this.selection[0]!) : undefined;
        return this.select(loc?.parent?.id ? [loc.parent.id] : []);
      }
      if (k === "Enter" && this.selection.length === 1) {
        e.preventDefault();
        const el = this.elOf(this.selection[0]!);
        const span = el?.matches("[data-prop]") ? el : el?.querySelector<HTMLElement>("[data-prop]");
        const firstChild = locate(this.doc, this.selection[0]!)?.node.children?.[0]?.id;
        if (span && (!firstChild || e.shiftKey === false) && !frameOf(this.doc, this.selection[0]!) && !isContainer(this.meta, locate(this.doc, this.selection[0]!)!.node.type)) return this.startEdit(span);
        if (firstChild) return this.select([firstChild]);
        if (span) return this.startEdit(span);
        return;
      }
      if (e.altKey && (k === "ArrowUp" || k === "ArrowLeft")) return void (e.preventDefault(), this.moveSelected(-1));
      if (e.altKey && (k === "ArrowDown" || k === "ArrowRight")) return void (e.preventDefault(), this.moveSelected(1));
      if (k.startsWith("Arrow") && this.selection.length && this.selection.every((id) => frameOf(this.doc, id))) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0;
        const dy = k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0;
        const ops = this.pinFramesOps().filter((o) => !this.selection.includes(o.node!));
        for (const id of this.selection) {
          const slot = this.canvas.querySelector<HTMLElement>(`.fx-frame-slot[data-slot="${cssEscape(id)}"]`)!;
          const x = Number(slot.dataset.x) + dx;
          const y = Number(slot.dataset.y) + dy;
          Object.assign(slot.dataset, { x: String(x), y: String(y) });
          slot.style.left = `${x}px`;
          slot.style.top = `${y}px`;
          ops.push({ op: frameOf(this.doc, id)!.position ? "replace" : "add", node: id, path: "/position", value: { x, y } });
        }
        this.commit(ops, { render: "none" });
        return;
      }
      if (k === "Tab" && this.selection.length === 1) {
        const loc = locate(this.doc, this.selection[0]!);
        const sibs = loc?.parent?.children ?? [];
        if (sibs.length) {
          e.preventDefault();
          const next = sibs[(loc!.index + (e.shiftKey ? -1 : 1) + sibs.length) % sibs.length]!;
          if (next.id) this.select([next.id]);
        }
      }
    });
  }
}

const bootEl = document.getElementById("fx-boot");
if (bootEl) {
  const boot = JSON.parse(bootEl.textContent ?? "{}") as { id: string; revision: number };
  new Editor(boot).start().catch((err) => {
    console.error(err);
    document.getElementById("fx-status")!.textContent = `Editor failed to start: ${(err as Error).message}`;
  });
}
