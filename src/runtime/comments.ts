import { h } from "./dom.js";
import type { Editor } from "./editor.js";
import { frameOf, locate, newId } from "./model.js";

/*
 * Comment mode (docs/04-editor-runtime.md): click an element to pin a comment to it. Comments live
 * in the screen document under `comments`, each anchored to a node or frame id, so they follow the
 * element through layout changes and the model can read and resolve them. Pins are drawn in an
 * untransformed fixed layer from measured rects, like the selection overlay.
 */

export interface Reply {
  author: string;
  text: string;
  createdAt?: string;
}
export interface Comment {
  id: string;
  node: string;
  text: string;
  author: string;
  createdAt?: string;
  resolved?: boolean;
  replies?: Reply[];
}

const when = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
};

export class Comments {
  showResolved = false;
  active: string | undefined;
  private composer: { node: string; x: number; y: number } | undefined;
  /** Built once per opening and kept across redraws, so typing survives pointer moves and zooms. */
  private composerNode: HTMLElement | undefined;
  private raf = 0;

  constructor(
    private readonly ed: Editor,
    readonly layer: HTMLElement,
    readonly panel: HTMLElement,
  ) {}

  get all(): Comment[] {
    return (Array.isArray(this.ed.doc?.comments) ? this.ed.doc.comments : []) as Comment[];
  }

  get open(): Comment[] {
    return this.all.filter((c) => !c.resolved);
  }

