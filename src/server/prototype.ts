import { FramitError } from "../errors.js";
import type { ProtoFrame, ProtoStep } from "../renderer/prototype.js";
import { deviceName, placeFrames, renderFrame, type PlacedFrame } from "../renderer/render.js";
import { explicitLinks, Flow, flowEdges, reachableScreens, screenHotspots, type FlowEdgeResolved, type FlowT, type Hotspot } from "../schema/flow.js";
import { validate } from "../schema/screen.js";
import type { StoredDoc } from "../store/store.js";
import type { Workspace } from "./workspace.js";

/*
 * Server-side assembly of prototypes: which frames a player embeds, how a flow is laid out,
 * and which hotspots lead nowhere. The pages themselves are pure (renderer/prototype.ts).
 */

export const FLOW_GAP = 160;
const LABEL_H = 30;

export type ProtoTarget = { kind: "screen"; id: string; frame?: string } | { kind: "flow"; id: string };

export interface ProtoWarning {
  screen?: string;
  node?: string;
  message: string;
}

export async function loadFlow(ws: Workspace, id: string): Promise<{ doc: StoredDoc; flow: FlowT }> {
  const doc = await ws.store.read("flow", id);
  return { doc, flow: validate(Flow, doc, `flow "${id}"`) };
}

/** The frame a flow step shows: explicit, else the flow's device, else the first frame. */
export function pickStepFrame(placed: PlacedFrame[], frame: string | undefined, device: string | undefined, screen: string): PlacedFrame {
  if (frame) {
    const f = placed.find((p) => p.frame.id === frame);
    if (!f) throw new FramitError("NOT_FOUND", `Screen "${screen}" has no frame "${frame}".`, { hint: `Its frames: ${placed.map((p) => p.frame.id).join(", ")}.` });
    return f;
  }
  return (device && placed.find((p) => deviceName(p.frame.device) === device)) || placed[0]!;
}

export async function renderScreenFrames(ws: Workspace, id: string, links?: Record<string, string>): Promise<ProtoFrame[]> {
  const { screen, theme } = await ws.screen(id);
  return placeFrames(screen, theme).map((p) => ({
    screen: screen.id,
    screenName: screen.name,
    frame: p.frame.id,
    name: p.frame.name,
    device: deviceName(p.frame.device),
    width: p.width,
    height: p.height,
    theme,
    html: renderFrame(p, theme, { screen: screen.id, links }).html,
  }));
}

/** Check that a flow's steps and edges point at things that exist. Throws on hard errors. */
export async function checkFlow(ws: Workspace, flow: FlowT): Promise<ProtoWarning[]> {
  const warnings: ProtoWarning[] = [];
  const seen = new Set<string>();
  const known = (await ws.store.list("screen")).map((s) => s.id);
  for (const s of flow.steps) {
    if (seen.has(s.screen)) throw new FramitError("SCHEMA", `Screen "${s.screen}" appears twice in the flow's steps.`, { hint: "Each screen appears at most once. Duplicate the screen (duplicate_screen) for a second state." });
    seen.add(s.screen);
    if (!known.includes(s.screen)) throw new FramitError("NOT_FOUND", `Flow step names screen "${s.screen}", which does not exist.`, { hint: known.length ? `Screens: ${known.join(", ")}. Write the screen first.` : "Write the screens first." });
    const { screen, theme } = await ws.screen(s.screen);
    pickStepFrame(placeFrames(screen, theme), s.frame, flow.device, s.screen);
  }
  for (const e of flow.edges) {
    if (!seen.has(e.from.screen)) warnings.push({ screen: e.from.screen, message: `Edge from "${e.from.screen}" which is not a step of this flow.` });
    if (!seen.has(e.to)) warnings.push({ screen: e.from.screen, node: e.from.node, message: `Edge to "${e.to}" which is not a step of this flow.` });
    if (known.includes(e.from.screen)) {
      const doc = await ws.store.read("screen", e.from.screen);
      let found = false;
      const frames = (doc.frames as Array<{ root?: unknown }>) ?? [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== "object" || found) return;
        const o = n as { id?: string; children?: unknown[] };
        if (o.id === e.from.node) found = true;
        o.children?.forEach(walk);
      };
      frames.forEach((f) => walk(f.root));
      if (!found) warnings.push({ screen: e.from.screen, node: e.from.node, message: `Screen "${e.from.screen}" has no node "${e.from.node}"; the edge cannot be drawn.` });
    }
  }
  return warnings;
}

