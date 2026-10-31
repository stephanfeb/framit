// Pan and zoom of the canvas via a CSS transform (ADR-001).

export interface View {
  x: number;
  y: number;
  z: number;
}

const MIN_Z = 0.05;
const MAX_Z = 8;

export class Viewport {
  view: View = { x: 40, y: 40, z: 1 };
  onChange: () => void = () => {};

  constructor(
    readonly el: HTMLElement,
    readonly canvas: HTMLElement,
    private readonly storageKey: string,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as View | null;
      if (saved && [saved.x, saved.y, saved.z].every(Number.isFinite)) this.view = saved;
      else requestAnimationFrame(() => this.fit());
    } catch {
      requestAnimationFrame(() => this.fit());
    }
    this.apply();
    el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  apply() {
    const { x, y, z } = this.view;
    this.canvas.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.canvas.style.setProperty("--fx-z", String(z));
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.view));
    } catch {
      /* storage unavailable */
    }
    this.onChange();
  }

  /** Viewport-local point -> canvas coordinates. */
  toCanvas(clientX: number, clientY: number) {
    const r = this.el.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.z, y: (clientY - r.top - this.view.y) / this.view.z };
  }

  zoomAt(clientX: number, clientY: number, z: number) {
    const r = this.el.getBoundingClientRect();
    const cx = clientX - r.left;
    const cy = clientY - r.top;
    const nz = Math.min(MAX_Z, Math.max(MIN_Z, z));
    this.view = { x: cx - ((cx - this.view.x) * nz) / this.view.z, y: cy - ((cy - this.view.y) * nz) / this.view.z, z: nz };
    this.apply();
  }

  zoomBy(factor: number) {
    const r = this.el.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, this.view.z * factor);
  }

  panBy(dx: number, dy: number) {
    this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
    this.apply();
  }

  /** Fit all frames or the diagram board (or the given canvas-space rect) in view. */
  fit(rect?: { x: number; y: number; w: number; h: number }) {
    const b = rect ?? this.bounds();
    if (!b) return;
    const r = this.el.getBoundingClientRect();
    const pad = 48;
    const z = Math.min(1, Math.max(MIN_Z, Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h)));
    this.view = { z, x: (r.width - b.w * z) / 2 - b.x * z, y: Math.max(pad, (r.height - b.h * z) / 2) - b.y * z };
    this.apply();
  }

  bounds() {
    const slots = Array.from(this.canvas.querySelectorAll<HTMLElement>(".fx-frame-slot, .fx-board"));
    if (!slots.length) return undefined;
    const xs = slots.map((s) => s.offsetLeft);
    const ys = slots.map((s) => s.offsetTop);
    const x2 = slots.map((s) => s.offsetLeft + s.offsetWidth);
    const y2 = slots.map((s) => s.offsetTop + s.offsetHeight);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y };
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch gestures arrive as ctrl+wheel with small deltas.
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      this.zoomAt(e.clientX, e.clientY, this.view.z * factor);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.panBy(-e.deltaX * k, -e.deltaY * k);
    }
  }
}
