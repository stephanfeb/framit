import { z } from "zod";
import { walkScreenNodes } from "../store/nodes.js";
import { DocId } from "./common.js";
import { DEVICE_NAMES } from "./theme.js";

/*
 * Flow documents (docs/03-document-model.md "Flows"): existing screens placed on a canvas in
 * order, with edges between them. Edges come from hotspots (any `to` prop on a button, link,
 * nav item, tab bar item or list item) and from explicit `edges`, which can also turn a node
 * without a `to` into a hotspot and label the arrow.
 */

export const FlowStep = z
  .object({
    screen: DocId.describe("Screen id."),
    frame: z.string().optional().describe("Frame id within the screen. Defaults to the frame matching the flow's device, else the first."),
    label: z.string().optional().describe("Caption above the step, e.g. \"Sign up\". Defaults to the screen name."),
    position: z.object({ x: z.number(), y: z.number() }).strict().optional().describe("Canvas position. Omit to lay steps out left to right."),
  })
  .strict();

export const FlowEdge = z
  .object({
    from: z.object({ screen: DocId, node: z.string().describe("Node id of the hotspot in that screen.") }).strict(),
    to: DocId.describe("Target screen id."),
    label: z.string().optional().describe('Arrow label, e.g. "Tap Continue".'),
  })
  .strict();

export const Flow = z
  .object({
    kind: z.literal("flow").optional(),
    id: DocId,
    name: z.string().min(1),
    description: z.string().optional(),
    device: z.enum(DEVICE_NAMES).optional().describe("Which frame of each screen to show when a step names none, e.g. \"phone\"."),
    steps: z.array(FlowStep).min(1),
    edges: z.array(FlowEdge).default([]).describe("Extra or labelled edges. Hotspots with `to` props are edges already; list them here only to add a label."),
    revision: z.number().int().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

export type FlowT = z.infer<typeof Flow>;
export type FlowStepT = z.infer<typeof FlowStep>;

export interface Hotspot {
  /** Node id that renders the hotspot (for item-level hotspots, the list/nav/tabbar node). */
  node: string;
  to: string;
  /** Text on the hotspot, if any: used as a default edge label hint. */
  text?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every hotspot in a screen document, in document order. `frame` limits it to one frame. */
export function screenHotspots(doc: Record<string, unknown>, frame?: string): Hotspot[] {
  const out: Hotspot[] = [];
  const target = frame && Array.isArray(doc.frames) ? { ...doc, frames: (doc.frames as Array<{ id?: string }>).filter((f) => f.id === frame) } : doc;
  walkScreenNodes(target, (node) => {
    const id = typeof node.id === "string" ? node.id : undefined;
    if (!id || !isObj(node.props)) return;
    const scan = (v: unknown, depth: number) => {
      if (depth > 4) return;
      if (Array.isArray(v)) return v.forEach((x) => scan(x, depth + 1));
      if (!isObj(v)) return;
      if (typeof v.to === "string" && v.to) out.push({ node: id, to: v.to, text: [v.label, v.title, v.content].find((t) => typeof t === "string") as string | undefined });
      for (const [k, x] of Object.entries(v)) if (k !== "to" && k !== "children" && (Array.isArray(x) || isObj(x))) scan(x, depth + 1);
    };
    scan(node.props, 0);
  });
  return out;
}

/** Which node ids in which screen navigate where, for explicit flow edges (screen → node → target). */
export function explicitLinks(flow: Pick<FlowT, "edges">): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const e of flow.edges ?? []) (out[e.from.screen] ??= {})[e.from.node] = e.to;
  return out;
}

export interface FlowEdgeResolved {
  from: { screen: string; node: string };
  to: string;
  label?: string;
  /** Declared in `edges` rather than derived from a `to` prop. */
  explicit: boolean;
}

/**
 * The edges of a flow: hotspots in each step's frame that point at another step, merged with
 * the explicit edges (which win, and add labels). Hotspots pointing outside the flow are
 * returned separately so tools can warn about them.
 */
export function flowEdges(
  flow: Pick<FlowT, "steps" | "edges">,
  hotspotsOf: (screen: string) => Hotspot[],
): { edges: FlowEdgeResolved[]; outside: Array<Hotspot & { screen: string }> } {
  const inFlow = new Set(flow.steps.map((s) => s.screen));
  const edges: FlowEdgeResolved[] = [];
  const outside: Array<Hotspot & { screen: string }> = [];
  const key = (s: string, n: string, t: string) => `${s}\u0000${n}\u0000${t}`;
  const explicit = new Map((flow.edges ?? []).map((e) => [key(e.from.screen, e.from.node, e.to), e]));
  const seen = new Set<string>();
  for (const screen of [...inFlow]) {
    for (const h of hotspotsOf(screen)) {
      const k = key(screen, h.node, h.to);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!inFlow.has(h.to)) {
        outside.push({ ...h, screen });
        continue;
      }
      const ex = explicit.get(k);
      edges.push({ from: { screen, node: h.node }, to: h.to, label: ex?.label, explicit: false });
    }
  }
  for (const e of flow.edges ?? []) {
    const k = key(e.from.screen, e.from.node, e.to);
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ from: e.from, to: e.to, label: e.label, explicit: true });
  }
  return { edges, outside };
}

