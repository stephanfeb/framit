import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flowEdges, reachableScreens, screenHotspots } from "../src/schema/flow.js";
import { exportPath } from "../src/server/export.js";
import { createFramitServer, type FramitServer } from "../src/server/mcp.js";
import { Store } from "../src/store/store.js";
import { ALL_SET, ONBOARDING_FLOW, VERIFY, WELCOME } from "./fixtures/onboarding.js";

describe("hotspots and flow edges", () => {
  it("finds `to` props on nodes and on items inside props", () => {
    const doc = {
      frames: [
        {
          id: "f1",
          root: {
            id: "r",
            type: "stack",
            children: [
              { id: "b", type: "button", props: { label: "Go", to: "two" } },
              { id: "nav", type: "nav", props: { items: [{ label: "Home" }, { label: "Billing", to: "billing" }] } },
              { id: "l", type: "list", props: { items: [{ title: "Row", to: "detail" }] } },
            ],
          },
        },
        { id: "f2", root: { id: "r2", type: "button", props: { label: "Other", to: "three" } } },
      ],
    };
    expect(screenHotspots(doc).map((h) => `${h.node}>${h.to}`)).toEqual(["b>two", "nav>billing", "l>detail", "r2>three"]);
    expect(screenHotspots(doc, "f2").map((h) => h.to)).toEqual(["three"]);
    expect(screenHotspots(doc)[0]!.text).toBe("Go");
  });

  it("derives edges between steps, merges labels from explicit edges and reports hotspots leaving the flow", () => {
    const hs: Record<string, Array<{ node: string; to: string }>> = {
      a: [{ node: "n1", to: "b" }, { node: "n2", to: "elsewhere" }],
      b: [{ node: "n3", to: "a" }],
    };
    const { edges, outside } = flowEdges(
      { steps: [{ screen: "a" }, { screen: "b" }], edges: [{ from: { screen: "a", node: "n1" }, to: "b", label: "Next" }, { from: { screen: "b", node: "n9" }, to: "a" }] },
      (s) => hs[s] ?? [],
    );
    expect(edges).toEqual([
      { from: { screen: "a", node: "n1" }, to: "b", label: "Next", explicit: false },
      { from: { screen: "b", node: "n3" }, to: "a", label: undefined, explicit: false },
      { from: { screen: "b", node: "n9" }, to: "a", label: undefined, explicit: true },
    ]);
    expect(outside.map((o) => o.to)).toEqual(["elsewhere"]);
  });

  it("collects reachable screens breadth first and reports missing targets", async () => {
    const docs: Record<string, any> = { welcome: WELCOME, "verify-email": VERIFY, "all-set": ALL_SET };
    const r = await reachableScreens(["welcome"], async (id) => docs[id]);
    expect(r.order).toEqual(["welcome", "verify-email", "all-set"]);
    expect(r.missing).toEqual([]);
    const lonely = await reachableScreens(["all-set"], async (id) => docs[id], { "all-set": { a_done: "dashboard" } });
    expect(lonely.missing).toEqual([{ screen: "all-set", node: "a_done", to: "dashboard" }]);
  });

  it("keeps export paths inside the project", () => {
    const root = "/proj";
    expect(exportPath(root, "/proj/.framit", { kind: "flow", id: "x" }, "html")).toBe("/proj/.framit/exports/flow-x.html");
    expect(exportPath(root, "/proj/.framit", { kind: "screen", id: "x" }, "png")).toBe("/proj/.framit/exports/x");
    expect(exportPath(root, "/proj/.framit", { kind: "screen", id: "x" }, "pdf", "design/x.pdf")).toBe("/proj/design/x.pdf");
    expect(() => exportPath(root, "/proj/.framit", { kind: "screen", id: "x" }, "html", "../x.html")).toThrow(/outside the project/);
    expect(() => exportPath(root, "/proj/.framit", { kind: "screen", id: "x" }, "html", "/etc/x.html")).toThrow(/outside the project/);
    expect(() => exportPath(root, "/proj/.framit", { kind: "screen", id: "x" }, "html", "x.pdf")).toThrow(/must end in .html/);
  });
});

