import { z } from "zod";
import { cls, esc } from "../renderer/html.js";
import { defineComponent } from "./types.js";

/*
 * Chart sketches. Wireframes need a chart's shape, not a charting library: line, area, bar,
 * donut and sparkline from a few numbers, in theme colours. Without `series` it renders a muted
 * sample shape so the layout reads right before there is data.
 */

const Series = z.object({ name: z.string().optional(), values: z.array(z.number()).min(1) }).strict();

const DEFAULT_H = { line: 200, area: 200, bar: 200, donut: 160, sparkline: 36 } as const;
const PALETTE = 5;

/** Deterministic sample data, seeded by the node id so a sketch doesn't change between renders. */
function sample(seed: string, n: number, kind: string): number[] {
  let h = 2166136261;
  for (const ch of seed || kind) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  if (kind === "donut") return [46, 28, 16, 10];
  let v = 40 + rnd() * 20;
  return Array.from({ length: n }, () => (v = Math.max(8, v + (rnd() - 0.4) * 18)));
}

/** A "nice" upper bound and tick step: 1, 2 or 5 times a power of ten. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 1, step: 0.25 };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`);

export const chart = defineComponent({
  type: "chart",
  category: "data",
  summary: "Chart sketch: line, area, bar, donut or sparkline from a few numbers, in theme colours. Without series it draws a muted sample shape.",
  container: false,
  props: z
    .object({
      kind: z.enum(["line", "area", "bar", "donut", "sparkline"]).default("line"),
      series: z.array(Series).optional().describe("Omit for a sketch. Donut: one series, one value per segment."),
      labels: z.array(z.string()).optional().describe("X-axis categories (donut: segment names)."),
      height: z.number().positive().optional(),
      legend: z.boolean().optional().describe("Defaults to on for donuts and for several named series."),
      axis: z.boolean().default(true).describe("Y gridlines with values and x labels (line, area, bar)."),
      prefix: z.string().optional().describe('Before values, e.g. "$".'),
      suffix: z.string().optional().describe('After values, e.g. "%".'),
    })
    .strict(),
  example: {
    width: 420,
    props: { kind: "area", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], series: [{ name: "Visitors", values: [120, 180, 150, 240, 210, 300, 280] }] },
  },
  variants: [
    { kind: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "2025", values: [32, 41, 38, 52] }, { name: "2026", values: [40, 47, 55, 61] }], height: 160 },
    { kind: "donut", labels: ["Direct", "Search", "Social", "Email"], series: [{ values: [42, 31, 17, 10] }], suffix: "%" },
    { kind: "line" },
    { kind: "sparkline", series: [{ values: [4, 6, 5, 8, 7, 9, 12] }] },
  ],
  render: (n, ctx) => {
    const p = n.props;
    const sketch = !p.series?.length;
    const len = sketch ? (p.kind === "bar" ? 6 : 8) : Math.max(...p.series!.map((s) => s.values.length));
    const series = sketch ? [{ name: undefined, values: sample(n.id, p.labels?.length || len, p.kind) }] : p.series!;
    const h = p.height ?? DEFAULT_H[p.kind];
    const fmt = (v: number) => `${p.prefix ?? ""}${compact(v)}${p.suffix ?? ""}`;
    const base = cls("fx-chart", `fx-chart--${p.kind}`, sketch && "fx-chart--sketch");

    if (p.kind === "donut") {
      const values = series[0]!.values;
      const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let at = 0;
      const arcs = values
        .map((v, i) => {
          const len = (Math.max(0, v) / total) * 100;
          const arc = `<circle class="fx-chart-c${i % PALETTE}" cx="21" cy="21" r="15.915" fill="none" stroke-width="6" stroke-dasharray="${len.toFixed(3)} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(25 - at).toFixed(3)}"/>`;
          at += len;
          return arc;
        })
        .join("");
      const legend = p.legend ?? true;
      const items = legend ? values.map((v, i) => `<li><i class="fx-chart-key fx-chart-c${i % PALETTE}"></i><span>${ctx.text(p.labels?.[i] ?? `Segment ${i + 1}`)}</span>${sketch ? "" : `<b>${esc(fmt(v))}</b>`}</li>`).join("") : "";
      return `<div ${ctx.attrs(n, base)}><svg class="fx-chart-donut" viewBox="0 0 42 42" style="width:${h}px;height:${h}px" aria-hidden="true">${arcs}</svg>${items ? `<ul class="fx-chart-legend fx-chart-legend--side">${items}</ul>` : ""}</div>`;
    }

    const max = Math.max(...series.flatMap((s) => s.values), 0);
    const min = Math.min(...series.flatMap((s) => s.values), 0);
    const { top, step } = niceScale(max);
    const bottom = min < 0 ? -niceScale(-min).top : 0;
    const span = top - bottom || 1;
    const y = (v: number) => ((top - v) / span) * 100;

    if (p.kind === "sparkline") {
      // A sparkline shows the trend, so it spans its own range rather than starting at zero.
      const vals = series[0]!.values;
      const lo = Math.min(...vals), hi = Math.max(...vals);
      const sy = (v: number) => (hi === lo ? 50 : 6 + ((hi - v) / (hi - lo)) * 88);
      const pts = vals.map((v, i) => `${vals.length === 1 ? 50 : (i / (vals.length - 1)) * 100},${sy(v).toFixed(2)}`).join(" ");
      return `<div ${ctx.attrs(n, base, { height: `${h}px` })}><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="fx-chart-line fx-chart-c0" points="${pts}" vector-effect="non-scaling-stroke"/></svg></div>`;
    }

    const showAxis = p.axis;
    const ticks: number[] = [];
    for (let t = top; t >= bottom - 1e-9; t -= step) ticks.push(t);
    const grid = showAxis ? ticks.map((t) => `<line x1="0" x2="100" y1="${y(t).toFixed(2)}" y2="${y(t).toFixed(2)}" class="fx-chart-grid${t === 0 ? " fx-chart-grid--zero" : ""}" vector-effect="non-scaling-stroke"/>`).join("") : "";
    const yLabels = showAxis ? `<div class="fx-chart-y">${ticks.map((t) => `<span style="top:${y(t).toFixed(2)}%">${esc(fmt(t))}</span>`).join("")}</div>` : "";

    let plot: string;
    if (p.kind === "bar") {
      const groups = Array.from({ length: len }, (_, i) => `<div class="fx-chart-group">${series.map((s, si) => {
        const v = s.values[i] ?? 0;
        const from = y(Math.max(0, v)), to = y(Math.min(0, v));
        return `<i class="fx-chart-bar fx-chart-bg${si % PALETTE}" style="top:${from.toFixed(2)}%;height:${Math.max(0.5, to - from).toFixed(2)}%"></i>`;
      }).join("")}</div>`).join("");
      plot = `<div class="fx-chart-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${grid}</svg><div class="fx-chart-bars">${groups}</div></div>`;
    } else {
      const x = (i: number, n: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
      const paths = series
        .map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i, s.values.length).toFixed(2)},${y(v).toFixed(2)}`);
          const area = p.kind === "area" ? `<polygon class="fx-chart-area fx-chart-c${si % PALETTE}" points="${x(0, s.values.length).toFixed(2)},${y(0).toFixed(2)} ${pts.join(" ")} ${x(s.values.length - 1, s.values.length).toFixed(2)},${y(0).toFixed(2)}"/>` : "";
          return `${area}<polyline class="fx-chart-line fx-chart-c${si % PALETTE}" points="${pts.join(" ")}" vector-effect="non-scaling-stroke"/>`;
        })
        .join("");
      plot = `<div class="fx-chart-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${grid}${paths}</svg></div>`;
    }
    const xLabels = showAxis && p.labels?.length ? `<div class="fx-chart-x${p.kind === "bar" ? " fx-chart-x--bands" : ""}">${p.labels.slice(0, len).map((l) => `<span>${ctx.text(l)}</span>`).join("")}</div>` : "";
    const named = series.filter((s) => s.name);
    const legend = (p.legend ?? named.length > 1) && named.length ? `<ul class="fx-chart-legend">${series.map((s, i) => (s.name ? `<li><i class="fx-chart-key fx-chart-c${i % PALETTE}"></i><span>${ctx.text(s.name)}</span></li>` : "")).join("")}</ul>` : "";
    // Grid: [y axis | plot] over [spacer | x labels], so x labels line up with the plot.
    return `<div ${ctx.attrs(n, base)}>${legend}<div class="fx-chart-frame${showAxis ? "" : " fx-chart-frame--bare"}" style="grid-template-rows:${h}px auto">${yLabels || "<span></span>"}${plot}${xLabels ? `<span></span>${xLabels}` : ""}</div></div>`;
  },
});