  /** Redraw pins (cheap; on every viewport change) and, unless only moving, the side list. */
  schedule(listToo = true) {
    if (listToo) this.renderPanel();
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.drawPins();
    });
  }

  private label(id: string): string {
    const f = frameOf(this.ed.doc, id);
    if (f) return f.name ?? "Frame";
    const n = locate(this.ed.doc, id)?.node;
    if (!n) return "removed element";
    const p = n.props ?? {};
    const text = [p.label, p.title, p.content, p.name].find((v) => typeof v === "string") as string | undefined;
    return text ? `${n.type} “${text.length > 24 ? `${text.slice(0, 24)}…` : text}”` : n.type;
  }

  private drawPins() {
    const ed = this.ed;
    this.layer.replaceChildren();
    this.syncCount();
    if (ed.mode !== "comment") return;
    const parts: HTMLElement[] = [];
    if (ed.hover && !this.composer) {
      const r = ed.rectOf(ed.hover);
      if (r) parts.push(h("div", { class: "fx-ov-box fx-ov-hover", style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` }));
    }
    this.all.forEach((c, i) => {
      if (c.resolved && !this.showResolved) return;
      const r = ed.rectOf(c.node);
      if (!r) return;
      parts.push(
        h(
          "button",
          {
            class: `fx-pin${c.resolved ? " is-resolved" : ""}${this.active === c.id ? " is-active" : ""}`,
            style: `left:${r.right - 4}px;top:${r.top - 20}px`,
            title: c.text,
            "data-pin": c.id,
            onclick: (e: Event) => {
              e.stopPropagation();
              this.focus(c.id);
            },
          },
          String(i + 1),
        ),
      );
    });
    if (this.composer) parts.push((this.composerNode ??= this.composerEl()));
    this.layer.append(...parts);
    const input = this.composerNode?.querySelector("textarea");
    if (input && document.activeElement !== input && !input.dataset.focused) {
      input.dataset.focused = "1";
      input.focus();
    }
  }

  private composerEl(): HTMLElement {
    const c = this.composer!;
    const input = h("textarea", { class: "fx-cm-input", rows: 3, placeholder: `Comment on ${this.label(c.node)}…` });
    const submit = () => {
      const text = input.value.trim();
      if (text) this.add(c.node, text);
      else this.closeComposer();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.closeComposer();
      }
    });
    const left = Math.min(c.x + 8, innerWidth - 300);
    const top = Math.min(c.y + 8, innerHeight - 160);
    const el = h("div", { class: "fx-cm-composer", style: `left:${left}px;top:${top}px` }, input, h("div", { class: "fx-cm-row" }, h("button", { onclick: () => this.closeComposer() }, "Cancel"), h("button", { class: "is-primary", onclick: submit }, "Comment")));
    return el;
  }

  /** A click on the canvas in comment mode: open the composer on the element under the pointer. */
  onCanvasClick(e: MouseEvent) {
    const id = this.ed.pick(e.target as Element, { deep: true, drill: false });
    if (!id) return this.closeComposer();
    this.composer = { node: id, x: e.clientX, y: e.clientY };
    this.composerNode = undefined;
    this.active = undefined;
    this.drawPins();
  }

  closeComposer() {
    if (!this.composer) return false;
    this.composer = undefined;
    this.composerNode = undefined;
    this.schedule(false);
    return true;
  }

  add(node: string, text: string) {
    const comment: Comment = { id: newId("c"), node, text, author: "you", createdAt: new Date().toISOString() };
    const has = Array.isArray(this.ed.doc.comments);
    this.composer = undefined;
    this.composerNode = undefined;
    this.active = comment.id;
    this.ed.commit([has ? { op: "add", path: "/comments/-", value: comment } : { op: "add", path: "/comments", value: [comment] }], { render: "none" });
    this.schedule();
  }

  resolve(id: string, resolved: boolean) {
    const c = this.all.find((x) => x.id === id);
    if (!c) return;
    this.ed.commit([{ op: c.resolved === undefined ? "add" : "replace", node: id, path: "/resolved", value: resolved }], { render: "none" });
    this.schedule();
  }

  reply(id: string, text: string) {
    const c = this.all.find((x) => x.id === id);
    if (!c || !text.trim()) return;
    const r: Reply = { author: "you", text: text.trim(), createdAt: new Date().toISOString() };
    this.ed.commit([c.replies ? { op: "add", node: id, path: "/replies/-", value: r } : { op: "add", node: id, path: "/replies", value: [r] }], { render: "none" });
    this.schedule();
  }

  remove(id: string) {
    this.ed.commit([{ op: "remove", node: id }], { render: "none" });
    if (this.active === id) this.active = undefined;
    this.schedule();
  }

  focus(id: string) {
    this.active = id;
    this.composer = undefined;
    this.composerNode = undefined;
    this.schedule();
    this.panel.querySelector<HTMLElement>(`[data-comment="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private syncCount() {
    const n = this.open.length;
    const badge = document.querySelector<HTMLElement>("[data-mode-btn='comment'] .fx-cm-count");
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = n === 0;
    }
  }

  renderPanel() {
    const list = this.all.map((c, i) => ({ c, i })).filter(({ c }) => !c.resolved || this.showResolved);
    const resolvedCount = this.all.filter((c) => c.resolved).length;
    const items = list.map(({ c, i }) => {
      const replyInput = h("input", { class: "fx-cm-reply-input", placeholder: "Reply…" });
      replyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.reply(c.id, replyInput.value);
        }
      });
      return h(
        "li",
        { class: `fx-cm-item${c.resolved ? " is-resolved" : ""}${this.active === c.id ? " is-active" : ""}`, "data-comment": c.id, onclick: () => this.active !== c.id && this.focus(c.id) },
        h("div", { class: "fx-cm-head" }, h("span", { class: "fx-cm-num" }, String(i + 1)), h("span", { class: "fx-cm-on" }, this.label(c.node)), h("span", { class: "fx-cm-when" }, when(c.createdAt))),
        h("div", { class: "fx-cm-text" }, h("b", {}, c.author === "claude" ? "Claude" : c.author === "you" ? "You" : c.author), " ", c.text),
        ...(c.replies ?? []).map((r) => h("div", { class: "fx-cm-text fx-cm-reply" }, h("b", {}, r.author === "claude" ? "Claude" : r.author === "you" ? "You" : r.author), " ", r.text)),
        this.active === c.id ? replyInput : null,
        h(
          "div",
          { class: "fx-cm-actions" },
          h("button", { "data-act": "resolve", onclick: (e: Event) => (e.stopPropagation(), this.resolve(c.id, !c.resolved)) }, c.resolved ? "Reopen" : "Resolve"),
          h("button", { "data-act": "delete", onclick: (e: Event) => (e.stopPropagation(), this.remove(c.id)) }, "Delete"),
        ),
      );
    });
    const toggle = h("label", { class: "fx-cm-toggle" }, h("input", { type: "checkbox", checked: this.showResolved, onchange: (e: Event) => ((this.showResolved = (e.target as HTMLInputElement).checked), this.schedule()) }), ` Show resolved (${resolvedCount})`);
    this.panel.replaceChildren(
      h("div", { class: "fx-cm-title" }, h("b", {}, "Comments"), toggle),
      items.length ? h("ul", { class: "fx-cm-list" }, ...items) : h("div", { class: "fx-insp-empty" }, this.all.length ? "No open comments." : "Click any element on the canvas to leave a comment. Claude sees open comments and can resolve them."),
    );
  }
}