describe("flow tools", () => {
  let root: string;
  let client: Client;
  let framit: FramitServer;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "framit-flow-"));
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
      /* plain text */
    }
    return { isError: !!res.isError, body, text };
  }
  const writeScreens = async () => {
    for (const s of [WELCOME, VERIFY, ALL_SET]) expect((await call("write_screen", { screen: s, screenshots: false })).isError).toBe(false);
  };

  it("writes, reads, lists, patches and deletes a flow", async () => {
    await writeScreens();
    const w = await call("write_flow", { flow: ONBOARDING_FLOW, screenshots: false });
    expect(w.isError).toBe(false);
    expect(w.body.steps.map((s: any) => `${s.screen}:${s.frame}`)).toEqual(["welcome:f_phone", "verify-email:f_phone", "all-set:f_phone"]);
    expect(w.body.edges).toContainEqual({ from: "welcome/w_cta", to: "verify-email", label: "Tap Get started", explicit: true });
    expect(w.body.edges).toContainEqual({ from: "verify-email/v_done", to: "all-set" });
    expect(w.body.playUrl).toMatch(/\/p\/flow\/onboarding$/);
    expect(w.body.warnings).toEqual([]);

    const list = await call("list_flows");
    expect(list.body.flows).toEqual([expect.objectContaining({ id: "onboarding", steps: ["welcome", "verify-email", "all-set"] })]);

    const p = await call("patch_flow", { id: "onboarding", ops: [{ op: "remove", path: "/edges/0" }], screenshots: false });
    expect(p.isError).toBe(false);
    expect(p.body.revision).toBe(2);
    expect(p.body.warnings).toEqual([expect.objectContaining({ screen: "verify-email", message: expect.stringContaining("no hotspot leading to it") })]);

    const r = await call("read_flow", { id: "onboarding" });
    expect(r.body.document.edges).toEqual([]);

    expect((await call("delete_flow", { id: "onboarding" })).isError).toBe(false);
    expect((await call("list_flows")).body.flows).toEqual([]);
  });

  it("rejects missing screens, missing frames and repeated steps with hints", async () => {
    await writeScreens();
    const missing = await call("write_flow", { flow: { name: "X", steps: [{ screen: "welcome" }, { screen: "nope" }] }, screenshots: false });
    expect(missing.isError).toBe(true);
    expect(missing.body.code).toBe("NOT_FOUND");
    expect(missing.body.hint).toContain("welcome");
    const frame = await call("write_flow", { flow: { name: "X", steps: [{ screen: "welcome", frame: "f_watch" }] }, screenshots: false });
    expect(frame.body.hint).toContain("f_desk");
    const twice = await call("write_flow", { flow: { name: "X", steps: [{ screen: "welcome" }, { screen: "welcome" }] }, screenshots: false });
    expect(twice.body.message).toContain("twice");
  });

  it("warns about hotspots that lead nowhere and flows broken by deleting a screen", async () => {
    const w = await call("write_screen", { screen: WELCOME, screenshots: false });
    expect(w.body.warnings).toContainEqual(expect.objectContaining({ node: "w_dcta", message: expect.stringContaining('"verify-email", which is not a screen') }));
    await call("write_flow", { flow: { name: "Solo", steps: [{ screen: "welcome" }] }, screenshots: false });
    const d = await call("delete_screen", { id: "welcome" });
    expect(d.body.brokenFlows).toEqual(["solo"]);
  });

  it("documents flows in describe_dsl", async () => {
    const r = await call("describe_dsl", { kind: "flow" });
    expect(r.text).toContain("# Flows");
    expect(r.text).toContain("`to`");
  });
});
