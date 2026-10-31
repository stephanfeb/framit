import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFramitServer, type FramitServer } from "../src/server/mcp.js";
import { Store } from "../src/store/store.js";
import { VERSION } from "../src/version.js";

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
  it("advertises the tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_theme", "delete_screen", "delete_theme", "describe_dsl", "duplicate_screen", "get_project", "get_theme", "init_project",
        "list_components", "list_screens", "list_themes", "patch_screen", "read_screen", "render", "update_theme", "write_screen",
        "write_flow", "patch_flow", "read_flow", "list_flows", "delete_flow", "export",
        "write_diagram", "patch_diagram", "read_diagram", "list_diagrams", "delete_diagram", "lint",
      ].sort(),
    );
    expect(client.getInstructions()).toContain("describe_dsl");
  });

  it("initialises idempotently and copies the default starter theme in", async () => {
    expect((await call("get_project")).body.initialized).toBe(false);
    const init = await call("init_project", { name: "Demo" });
    expect(init.body.created).toBe(true);
    // First run: the model is told where documents live, the preview URL and the screenshot status.
    expect(init.body.previewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(init.body.tell).toContain(init.body.previewUrl);
    expect(init.body.screenshots).toMatch(/^(on, using|unavailable)/);
    await stat(path.join(root, ".framit", "themes", "wire-mid-light.json"));
    expect(await readFile(path.join(root, ".framit", "themes", "wire-mid-light.css"), "utf8")).toContain("--fx-color-accent: #4f5bd5");
    const again = (await call("init_project", { name: "Other" })).body;
    expect(again).toMatchObject({ created: false, project: { name: "Demo" } });
    expect(again.tell).toBeUndefined();
  });

  it("lints the project without screenshots", async () => {
    await call("init_project");
    await call("write_screen", { screen: { id: "a", name: "A", frames: [{ device: "phone", root: { type: "stack", children: [{ type: "input", props: { placeholder: "Email" } }] } }] }, screenshots: false });
    const w = await call("write_screen", { screen: { id: "b", name: "B", frames: [{ device: "phone", root: { type: "text", props: { content: "ok" }, style: { color: "#123456" } } }] }, screenshots: false });
    expect(w.body.warnings).toContainEqual(expect.objectContaining({ rule: "raw-colour" }));
    const all = (await call("lint")).body;
    expect(all.checked).toBe(2);
    expect(all.ok).toBe(false);
    expect(all.issues.map((i: any) => `${i.id}:${i.rule}`).sort()).toEqual(["a:unlabelled-field", "b:raw-colour"]);
    expect((await call("lint", { kind: "screen", id: "a" })).body.issues).toHaveLength(1);
    expect((await call("lint", { id: "a" })).isError).toBe(true);
  });

  it("keeps comments through rewrites and lets the model resolve them", async () => {
    await call("init_project");
    const screen = { id: "c", name: "C", frames: [{ id: "f", device: "phone", root: { id: "n_t", type: "text", props: { content: "Hi" } } }] };
    await call("write_screen", { screen: { ...screen, comments: [{ node: "n_t", text: "Say hello properly" }] }, screenshots: false });
    const p = (await call("get_project")).body;
    expect(p.openComments).toEqual([{ screen: "c", comments: 1 }]);
    const cid = (await call("read_screen", { id: "c" })).body.document.comments[0].id;
    expect(cid).toMatch(/^c_/);
    // A rewrite that omits comments keeps them.
    await call("write_screen", { screen: { ...screen, frames: [{ ...screen.frames[0], root: { id: "n_t", type: "text", props: { content: "Hello there" } } }] }, screenshots: false });
    expect((await call("read_screen", { id: "c" })).body.document.comments).toHaveLength(1);
    const r = await call("patch_screen", { id: "c", screenshots: false, ops: [{ op: "add", node: cid, path: "/resolved", value: true }, { op: "add", node: cid, path: "/replies", value: [{ author: "claude", text: "Done" }] }] });
    expect(r.isError).toBe(false);
    expect((await call("get_project")).body.openComments).toBeUndefined();
    expect((await call("list_screens")).body.screens[0].openComments).toBeUndefined();
    const bad = await call("write_screen", { screen: { ...screen, comments: [{ node: "n_t" }] }, screenshots: false });
    expect(bad.isError).toBe(true);
  });

  it("offers new-theme, wireframe and address-comments prompts", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["address-comments", "new-theme", "wireframe"]);
    const w = await client.getPrompt({ name: "wireframe", arguments: { product: "A habit tracker", screens: "today, stats" } });
    const text = (w.messages[0]!.content as { text: string }).text;
    expect(text).toContain("these screens: today, stats");
    expect(text).toContain("lint");
    expect(text).not.toContain("Propose the list of screens");
    const t = await client.getPrompt({ name: "new-theme", arguments: { mode: "dark", accent: "teal" } });
    const tt = (t.messages[0]!.content as { text: string }).text;
    expect(tt).toContain("- mode: dark");
    expect(tt).toMatch(/missing \(product, fidelity, density, reference\)/);
    expect((await client.getPrompt({ name: "address-comments", arguments: {} })).messages).toHaveLength(1);
  });

  it("reports the same version as package.json", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
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
