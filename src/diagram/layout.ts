import elkModule from "elkjs/lib/elk.bundled.js";

// elkjs is CommonJS; under NodeNext its typings and its default export disagree.
const ELK = ((elkModule as unknown as { default?: unknown }).default ?? elkModule) as new () => { layout(graph: unknown): Promise<unknown> };
import type { DiagramNodeT, DiagramT } from "../schema/diagram.js";
import { labelAnchor, routeOrthogonal, simplify, type Box, type Pt } from "../shared/route.js";

/*
 * Diagram layout: elkjs (layered, orthogonal routing) places unpinned nodes and routes edges;
 * pinned nodes (`position`) are then moved to their coordinates and the edges touching them
 * re-routed with the shared router. Lanes are stacked into full-width bands afterwards.
 * Node sizes are estimated from text here; the renderer draws nodes at exactly these sizes.
 */

export interface LaidNode extends Box {
  id: string;
  pinned: boolean;
}
export interface LaidGroup extends Box {
  id: string;
  lane: boolean;
}
export interface LaidEdge {
  id: string;
  from: string;
  to: string;
  points: Pt[];
  label?: Box;
}
export interface DiagramLayout {
  /** Bounding box of everything, in diagram coordinates (pins use the same space). */
  bounds: Box;
  nodes: Record<string, LaidNode>;
  groups: Record<string, LaidGroup>;
  edges: LaidEdge[];
  warnings: Array<{ node?: string; message: string }>;
}

// ---------- size estimation ----------

// Average glyph widths, slightly generous: under-estimating clips text, over-estimating only adds air.
const CHAR = { label: 7.9, small: 6.7, mono: 7.1, edge: 6.6 };
export const NODE_W = { box: 212, actor: 136, note: 200 };
export const NODE_PAD = 12;
export const ICON_BOX = 32;
export const GROUP_PAD = { top: 36, side: 18, bottom: 18 };
const LH = { label: 18, small: 16 };

/** Lines a text needs at `chars` characters per line, wrapping on spaces. */
export function wrapLines(text: string | undefined, chars: number): number {
  if (!text) return 0;
  let lines = 1;
  let cur = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const w = word.length;
    if (cur === 0) cur = w;
    else if (cur + 1 + w <= chars) cur += 1 + w;
    else {
      lines++;
      cur = w;
    }
    while (cur > chars) {
      lines++;
      cur -= chars;
    }
  }
  return lines;
}

export function nodeSize(n: DiagramNodeT): { w: number; h: number } {
  if (n.kind === "actor") {
    const chars = Math.floor((NODE_W.actor - 16) / CHAR.label);
    const techChars = Math.floor((NODE_W.actor - 16) / CHAR.mono);
    return { w: NODE_W.actor, h: 10 + 46 + 8 + wrapLines(n.label, chars) * LH.label + (n.tech ? wrapLines(n.tech, techChars) * LH.small + 2 : 0) + 10 };
  }
  if (n.kind === "note") {
    const chars = Math.floor((NODE_W.note - 2 * NODE_PAD) / CHAR.small);
    const lc = Math.floor((NODE_W.note - 2 * NODE_PAD) / CHAR.label);
    return { w: NODE_W.note, h: NODE_PAD * 2 + wrapLines(n.label, lc) * LH.label + (n.description ? 4 + wrapLines(n.description, chars) * LH.small : 0) };
  }
  const labelChars = Math.floor((NODE_W.box - 2 * NODE_PAD - ICON_BOX - 10) / CHAR.label);
  const techChars = Math.floor((NODE_W.box - 2 * NODE_PAD - ICON_BOX - 10) / CHAR.mono);
  const descChars = Math.floor((NODE_W.box - 2 * NODE_PAD) / CHAR.small);
  const head = Math.max(ICON_BOX, wrapLines(n.label, labelChars) * LH.label + (n.tech ? wrapLines(n.tech, techChars) * LH.small + 2 : 0));
  const desc = n.description ? 8 + wrapLines(n.description, descChars) * LH.small : 0;
  const cap = n.kind === "database" ? 12 : 0;
  return { w: NODE_W.box, h: Math.ceil(NODE_PAD * 2 + head + desc + cap) };
}

