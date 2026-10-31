import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFramitServer, type FramitServer } from "../src/server/mcp.js";
import { Store } from "../src/store/store.js";

let root: string;
let client: Client;
let framit: FramitServer;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-mcp-"));
  framit = createFramitServer(new Store(root), { screenshots: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([framit.mcp.connect(a), client.connect(b)]);
});
afterEach(async () => {
  await client.close();
  await framit.close();
  await rm(root, { recursive: true, force: true });
});

type Res = { isError: boolean; body: any; text: string; images: number };
async function call(name: string, args: Record<string, unknown> = {}): Promise<Res> {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  const text = res.content[0]?.text ?? "";
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // guides and SDK validation errors are plain text
  }
  return { isError: !!res.isError, body, text, images: res.content.filter((c) => c.type === "image").length };
}

const settings = {
  name: "Account settings",
  frames: [
    {
      device: "desktop",
      root: {
        type: "stack",
        props: { padding: "xl" },
        children: [
          { type: "text", props: { role: "h1", content: "Settings" } },
          { id: "n_save", type: "button", props: { label: "Save", variant: "primary" } },
        ],
      },
    },
    { device: "phone", root: { type: "stack", children: [{ type: "text", props: { content: "Phone" } }] } },
  ],
};

describe("framit MCP server", () => {
  it("advertises the M1–M3 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_theme", "delete_screen", "delete_theme", "describe_dsl", "duplicate_screen", "get_project", "get_theme", "init_project",
        "list_components", "list_screens", "list_themes", "patch_screen", "read_screen", "render", "update_theme", "write_screen",
        "write_flow", "patch_flow", "read_flow", "list_flows", "delete_flow", "export",
      ].sort(),
    );
    expect(client.getInstructions()).toContain("describe_dsl");
  });

  it("initialises idempotently and copies the default starter theme in", async () => {
    expect((await call("get_project")).body.initialized).toBe(false);
    const init = await call("init_project", { name: "Demo" });
    expect(init.body.created).toBe(true);
    await stat(path.join(root, ".framit", "themes", "wire-mid-light.json"));
    expect(await readFile(path.join(root, ".framit", "themes", "wire-mid-light.css"), "utf8")).toContain("--fx-color-accent: #4f5bd5");
    expect((await call("init_project", { name: "Other" })).body).toMatchObject({ created: false, project: { name: "Demo" } });
  });

  it("describes the DSL with the component reference", async () => {
    const r = await call("describe_dsl");
    expect(r.text).toContain("Flow layout only");
    expect(r.text).toContain("### app-shell (container)");
    expect(r.text).toContain("label?: string");
    expect((await call("describe_dsl", { kind: "theme" })).text).toContain("tokens.color");
  });

  it("lists components with examples", async () => {
    const r = await call("list_components", { types: ["button", "toggle"] });
    expect(r.body.components.map((c: any) => c.type).sort()).toEqual(["button", "toggle"]);
    expect(r.body.components[0].example.type).toBeDefined();
    expect((await call("list_components", { types: ["buton"] })).isError).toBe(true);
  });

  describe("screens", () => {
    beforeEach(async () => void (await call("init_project")));

    it("writes a screen, slugs the id, applies the default theme, and serves it", async () => {
      const r = await call("write_screen", { screen: settings });
      expect(r.isError).toBe(false);
      expect(r.body).toMatchObject({ id: "account-settings", revision: 1, theme: "wire-mid-light", changed: true });
      expect(r.body.frames).toHaveLength(2);
      expect(r.body.frames[1]).toMatchObject({ device: "phone", width: 390, height: 844 });
      const html = await (await fetch(r.body.url)).text();
      expect(html).toContain('data-node="n_save"');
      expect(html).toContain("--fx-color-accent");
      const frameHtml = await (await fetch(r.body.frames[0].url)).text();
      expect(frameHtml).toContain('class="fx-frame"');
    });

    it("rejects invalid screens with actionable hints", async () => {
      const bad = structuredClone(settings);
      (bad.frames[0]!.root.children[1] as any).props = { text: "Save" };
      const r = await call("write_screen", { screen: bad });
      expect(r.isError).toBe(true);
      expect(r.body.code).toBe("SCHEMA");
      expect(r.body.hint).toContain("label");
    });

    it("rejects unknown themes", async () => {
      const r = await call("write_screen", { screen: { ...settings, theme: "nope" } });
      expect(r.body.code).toBe("THEME_MISSING");
    });

    it("patches by node id and enforces revisions", async () => {
      await call("write_screen", { screen: settings });
      const p = await call("patch_screen", { id: "account-settings", ops: [{ op: "replace", node: "n_save", path: "/props/label", value: "Save changes" }] });
      expect(p.body.revision).toBe(2);
      const read = await call("read_screen", { id: "account-settings" });
      expect(read.body.document.frames[0].root.children[1].props.label).toBe("Save changes");

      const stale = await call("patch_screen", { id: "account-settings", expectedRevision: 1, ops: [{ op: "remove", node: "n_save" }] });
      expect(stale.body.code).toBe("REVISION");
      expect(stale.body.data.current.revision).toBe(2);

      const invalid = await call("patch_screen", { id: "account-settings", ops: [{ op: "replace", node: "n_save", path: "/props/variant", value: "huge" }] });
      expect(invalid.body.code).toBe("SCHEMA");
      expect((await call("read_screen", { id: "account-settings" })).body.document.revision).toBe(2);
    });

    it("duplicates with fresh node ids and lists screens", async () => {
      await call("write_screen", { screen: settings });
      const d = await call("duplicate_screen", { id: "account-settings", newId: "account-settings-empty" });
      expect(d.isError).toBe(false);
      const copy = (await call("read_screen", { id: "account-settings-empty" })).body.document;
      expect(copy.frames[0].root.children[1].id).not.toBe("n_save");
      const list = await call("list_screens");
      expect(list.body.screens.map((s: any) => s.id)).toEqual(["account-settings", "account-settings-empty"]);
    });
  });

  describe("themes", () => {
    beforeEach(async () => void (await call("init_project")));

    it("creates from a starter, returns notes first, and compiles CSS", async () => {
      const r = await call("create_theme", {
        from: "wire-mid-dark",
        theme: { name: "Fintech Dark", tokens: { color: { accent: "#22c55e" } }, notes: "Green accent for money actions only." },
      });
      expect(r.isError).toBe(false);
      expect(Object.keys(r.body).slice(0, 3)).toEqual(["id", "name", "notes"]);
      expect(r.body).toMatchObject({ id: "fintech-dark", mode: "dark", tokens: { color: { accent: "#22c55e", bg: "#0b0d14" } } });
      expect(await readFile(path.join(root, ".framit", "themes", "fintech-dark.css"), "utf8")).toContain("#22c55e");
      expect((await call("create_theme", { theme: { id: "fintech-dark", name: "x" } })).body.hint).toContain("update_theme");
    });

    it("supports extends, update_theme merges, and guarded deletes", async () => {
      await call("create_theme", { theme: { id: "brand", name: "Brand", extends: "wire-mid-light", tokens: { color: { accent: "#e5484d" } }, notes: "Red brand." } });
      expect((await call("get_theme", { id: "brand", swatch: false })).body.tokens.color).toMatchObject({ accent: "#e5484d", bg: "#f8f9fb" });

      const u = await call("update_theme", { id: "brand", merge: { components: { button: { radius: "pill" } } } });
      expect(u.body.components.button).toEqual({ radius: "pill", height: 36 });

      await call("write_screen", { screen: { ...settings, theme: "brand" } });
      expect((await call("delete_theme", { id: "brand" })).body.code).toBe("SCHEMA");
      expect((await call("delete_theme", { id: "brand", force: true })).body.orphanedScreens).toEqual(["account-settings"]);
    });

    it("lists project themes and starters", async () => {
      const r = await call("list_themes");
      const ids = r.body.themes.map((t: any) => t.id);
      expect(ids).toEqual(expect.arrayContaining(["wire-mid-light", "wire-mid-dark", "wire-lo"]));
      expect(r.body.themes.find((t: any) => t.id === "wire-mid-light").default).toBe(true);
    });
  });
});
