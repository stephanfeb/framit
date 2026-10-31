import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layoutDiagram, nodeSize, wrapLines, type DiagramLayout } from "../src/diagram/layout.js";
import { checkDiagramRefs, Diagram } from "../src/schema/diagram.js";
import { createFramitServer, type FramitServer } from "../src/server/mcp.js";
import { pathData, routeOrthogonal } from "../src/shared/route.js";
import { applyPatch } from "../src/store/patch.js";
import { Store } from "../src/store/store.js";
import { SYSTEM_CONTEXT, TIERS } from "./fixtures/system-context.js";

const orthogonal = (pts: Array<{ x: number; y: number }>) => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1]!.x) < 0.6 || Math.abs(p.y - pts[i - 1]!.y) < 0.6);
const inside = (b: { x: number; y: number; w: number; h: number }, o: { x: number; y: number; w: number; h: number }) => b.x >= o.x - 0.5 && b.y >= o.y - 0.5 && b.x + b.w <= o.x + o.w + 0.5 && b.y + b.h <= o.y + o.h + 0.5;
const touches = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) => p.x >= b.x - 1 && p.x <= b.x + b.w + 1 && p.y >= b.y - 1 && p.y <= b.y + b.h + 1;

describe("router", () => {
  it("draws straight, Z and avoiding routes", () => {
    const a = { x: 0, y: 0, w: 100, h: 60 };
    expect(routeOrthogonal(a, { x: 200, y: 10, w: 100, h: 60 })).toEqual([{ x: 100, y: 35 }, { x: 200, y: 35 }]);
    // Diagonal: one bend (an L) beats two (a Z).
    const target = { x: 200, y: 200, w: 100, h: 60 };
    const z = routeOrthogonal(a, target);
    expect(orthogonal(z)).toBe(true);
    expect(z).toHaveLength(3);
    expect(touches(z[0]!, a)).toBe(true);
    expect(touches(z.at(-1)!, target)).toBe(true);
    // An obstacle in the middle of the gap pushes the vertical leg aside.
    const b = { x: 400, y: 200, w: 100, h: 60 };
    const wall = { x: 220, y: 0, w: 60, h: 400 };
    const r = routeOrthogonal(a, b, [wall]);
    const crosses = r.some((p, i) => i > 0 && Math.max(p.x, r[i - 1]!.x) > wall.x && Math.min(p.x, r[i - 1]!.x) < wall.x + wall.w && p.y > wall.y && p.y < wall.y + wall.h && p.x === r[i - 1]!.x);
    expect(crosses).toBe(false);
  });

  it("does not turn floating-point noise into diagonal corners", () => {
    expect(pathData([{ x: 10, y: 0 }, { x: 10.0000001, y: 50 }, { x: 10, y: 100 }])).toBe("M10,0 L10,100");
    // Half-pixel rounding from elk (seen in a real layout) is snapped, not rounded as a corner.
    expect(pathData([{ x: 818, y: 532 }, { x: 818, y: 339 }, { x: 876, y: 338.5 }, { x: 899, y: 338.5 }])).toBe("M818,532 L818,347 Q818,339 826,339 L899,339");
  });
});

