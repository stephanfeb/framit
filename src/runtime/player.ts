// Framit player runtime: present mode, exported HTML prototypes and the flow canvas.
// Self-contained: works from file:// with no server (frames come from <template>s).

import { cssEscape, h } from "./dom.js";
import { crossfade, injectPrototypeCss, pickFrame, prototypeClick, type FrameInfo } from "./prototype.js";

interface PlayerFrame extends FrameInfo {
  screenName: string;
  name?: string;
}
interface PlayerBoot {
  title: string;
  start: { screen: string; frame: string };
  steps: Array<{ screen: string; frame: string; label: string }>;
  exit?: string;
  live: boolean;
  frames: PlayerFrame[];
}

export class Player {
  readonly stage = document.getElementById("fx-stage")!;
  readonly hud = document.getElementById("fx-hud")!;
  readonly box = h("div", { class: "fx-device-box" });
  readonly device = h("div", { class: "fx-device" });
  current: PlayerFrame;
  /** Hashes visited in this tab, to know whether Back has somewhere to go. */
  private trail: string[] = [];

  constructor(readonly boot: PlayerBoot) {
    this.current = this.find(boot.start.screen, boot.start.frame) ?? boot.frames[0]!;
    this.box.append(this.device);
    this.stage.append(this.box);
    injectPrototypeCss();
    this.device.addEventListener("click", (e) => prototypeClick(e, (to) => this.navigate(to)));
    window.addEventListener("hashchange", () => void this.fromHash(true));
    window.addEventListener("resize", () => this.fit());
    window.addEventListener("keydown", (e) => this.onKey(e));
    if (boot.live) this.watch();
  }

  start() {
    if (!this.parseHash()) history.replaceState(null, "", this.hashOf(this.current));
    void this.fromHash(false);
    (window as unknown as { framitPlayer: Player }).framitPlayer = this;
    document.body.dataset.ready = "1";
  }

  private find(screen: string, frame?: string): PlayerFrame | undefined {
    return this.boot.frames.find((f) => f.screen === screen && (!frame || f.frame === frame));
  }

  private hashOf(f: Pick<FrameInfo, "screen" | "frame">) {
    return `#/${encodeURIComponent(f.screen)}/${encodeURIComponent(f.frame)}`;
  }