/**
 * Screens reachable from `start` by following hotspots and explicit links, breadth first.
 * `missing` lists targets that name no existing screen.
 */
export async function reachableScreens(
  start: string[],
  load: (id: string) => Promise<Record<string, unknown> | undefined>,
  extraLinks: Record<string, Record<string, string>> = {},
  limit = 60,
): Promise<{ order: string[]; docs: Map<string, Record<string, unknown>>; missing: Array<{ screen: string; node: string; to: string }> }> {
  const docs = new Map<string, Record<string, unknown>>();
  const missing: Array<{ screen: string; node: string; to: string }> = [];
  const queue = [...new Set(start)];
  const queued = new Set(queue);
  const order: string[] = [];
  while (queue.length && order.length < limit) {
    const id = queue.shift()!;
    const doc = await load(id);
    if (!doc) continue;
    docs.set(id, doc);
    order.push(id);
    const targets = [...screenHotspots(doc).map((h) => ({ node: h.node, to: h.to })), ...Object.entries(extraLinks[id] ?? {}).map(([node, to]) => ({ node, to }))];
    for (const t of targets) {
      if (queued.has(t.to)) continue;
      queued.add(t.to);
      if (await load(t.to)) queue.push(t.to);
      else missing.push({ screen: id, node: t.node, to: t.to });
    }
  }
  return { order, docs, missing };
}

export const FLOW_GUIDE = `# Flows

A flow strings existing screens together: it places one frame of each screen on a canvas in order
and draws arrows between them. Write the screens first (write_screen), then the flow.

Navigation comes from the screens themselves: give a button, link, nav item, tab bar item or list item a
\`to\` prop naming the target screen id. In the browser's Preview mode, in Present mode and in exported
HTML, clicking it shows the target screen's frame for the same device. In the flow canvas each such
hotspot draws an arrow.

\`\`\`json
{
  "id": "onboarding",
  "name": "Onboarding",
  "device": "phone",
  "steps": [
    { "screen": "welcome" },
    { "screen": "verify-email", "label": "Verify" },
    { "screen": "all-set" }
  ],
  "edges": [
    { "from": { "screen": "welcome", "node": "n_cta" }, "to": "verify-email", "label": "Tap Get started" }
  ]
}
\`\`\`

- steps: { screen, frame?, label?, position? }. Without \`frame\`, the frame matching the flow's
  \`device\` is used, else the screen's first frame. Without \`position\`, steps go left to right.
- edges are optional. Use them to label an arrow, or to make a node without a \`to\` prop navigate.
- Each screen appears at most once in a flow.
`;
