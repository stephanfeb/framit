/*
 * Dependency-free orthogonal edge routing between boxes, shared by the server (edges touching
 * pinned nodes, after elk has laid out the rest) and the browser (live re-routing while a node
 * is dragged). Elk's own routes are used whenever no endpoint has moved.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const r = (b: Box) => b.x + b.w;
const btm = (b: Box) => b.y + b.h;
const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Does the axis-aligned segment a→b pass through the box (shrunk by `inset`)? */
function hits(a: Pt, b: Pt, box: Box, inset = 2): boolean {
  const x0 = box.x + inset, x1 = r(box) - inset, y0 = box.y + inset, y1 = btm(box) - inset;
  if (a.x === b.x) {
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    return a.x > x0 && a.x < x1 && hi > y0 && lo < y1;
  }
  const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
  return a.y > y0 && a.y < y1 && hi > x0 && lo < x1;
}

function cost(points: Pt[], obstacles: Box[]): number {
  let c = 0;
  for (let i = 0; i < points.length - 1; i++) for (const o of obstacles) if (hits(points[i]!, points[i + 1]!, o)) c++;
  return c * 1000 + points.length;
}

/**
 * Remove zero-length segments and collinear middle points. A coordinate within a pixel of the
 * previous point's is snapped to it, so layout rounding (e.g. 339 vs 338.5) never reads as a
 * diagonal segment.
 */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    const q = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    if (last) {
      if (Math.abs(last.x - q.x) < 1) q.x = last.x;
      if (Math.abs(last.y - q.y) < 1) q.y = last.y;
      if (q.x === last.x && q.y === last.y) continue;
    }
    out.push(q);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!, b = out[i]!, c = out[i + 1]!;
    const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
    if ((near(a.x, b.x) && near(b.x, c.x)) || (near(a.y, b.y) && near(b.y, c.y))) out.splice(i, 1);
  }
  return out;
}

/**
 * An orthogonal path from box `a` to box `b` avoiding `obstacles` where it can: straight when the
 * boxes face each other, else a Z (horizontal-vertical-horizontal or the vertical equivalent)
 * through the gap, else an L. Candidates are scored by obstacle hits, then by bend count.
 */
export function routeOrthogonal(a: Box, b: Box, obstacles: Box[] = []): Pt[] {
  const cands: Pt[][] = [];
  const hGap = b.x >= r(a) ? b.x - r(a) : a.x >= r(b) ? a.x - r(b) : -1;
  const vGap = b.y >= btm(a) ? b.y - btm(a) : a.y >= btm(b) ? a.y - btm(b) : -1;

  if (hGap >= 0) {
    const right = b.x >= r(a);
    const sx = right ? r(a) : a.x, ex = right ? b.x : r(b);
    const lo = Math.max(a.y, b.y) + 8, hi = Math.min(btm(a), btm(b)) - 8;
    if (lo <= hi) {
      const y = clamp((cy(a) + cy(b)) / 2, lo, hi);
      cands.push([{ x: sx, y }, { x: ex, y }]);
    }
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const mx = sx + (ex - sx) * f;
      cands.push([{ x: sx, y: cy(a) }, { x: mx, y: cy(a) }, { x: mx, y: cy(b) }, { x: ex, y: cy(b) }]);
    }
  }
  if (vGap >= 0) {
    const down = b.y >= btm(a);
    const sy = down ? btm(a) : a.y, ey = down ? b.y : btm(b);
    const lo = Math.max(a.x, b.x) + 8, hi = Math.min(r(a), r(b)) - 8;
    if (lo <= hi) {
      const x = clamp((cx(a) + cx(b)) / 2, lo, hi);
      cands.push([{ x, y: sy }, { x, y: ey }]);
    }
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const my = sy + (ey - sy) * f;
      cands.push([{ x: cx(a), y: sy }, { x: cx(a), y: my }, { x: cx(b), y: my }, { x: cx(b), y: ey }]);
    }
  }
  // L shapes: leave sideways, enter from the top or bottom (and the reverse).
  if (hGap >= 0 || vGap >= 0) {
    const sideX = cx(b) > cx(a) ? r(a) : a.x;
    const endY = cy(b) > cy(a) ? b.y : btm(b);
    cands.push([{ x: sideX, y: cy(a) }, { x: cx(b), y: cy(a) }, { x: cx(b), y: endY }]);
    const startY = cy(b) > cy(a) ? btm(a) : a.y;
    const endX = cx(b) > cx(a) ? b.x : r(b);
    cands.push([{ x: cx(a), y: startY }, { x: cx(a), y: cy(b) }, { x: endX, y: cy(b) }]);
  }
  if (!cands.length) {
    // Overlapping boxes: centre to centre is the best we can say.
    return [{ x: cx(a), y: cy(a) }, { x: cx(b), y: cy(b) }];
  }
  const others = obstacles.filter((o) => o !== a && o !== b);
  let best = cands[0]!;
  let bestCost = Infinity;
  for (const c of cands) {
    const s = simplify(c);
    const k = cost(s, others);
    if (k < bestCost) {
      best = s;
      bestCost = k;
    }
  }
  return best;
}

/** Where to put an edge label: the middle of the longest segment. */
export function labelAnchor(points: Pt[]): Pt {
  let best = { x: points[0]!.x, y: points[0]!.y };
  let len = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const l = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (l > len) {
      len = l;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

// Direction of a difference, ignoring floating-point noise from layout arithmetic.
const sgn = (d: number) => (Math.abs(d) < 0.5 ? 0 : Math.sign(d));

/** SVG path data for a polyline with rounded corners. */
export function pathData(input: Pt[], radius = 8): string {
  const points = simplify(input);
  if (points.length < 2) return "";
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1]!, c = points[i]!, n = points[i + 1]!;
    const r1 = Math.min(radius, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(n.x - c.x, n.y - c.y) / 2);
    const a = { x: c.x + sgn(p.x - c.x) * r1, y: c.y + sgn(p.y - c.y) * r1 };
    const b = { x: c.x + sgn(n.x - c.x) * r1, y: c.y + sgn(n.y - c.y) * r1 };
    d += ` L${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last.x},${last.y}`;
}