  private parseHash(): PlayerFrame | undefined {
    const m = /^#\/([^/]+)\/([^/]+)$/.exec(location.hash);
    return m ? this.find(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)) : undefined;
  }

  private template(f: FrameInfo): HTMLTemplateElement | null {
    return document.querySelector<HTMLTemplateElement>(`template[data-fx-screen="${cssEscape(f.screen)}"][data-fx-frame="${cssEscape(f.frame)}"]`);
  }

  /** Follow a hotspot: the target screen's frame for the current device. */
  navigate(to: string) {
    const target = pickFrame(this.boot.frames.filter((f) => f.screen === to), this.current);
    if (!target) return this.toast(`No screen “${to}” in this prototype.`);
    location.hash = this.hashOf(target);
  }

  goStep(delta: number) {
    const steps = this.boot.steps;
    if (!steps.length) return;
    const i = steps.findIndex((s) => s.screen === this.current.screen);
    const next = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? -1 : i) + delta))];
    if (next && next.screen !== this.current.screen) location.hash = `#/${encodeURIComponent(next.screen)}/${encodeURIComponent(next.frame)}`;
  }

  restart() {
    const s = this.find(this.boot.start.screen, this.boot.start.frame)!;
    if (s.screen !== this.current.screen || s.frame !== this.current.frame) location.hash = this.hashOf(s);
  }

  private async fromHash(animate: boolean) {
    const f = this.parseHash() ?? this.current;
    const hash = this.hashOf(f);
    if (this.trail.at(-2) === hash) this.trail.pop();
    else if (this.trail.at(-1) !== hash) this.trail.push(hash);
    // State and controls update at once, so a quick second click acts on the new screen;
    // only the frame swap is animated.
    this.current = f;
    this.renderHud();
    const show = () => {
      const tpl = this.template(f);
      this.device.replaceChildren(tpl ? tpl.content.cloneNode(true) : h("p", {}, "Missing frame"));
      this.device.scrollTop = 0;
      this.fit();
    };
    if (animate) await crossfade(this.box, show);
    else show();
  }

  fit() {
    const { width, height } = this.current;
    const availW = Math.max(200, innerWidth - 48);
    const availH = Math.max(200, innerHeight - 52 - 24);
    const s = Math.min(availW / width, availH / height, 2);
    this.box.style.width = `${Math.round(width * s)}px`;
    this.box.style.height = `${Math.round(height * s)}px`;
    Object.assign(this.device.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${s})` });
  }

  private renderHud() {
    const steps = this.boot.steps;
    const i = steps.findIndex((s) => s.screen === this.current.screen);
    const btn = (label: string, title: string, on: () => void, disabled = false, extra: Record<string, string> = {}) => h("button", { type: "button", title, "aria-label": title, disabled, onclick: on, ...extra }, label);
    const items: Array<HTMLElement> = [btn("←", "Back", () => history.back(), this.trail.length < 2, { "data-hud": "back" })];
    const title = h("span", { class: "fx-hud-title", "data-hud": "title" });
    title.append(h("b", {}, this.current.screenName));
    if (i >= 0) title.append(` · ${i + 1} / ${steps.length}`);
    items.push(title);
    if (steps.length > 1) {
      items.push(h("span", { class: "fx-hud-sep" }));
      items.push(btn("‹", "Previous step (←)", () => this.goStep(-1), i <= 0, { "data-hud": "prev" }));
      items.push(btn("›", "Next step (→)", () => this.goStep(1), i < 0 || i >= steps.length - 1, { "data-hud": "next" }));
    }
    items.push(h("span", { class: "fx-hud-sep" }));
    items.push(btn("↺", "Restart", () => this.restart()));
    items.push(btn("◎", "Show hotspots (H)", () => this.toggleHints(), false, { class: document.body.classList.contains("fx-hints") ? "is-on" : "" }));
    if (this.boot.exit) items.push(h("a", { href: this.boot.exit, title: "Close (Esc)", "aria-label": "Close" }, "✕"));
    this.hud.replaceChildren(...items);
  }

  private toggleHints() {
    document.body.classList.toggle("fx-hints");
    this.renderHud();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowRight") this.goStep(1);
    else if (e.key === "ArrowLeft") this.goStep(-1);
    else if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey) this.toggleHints();
    else if (e.key === "Escape" && this.boot.exit) location.href = this.boot.exit;
  }

  private toast(message: string) {
    const t = h("div", { class: "fx-toast-mini", role: "status" }, message);
    document.body.append(t);
    setTimeout(() => t.remove(), 1800);
  }

  private watch() {
    try {
      new EventSource("/api/events").onmessage = () => location.reload();
    } catch {
      /* no server: exported file */
    }
  }
}

// ---------- flow canvas ----------

interface FlowBoot {
  edges: Array<{ from: { screen: string; node: string }; to: string; label?: string; explicit: boolean }>;
  shot: boolean;
  live?: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export class FlowCanvas {
  readonly canvas = document.getElementById("fx-flow")!;
  readonly layer = document.getElementById("fx-edges") as unknown as SVGSVGElement;
  scale = 1;

  constructor(readonly boot: FlowBoot) {
    injectPrototypeCss();
    // Frames on the flow canvas are pictures, not controls.
    this.canvas.addEventListener("click", (e) => e.preventDefault(), true);
  }

  async start() {
    await document.fonts?.ready;
    this.layout();
    window.addEventListener("resize", () => this.layout());
    (window as unknown as { framitFlow: FlowCanvas }).framitFlow = this;
    document.body.dataset.ready = "1";
  }

  /** Grow the canvas to the frames' real heights, scale it to the window, redraw the edges. */
  layout() {
    const slots = Array.from(this.canvas.querySelectorAll<HTMLElement>(".fx-frame-slot"));
    this.canvas.style.transform = "";
    const width = Math.max(...slots.map((s) => s.offsetLeft + s.offsetWidth));
    const framesBottom = Math.max(...slots.map((s) => s.offsetTop + s.offsetHeight));
    const height = framesBottom + 40;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.layer.setAttribute("width", String(width));
    this.layer.setAttribute("height", String(height));
    this.draw();
    if (this.boot.shot) return;
    const wrap = this.canvas.parentElement!;
    const avail = wrap.clientWidth - 96;
    this.scale = Math.min(1, avail / width);
    this.canvas.style.transform = this.scale < 1 ? `scale(${this.scale})` : "";
    this.canvas.style.marginBottom = `${(this.scale - 1) * height}px`;
  }

  /** Canvas-space rectangle of an element (the canvas is unscaled while drawing). */
  private rect(el: Element) {
    const c = this.canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height, get r() { return this.x + this.w; }, get b() { return this.y + this.h; }, get cx() { return this.x + this.w / 2; }, get cy() { return this.y + this.h / 2; } };
  }

  draw() {
    this.layer.replaceChildren();
    const defs = svg("defs", {});
    const marker = svg("marker", { id: "fx-arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", fill: "#3b6cff" }));
    defs.append(marker);
    this.layer.append(defs);
    let drawn = 0;
    let back = 0;
    for (const e of this.boot.edges) {
      const fromSlot = this.canvas.querySelector(`.fx-frame-slot[data-step-screen="${cssEscape(e.from.screen)}"]`);
      const toFrame = this.canvas.querySelector(`.fx-frame-slot[data-step-screen="${cssEscape(e.to)}"] .fx-frame`);
      const node = fromSlot?.querySelector<HTMLElement>(`[data-node="${cssEscape(e.from.node)}"]`);
      if (!node || !toFrame) continue;
      const hot = node.dataset.to === e.to ? node : (node.querySelector(`[data-to="${cssEscape(e.to)}"]`) ?? node);
      const S = this.rect(hot);
      const D = this.rect(toFrame);
      let d: string;
      let mid: { x: number; y: number };
      if (D.x >= S.r) {
        const sx = S.r + 4, sy = S.cy;
        const ex = D.x - 3, ey = Math.max(D.y + 28, Math.min(D.b - 28, sy));
        const k = Math.max(40, (ex - sx) * 0.45);
        d = `M${sx},${sy} C${sx + k},${sy} ${ex - k},${ey} ${ex},${ey}`;
        mid = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
      } else if (D.r <= S.x) {
        // Backwards: leave from the hotspot's left edge into the target's right edge, bowing
        // downwards so it does not sit on top of a forward arrow between the same frames.
        const sx = S.x - 4, sy = S.cy;
        const ex = D.r + 3, ey = Math.max(D.y + 28, Math.min(D.b - 28, sy + 36 + back++ * 14));
        const k = Math.max(40, (sx - ex) * 0.45);
        d = `M${sx},${sy} C${sx - k},${sy + 30} ${ex + k},${ey + 30} ${ex},${ey}`;
        mid = { x: (sx + ex) / 2, y: (sy + ey) / 2 + 22 };
      } else {
        const below = D.y >= S.b;
        const sx = S.cx, sy = below ? S.b + 4 : S.y - 4, ex = D.cx, ey = below ? D.y - 3 : D.b + 3;
        const k = Math.max(30, Math.abs(ey - sy) * 0.45) * (below ? 1 : -1);
        d = `M${sx},${sy} C${sx},${sy + k} ${ex},${ey - k} ${ex},${ey}`;
        mid = { x: (sx + ex) / 2, y: (sy + ey) / 2 };
      }
      const g = svg("g", { class: "fx-edge-g", "data-from": `${e.from.screen}/${e.from.node}`, "data-to": e.to });
      g.append(svg("rect", { class: "fx-hot", x: S.x - 3, y: S.y - 3, width: S.w + 6, height: S.h + 6, rx: 6 }));
      g.append(svg("path", { class: `fx-edge${e.explicit ? " fx-edge--explicit" : ""}`, d, "marker-end": "url(#fx-arrow)" }));
      this.layer.append(g);
      if (e.label) {
        const lg = svg("g", { class: "fx-edge-label" });
        const text = svg("text", { x: mid.x, y: mid.y, "text-anchor": "middle", "dominant-baseline": "central" });
        text.textContent = e.label;
        lg.append(text);
        g.append(lg);
        const bb = text.getBBox();
        lg.insertBefore(svg("rect", { x: bb.x - 8, y: bb.y - 4, width: bb.width + 16, height: bb.height + 8, rx: 10 }), text);
      }
      drawn++;
    }
    document.body.dataset.edges = String(drawn);
  }
}

const playerBoot = document.getElementById("fx-player-boot");
if (playerBoot) new Player(JSON.parse(playerBoot.textContent ?? "{}") as PlayerBoot).start();
const flowBoot = document.getElementById("fx-flow-boot");
if (flowBoot) {
  const boot = JSON.parse(flowBoot.textContent ?? "{}") as FlowBoot;
  void new FlowCanvas(boot).start();
  if (boot.live) {
    try {
      new EventSource("/api/events").onmessage = () => location.reload();
    } catch {
      /* no server */
    }
  }
}