/** Everything the player page needs: all frames reachable from the start, and the steps. */
export async function buildPlayer(
  ws: Workspace,
  target: ProtoTarget,
): Promise<{ title: string; frames: ProtoFrame[]; start: { screen: string; frame: string }; steps: ProtoStep[]; warnings: ProtoWarning[] }> {
  let starts: string[];
  let links: Record<string, Record<string, string>> = {};
  let title: string;
  let flow: FlowT | undefined;
  if (target.kind === "flow") {
    flow = (await loadFlow(ws, target.id)).flow;
    starts = flow.steps.map((s) => s.screen);
    links = explicitLinks(flow);
    title = flow.name;
  } else {
    starts = [target.id];
    title = (await ws.screen(target.id)).screen.name;
  }
  const exists = new Set((await ws.store.list("screen")).map((s) => s.id));
  const reach = await reachableScreens(starts, async (id) => (exists.has(id) ? ws.store.read("screen", id) : undefined), links);
  const frames: ProtoFrame[] = [];
  for (const id of reach.order) frames.push(...(await renderScreenFrames(ws, id, links[id])));
  const warnings: ProtoWarning[] = reach.missing.map((m) => ({ screen: m.screen, node: m.node, message: `Hotspot leads to "${m.to}", which is not a screen.` }));

  const steps: ProtoStep[] = [];
  if (flow) {
    for (const s of flow.steps) {
      const mine = frames.filter((f) => f.screen === s.screen);
      if (!mine.length) continue;
      const placedLike = mine.map((f) => ({ frame: { id: f.frame, device: f.device } })) as unknown as PlacedFrame[];
      const f = pickStepFrame(placedLike, s.frame, flow.device, s.screen);
      steps.push({ screen: s.screen, frame: f.frame.id, label: s.label ?? mine[0]!.screenName });
    }
  }
  let start: { screen: string; frame: string };
  if (steps.length) start = { screen: steps[0]!.screen, frame: steps[0]!.frame };
  else {
    const first = frames.filter((f) => f.screen === starts[0]);
    const pick = (target.kind === "screen" && target.frame && first.find((f) => f.frame === target.frame)) || first[0];
    if (!pick) throw new FramitError("NOT_FOUND", `Nothing to show for ${target.kind} "${target.id}".`);
    if (target.kind === "screen" && target.frame && pick.frame !== target.frame) throw new FramitError("NOT_FOUND", `Screen "${target.id}" has no frame "${target.frame}".`);
    start = { screen: pick.screen, frame: pick.frame };
  }
  return { title, frames, start, steps, warnings };
}

export interface FlowView {
  flow: FlowT;
  doc: StoredDoc;
  steps: Array<ProtoFrame & { label: string; x: number; y: number }>;
  edges: FlowEdgeResolved[];
  outside: Array<Hotspot & { screen: string }>;
  width: number;
  height: number;
}

/** Lay a flow out on its canvas: one frame per step, left to right unless positioned. */
export async function buildFlowView(ws: Workspace, id: string): Promise<FlowView> {
  const { doc, flow } = await loadFlow(ws, id);
  const links = explicitLinks(flow);
  const steps: FlowView["steps"] = [];
  const hotspots = new Map<string, Hotspot[]>();
  let nextX = 0;
  for (const s of flow.steps) {
    const { screen, theme, doc: sdoc } = await ws.screen(s.screen);
    const placed = pickStepFrame(placeFrames(screen, theme), s.frame, flow.device, s.screen);
    hotspots.set(s.screen, screenHotspots(sdoc, placed.frame.id));
    const x = s.position?.x ?? nextX;
    const y = s.position?.y ?? 0;
    nextX = Math.max(nextX, x + placed.width + FLOW_GAP);
    steps.push({
      screen: screen.id,
      screenName: screen.name,
      frame: placed.frame.id,
      name: placed.frame.name,
      device: deviceName(placed.frame.device),
      width: placed.width,
      height: placed.height,
      theme,
      html: renderFrame(placed, theme, { screen: screen.id, links: links[screen.id] }).html,
      label: s.label ?? screen.name,
      x,
      y,
    });
  }
  const minX = Math.min(...steps.map((s) => s.x));
  const minY = Math.min(...steps.map((s) => s.y));
  for (const s of steps) {
    s.x -= minX;
    s.y -= minY;
  }
  const { edges, outside } = flowEdges(flow, (screen) => hotspots.get(screen) ?? []);
  const width = Math.max(...steps.map((s) => s.x + s.width));
  const height = Math.max(...steps.map((s) => s.y + LABEL_H + s.height)) + 40;
  return { flow, doc, steps, edges, outside, width, height };
}