export function edgeLabelSize(label: string): { w: number; h: number } {
  return { w: Math.ceil(Math.min(label.length, 28) * CHAR.edge + 14), h: 20 * wrapLines(label, 28) };
}

// ---------- layout ----------

const elk = new ELK();
const cache = new Map<string, Promise<DiagramLayout>>();

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
  labels?: Array<{ text: string; width: number; height: number; x?: number; y?: number }>;
}
interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: Array<{ text: string; width: number; height: number; x?: number; y?: number }>;
  sections?: Array<{ startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] }>;
  container?: string;
}

/** Edge ids are assigned on write; fall back to the index for unsaved documents. */
export const edgeId = (e: { id?: string }, i: number) => e.id ?? `e${i}`;

export function layoutDiagram(d: DiagramT): Promise<DiagramLayout> {
  const key = JSON.stringify([d.direction, d.nodes, d.groups, d.edges]);
  let p = cache.get(key);
  if (!p) {
    p = compute(d);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return p;
}

async function compute(d: DiagramT): Promise<DiagramLayout> {
  const warnings: DiagramLayout["warnings"] = [];
  const sizes = new Map(d.nodes.map((n) => [n.id, nodeSize(n)]));
  const elkNode = (n: DiagramNodeT): ElkNode => ({ id: n.id, width: sizes.get(n.id)!.w, height: sizes.get(n.id)!.h });
  const children: ElkNode[] = [];
  for (const g of d.groups) {
    const members = d.nodes.filter((n) => n.group === g.id);
    if (!members.length) continue;
    children.push({ id: `group:${g.id}`, children: members.map(elkNode), layoutOptions: { "elk.padding": `[top=${GROUP_PAD.top},left=${GROUP_PAD.side},bottom=${GROUP_PAD.bottom},right=${GROUP_PAD.side}]` } });
  }
  for (const n of d.nodes) if (!n.group) children.push(elkNode(n));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": d.direction === "TB" ? "DOWN" : "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "84",
      "elk.spacing.nodeNode": "44",
      "elk.spacing.edgeNode": "26",
      "elk.spacing.edgeEdge": "14",
      "elk.layered.spacing.edgeNodeBetweenLayers": "26",
      "elk.spacing.edgeLabel": "6",
      "elk.edgeLabels.inline": "false",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      // Only real cycles are broken; among candidate edges, the one pointing back up the authors'
      // listing order is drawn backwards. (Plain MODEL_ORDER reverses every such edge, cycle or not.)
      "elk.layered.cycleBreaking.strategy": "GREEDY_MODEL_ORDER",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children,
    edges: d.edges.map((e, i) => ({
      id: edgeId(e, i),
      sources: [e.from],
      targets: [e.to],
      labels: e.label ? [{ text: e.label, ...(({ w, h }) => ({ width: w, height: h }))(edgeLabelSize(e.label)) }] : undefined,
    })),
  };
  const out = (await elk.layout(graph as never)) as unknown as ElkNode;

  // Flatten to absolute coordinates.
  const abs = new Map<string, Pt>([["root", { x: 0, y: 0 }]]);
  const nodes: Record<string, LaidNode> = {};
  const groups: Record<string, LaidGroup> = {};
  const lanes = new Set(d.groups.filter((g) => g.lane).map((g) => g.id));
  const visit = (n: ElkNode, ox: number, oy: number) => {
    const x = ox + (n.x ?? 0), y = oy + (n.y ?? 0);
    abs.set(n.id, { x, y });
    if (n.id.startsWith("group:")) {
      const gid = n.id.slice(6);
      groups[gid] = { id: gid, x, y, w: n.width ?? 0, h: n.height ?? 0, lane: lanes.has(gid) };
    } else if (n.id !== "root") nodes[n.id] = { id: n.id, x, y, w: n.width ?? 0, h: n.height ?? 0, pinned: false };
    for (const c of n.children ?? []) visit(c, x, y);
  };
  visit(out, 0, 0);

  const edges: LaidEdge[] = (out.edges ?? []).map((e, i) => {
    const o = abs.get(e.container ?? "root") ?? { x: 0, y: 0 };
    const s = e.sections?.[0];
    const points = s ? simplify([s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x + o.x, y: p.y + o.y }))) : [];
    const l = e.labels?.[0];
    const src = d.edges[i]!;
    return { id: e.id, from: src.from, to: src.to, points, label: l ? { x: (l.x ?? 0) + o.x, y: (l.y ?? 0) + o.y, w: l.width, h: l.height } : undefined };
  });

  // Lanes: full-width bands, stacked without overlap (a lane's nodes move with it).
  const moved = new Set<string>();
  const laneList = Object.values(groups).filter((g) => g.lane).sort((a, b) => a.y - b.y);
  if (laneList.length) {
    let minX = Infinity, maxX = -Infinity;
    for (const b of [...Object.values(nodes), ...Object.values(groups)]) {
      minX = Math.min(minX, b.x);
      maxX = Math.max(maxX, b.x + b.w);
    }
    let floor = -Infinity;
    for (const lane of laneList) {
      const dy = Math.max(0, floor + 16 - lane.y);
      if (dy > 0) {
        lane.y += dy;
        for (const n of d.nodes) if (n.group === lane.id) {
          nodes[n.id]!.y += dy;
          moved.add(n.id);
        }
      }
      lane.x = minX - 12;
      lane.w = maxX - minX + 24;
      floor = lane.y + lane.h;
    }
  }

  // Pins.
  for (const n of d.nodes) {
    if (!n.position) continue;
    const laid = nodes[n.id]!;
    laid.pinned = true;
    if (laid.x !== n.position.x || laid.y !== n.position.y) {
      laid.x = n.position.x;
      laid.y = n.position.y;
      moved.add(n.id);
    }
  }
  // Boundaries (not lanes) follow their members when any of them moved.
  for (const g of Object.values(groups)) {
    const members = d.nodes.filter((n) => n.group === g.id).map((n) => nodes[n.id]!);
    if (g.lane) {
      // A pinned node may leave its lane's band vertically; grow the band to hold it.
      const top = Math.min(g.y, ...members.map((m) => m.y - GROUP_PAD.top));
      const bottom = Math.max(g.y + g.h, ...members.map((m) => m.y + m.h + GROUP_PAD.bottom));
      g.y = top;
      g.h = bottom - top;
      continue;
    }
    if (!members.some((m) => moved.has(m.id))) continue;
    const x0 = Math.min(...members.map((m) => m.x)) - GROUP_PAD.side;
    const y0 = Math.min(...members.map((m) => m.y)) - GROUP_PAD.top;
    const x1 = Math.max(...members.map((m) => m.x + m.w)) + GROUP_PAD.side;
    const y1 = Math.max(...members.map((m) => m.y + m.h)) + GROUP_PAD.bottom;
    Object.assign(g, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  // Re-route edges whose ends moved away from where elk put them.
  const boxes = Object.values(nodes);
  for (const e of edges) {
    if (!moved.has(e.from) && !moved.has(e.to) && e.points.length) continue;
    e.points = e.from === e.to ? selfLoop(nodes[e.from]!) : routeOrthogonal(nodes[e.from]!, nodes[e.to]!, boxes);
    if (e.label) {
      const a = labelAnchor(e.points);
      e.label = { ...e.label, x: a.x - e.label.w / 2, y: a.y - e.label.h / 2 };
    }
  }

  // Overlaps caused by pins are worth telling the author about.
  const list = Object.values(nodes);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      if ((a.pinned || b.pinned) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) warnings.push({ node: a.pinned ? a.id : b.id, message: `Pinned node "${a.pinned ? a.id : b.id}" overlaps "${a.pinned ? b.id : a.id}". Move it, or remove its position to let layout place it.` });
    }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (b: Box) => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  };
  [...list, ...Object.values(groups)].forEach(grow);
  for (const e of edges) {
    e.points.forEach((p) => grow({ x: p.x, y: p.y, w: 0, h: 0 }));
    if (e.label) grow(e.label);
  }
  return { bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, nodes, groups, edges, warnings };
}

function selfLoop(n: Box): Pt[] {
  const x = n.x + n.w, y = n.y + n.h / 2;
  return [{ x, y: y - 12 }, { x: x + 28, y: y - 12 }, { x: x + 28, y: y + 12 }, { x, y: y + 12 }];
}