describe("diagram layout", () => {
  it("estimates text and node sizes", () => {
    expect(wrapLines("one two three", 7)).toBe(2);
    expect(wrapLines("", 10)).toBe(0);
    const plain = nodeSize({ id: "a", label: "API", kind: "service" });
    const rich = nodeSize({ id: "b", label: "API", kind: "service", tech: "Go", description: "A rather long description that wraps onto more lines than one" });
    expect(rich.h).toBeGreaterThan(plain.h + 30);
    expect(nodeSize({ id: "u", label: "User", kind: "actor" }).w).toBeLessThan(plain.w);
  });

  it("lays out the system context: nodes in their group, orthogonal edges, labels", async () => {
    const d = Diagram.parse(SYSTEM_CONTEXT);
    const l = await layoutDiagram(d);
    expect(Object.keys(l.nodes)).toHaveLength(8);
    for (const n of d.nodes.filter((n) => n.group === "framit")) expect(inside(l.nodes[n.id]!, l.groups.framit!)).toBe(true);
    expect(l.edges).toHaveLength(10);
    for (const e of l.edges) {
      expect(orthogonal(e.points)).toBe(true);
      expect(touches(e.points[0]!, l.nodes[e.from]!)).toBe(true);
      expect(touches(e.points.at(-1)!, l.nodes[e.to]!)).toBe(true);
    }
    expect(l.edges.filter((e) => e.label)).toHaveLength(10);
    expect(l.warnings).toEqual([]);
  });

  it("pins nodes, grows their group and re-routes their edges", async () => {
    const d = Diagram.parse({ ...SYSTEM_CONTEXT, nodes: SYSTEM_CONTEXT.nodes.map((n) => (n.id === "store" ? { ...n, position: { x: 900, y: 700 } } : n)) });
    const l: DiagramLayout = await layoutDiagram(d);
    expect(l.nodes.store).toMatchObject({ x: 900, y: 700, pinned: true });
    expect(inside(l.nodes.store!, l.groups.framit!)).toBe(true);
    for (const e of l.edges.filter((e) => e.from === "store" || e.to === "store")) {
      expect(orthogonal(e.points)).toBe(true);
      expect(touches(e.points.at(-1)!, l.nodes.store!)).toBe(true);
    }
  });

  it("stacks lanes as full-width bands", async () => {
    const l = await layoutDiagram(Diagram.parse(TIERS));
    const lanes = ["clients", "services", "data"].map((id) => l.groups[id]!);
    expect(new Set(lanes.map((g) => Math.round(g.w))).size).toBe(1);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]!.y).toBeGreaterThanOrEqual(lanes[i - 1]!.y + lanes[i - 1]!.h);
    for (const n of Diagram.parse(TIERS).nodes.filter((n) => n.group)) expect(inside(l.nodes[n.id]!, l.groups[n.group!]!)).toBe(true);
  });

  it("checks references with hints", () => {
    const base = Diagram.parse(SYSTEM_CONTEXT);
    expect(() => checkDiagramRefs({ ...base, edges: [...base.edges, { from: "mcp", to: "stor", style: "solid" }] })).toThrow(/"stor", which does not exist/);
    expect(() => checkDiagramRefs({ ...base, nodes: [...base.nodes, { id: "x", label: "X", kind: "service", group: "nope" }] })).toThrow(/group "nope"/);
    expect(() => checkDiagramRefs({ ...base, nodes: [...base.nodes, { id: "mcp", label: "dup", kind: "service" }] })).toThrow(/Duplicate node id/);
  });

  it("patches diagram elements by id", () => {
    const doc = { kind: "diagram", revision: 1, updatedAt: "", ...SYSTEM_CONTEXT };
    const next = applyPatch(doc as never, [
      { op: "replace", node: "mcp", path: "/label", value: "MCP" },
      { op: "add", node: "store", path: "/position", value: { x: 1, y: 2 } },
      { op: "replace", node: "e_llm", path: "/label", value: "Messages" },
    ]) as any;
    expect(next.nodes.find((n: any) => n.id === "mcp").label).toBe("MCP");
    expect(next.nodes.find((n: any) => n.id === "store").position).toEqual({ x: 1, y: 2 });
    expect(next.edges.find((e: any) => e.id === "e_llm").label).toBe("Messages");
  });
});

describe("diagram tools", () => {
  let root: string;
  let client: Client;
  let framit: FramitServer;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "framit-dg-"));
    framit = createFramitServer(new Store(root), { screenshots: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0" });
    await Promise.all([framit.mcp.connect(a), client.connect(b)]);
    await call("init_project");
  });
  afterEach(async () => {
    await client.close();
    await framit.close();
    await rm(root, { recursive: true, force: true });
  });
  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text?: string }> };
    const text = res.content[0]?.text ?? "";
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* plain */
    }
    return { isError: !!res.isError, body, text };
  }

  it("writes, reads, patches, lists and deletes diagrams", async () => {
    const { edges, ...rest } = SYSTEM_CONTEXT;
    const w = await call("write_diagram", { diagram: { ...rest, edges: edges.map(({ id: _id, ...e }) => e) }, screenshots: false });
    expect(w.isError).toBe(false);
    expect(w.body.url).toMatch(/\/d\/framit-context$/);
    expect(Object.keys(w.body.layout)).toHaveLength(8);
    expect(w.body.warnings).toEqual([]);
    const r = await call("read_diagram", { id: "framit-context" });
    expect(r.body.document.edges.every((e: any) => /^e_/.test(e.id))).toBe(true);

    const p = await call("patch_diagram", { id: "framit-context", ops: [{ op: "remove", node: "shots" }, { op: "add", path: "/nodes/-", value: { id: "lonely", label: "Lonely", kind: "service" } }], screenshots: false });
    expect(p.isError).toBe(false);
    const after = (await call("read_diagram", { id: "framit-context" })).body.document;
    expect(after.edges.some((e: any) => e.from === "shots" || e.to === "shots")).toBe(false);
    expect(p.body.warnings).toContainEqual(expect.objectContaining({ node: "lonely", message: expect.stringContaining("no edges") }));

    expect((await call("list_diagrams")).body.diagrams).toEqual([expect.objectContaining({ id: "framit-context", nodes: 8 })]);
    expect((await call("delete_diagram", { id: "framit-context" })).isError).toBe(false);
  });

  it("explains mistakes", async () => {
    const bad = await call("write_diagram", { diagram: { name: "X", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "b" }] }, screenshots: false });
    expect(bad.isError).toBe(true);
    expect(bad.body.message).toContain('"b", which does not exist');
    const kind = await call("write_diagram", { diagram: { name: "X", nodes: [{ id: "a", label: "A", kind: "server" }] }, screenshots: false });
    expect(kind.isError).toBe(true);
    expect(kind.text).toContain("service");
    const pair = await call("write_diagram", { diagram: { id: "pair", name: "P", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] }, screenshots: false });
    expect(pair.body.warnings).toContainEqual(expect.objectContaining({ message: expect.stringContaining("bidirectional") }));
  });

  it("documents diagrams in describe_dsl", async () => {
    const r = await call("describe_dsl", { kind: "diagram" });
    expect(r.text).toContain("# Diagrams");
    expect(r.text).toContain("lane");
  });
});
