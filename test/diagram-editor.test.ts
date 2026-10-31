import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { layoutDiagram } from "../src/diagram/layout.js";
import { Diagram } from "../src/schema/diagram.js";
import { runExport } from "../src/server/export.js";
import { createFramitServer } from "../src/server/mcp.js";
import { PreviewServer } from "../src/server/preview.js";
import { launchChromium, Screenshotter } from "../src/server/screenshot.js";
import { Workspace } from "../src/server/workspace.js";
import { Store } from "../src/store/store.js";
import { SYSTEM_CONTEXT } from "./fixtures/system-context.js";

// The diagram editor in a real browser, plus diagram export and the M4 acceptance check.

let root: string;
let store: Store;
let ws: Workspace;
let preview: PreviewServer;
let shots: Screenshotter;
let url: string;
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-dge-"));
  store = new Store(root);
  await store.init({ name: "Diagram test" });
  ws = new Workspace(store);
  await ws.themeDoc("wire-mid-light");
  preview = new PreviewServer(ws);
  url = await preview.ensureStarted();
  shots = new Screenshotter();
  try {
    browser = await launchChromium();
  } catch {
    browser = undefined;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await shots.close();
  await preview.close();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  try {
    await store.delete("diagram", SYSTEM_CONTEXT.id);
  } catch {
    /* first run */
  }
  await store.write("diagram", SYSTEM_CONTEXT);
});
afterEach(async () => {
  await context?.close().catch(() => undefined);
});

async function open() {
  context = await browser!.newContext({ viewport: { width: 1600, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err));
  await page.goto(`${url}/d/${SYSTEM_CONTEXT.id}`);
  await page.waitForSelector("body[data-ready='1']");
  await page.evaluate(() => {
    const ed = (window as any).framitDiagram;
    ed.viewport.view = { x: 20, y: 20, z: 0.6 };
    ed.viewport.apply();
  });
}
const doc = async () => (await store.read("diagram", SYSTEM_CONTEXT.id)) as any;
const saved = () => page.waitForFunction(() => document.getElementById("fx-status")?.textContent?.startsWith("Saved"));
const nodeEl = (id: string) => page.locator(`[data-dnode="${id}"]`);
const center = async (id: string) => {
  const b = (await nodeEl(id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

describe("diagram editor", { timeout: 30_000 }, () => {
  it("drags a node to pin it, and the board follows", async (ctx) => {
    if (!browser) return ctx.skip();
    await open();
    const before = (await layoutDiagram(Diagram.parse(SYSTEM_CONTEXT))).nodes.store!;
    const c = await center("store");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 60, { steps: 6 });
    await page.mouse.move(c.x, c.y + 120, { steps: 6 });
    await page.mouse.up();
    await saved();
    const pos = (await doc()).nodes.find((n: any) => n.id === "store").position;
    expect(pos.x).toBeCloseTo(before.x, -1);
    expect(pos.y).toBeCloseTo(before.y + 200, -1);
    await expect.poll(() => nodeEl("store").getAttribute("class")).toContain("is-pinned");
    expect(await page.locator("[data-field]").first().count()).toBe(1);
  });

  it("connects two nodes by dragging the port, then labels the arrow", async (ctx) => {
    if (!browser) return ctx.skip();
    await open();
    await nodeEl("model").click();
    const port = (await page.locator(".fx-ov-port").boundingBox())!;
    const target = await center("store");
    await page.mouse.move(port.x + 7, port.y + 7);
    await page.mouse.down();
    await page.mouse.move(target.x - 40, target.y, { steps: 8 });
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await page.mouse.up();
    await saved();
    const added = (await doc()).edges.find((e: any) => e.from === "model" && e.to === "store");
    expect(added).toBeTruthy();
    const label = page.locator('#fx-inspector [data-field="label"]');
    await expect.poll(() => label.evaluate((el) => el === document.activeElement)).toBe(true);
    await label.fill("Reads docs");
    await label.press("Enter");
    await saved();
    expect((await doc()).edges.find((e: any) => e.id === added.id).label).toBe("Reads docs");
    await expect.poll(() => page.locator(`[data-dedge-label="${added.id}"]`).textContent()).toBe("Reads docs");
  });

  it("edits text in place and undoes it", async (ctx) => {
    if (!browser) return ctx.skip();
    await open();
    await nodeEl("mcp").locator(".fx-dg-label").dblclick();
    await page.waitForSelector("[contenteditable]");
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("Framit server");
    await page.keyboard.press("Enter");
    await saved();
    expect((await doc()).nodes.find((n: any) => n.id === "mcp").label).toBe("Framit server");
    await page.locator('[data-dedge-label="e_tools"] [data-prop]').dblclick();
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("stdio");
    await page.keyboard.press("Enter");
    await saved();
    expect((await doc()).edges.find((e: any) => e.id === "e_tools").label).toBe("stdio");
    await page.keyboard.press("Meta+Z");
    await expect.poll(async () => (await doc()).edges.find((e: any) => e.id === "e_tools").label).toBe("MCP over stdio");
  });

  it("deletes a node with its edges, and undo brings both back", async (ctx) => {
    if (!browser) return ctx.skip();
    await open();
    await nodeEl("shots").click();
    await page.keyboard.press("Backspace");
    await saved();
    let d = await doc();
    expect(d.nodes.some((n: any) => n.id === "shots")).toBe(false);
    expect(d.edges.some((e: any) => e.from === "shots" || e.to === "shots")).toBe(false);
    await page.keyboard.press("Meta+Z");
    await expect.poll(async () => (await doc()).edges.length).toBe(10);
    d = await doc();
    expect(d.nodes.map((n: any) => n.id)).toContain("shots");
  });

  it("changes a node in the inspector and auto-layout removes pins", async (ctx) => {
    if (!browser) return ctx.skip();
    const d = await doc();
    d.nodes.find((n: any) => n.id === "store").position = { x: 10, y: 600 };
    await store.write("diagram", d);
    await open();
    await nodeEl("store").click();
    await page.locator('#fx-inspector [data-field="kind"]').selectOption("database");
    await saved();
    expect((await doc()).nodes.find((n: any) => n.id === "store").kind).toBe("database");
    await expect.poll(() => nodeEl("store").getAttribute("data-kind")).toBe("database");
    await page.locator("#fx-tidy").click();
    await expect.poll(async () => (await doc()).nodes.some((n: any) => n.position)).toBe(false);
  });

  it("shows changes made by Claude without a reload", async (ctx) => {
    if (!browser) return ctx.skip();
    await open();
    const d = await doc();
    d.nodes.find((n: any) => n.id === "browser").label = "Editor tab";
    await store.write("diagram", d, { source: "mcp" });
    await expect.poll(() => nodeEl("browser").locator(".fx-dg-label").textContent()).toBe("Editor tab");
    expect(await page.locator(".fx-toast").first().textContent()).toContain("Updated by Claude");
  });

  it("exports a diagram as PNG, PDF and HTML", async (ctx) => {
    if (!browser) return ctx.skip();
    const png = await runExport({ ws, preview, shots }, { kind: "diagram", id: SYSTEM_CONTEXT.id }, "png");
    expect((await readFile(png.files[0]!.path)).subarray(1, 4).toString()).toBe("PNG");
    const pdf = await runExport({ ws, preview, shots }, { kind: "diagram", id: SYSTEM_CONTEXT.id }, "pdf");
    expect((await readFile(pdf.files[0]!.path, "latin1")).match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(1);
    const html = await runExport({ ws, preview, shots }, { kind: "diagram", id: SYSTEM_CONTEXT.id }, "html");
    const text = await readFile(html.files[0]!.path, "utf8");
    expect(text).toContain("data:font/woff2;base64,");
    expect(text).not.toContain('url("/assets/');
  });
});

describe("M4 acceptance", () => {
  it("a model draws this repo's system context; a person tidies it; the next session reads the tidy version", { timeout: 60_000 }, async (ctx) => {
    if (!browser) return ctx.skip();
    await store.delete("diagram", SYSTEM_CONTEXT.id);

    // 1. The model's session writes the diagram and gets a screenshot back.
    const connect = async () => {
      const fx = createFramitServer(new Store(root), { screenshots: true });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "session", version: "0" });
      await Promise.all([fx.mcp.connect(a), client.connect(b)]);
      return { fx, client };
    };
    const s1 = await connect();
    const { edges, ...rest } = SYSTEM_CONTEXT;
    const w = (await s1.client.callTool({ name: "write_diagram", arguments: { diagram: { ...rest, edges } } })) as { content: Array<{ type: string; text?: string }> };
    const body = JSON.parse(w.content[0]!.text!);
    expect(body.warnings).toEqual([]);
    expect(w.content.filter((c) => c.type === "image")).toHaveLength(1);
    await s1.client.close();
    await s1.fx.close();

    // 2. A person tidies it: moves the store under the MCP server, renames a node, relabels an arrow.
    await open();
    const mcp = (await nodeEl("mcp").boundingBox())!;
    const c = await center("store");
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(mcp.x + 40, mcp.y + mcp.height + 140, { steps: 12 });
    await page.mouse.up();
    await saved();
    await nodeEl("model").locator(".fx-dg-label").dblclick();
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("Claude (model)");
    await page.keyboard.press("Enter");
    await saved();
    await page.locator('[data-dedge="e_start"] .fx-dg-edge-hit').dispatchEvent("pointerdown", { button: 0, bubbles: true });
    const label = page.locator('#fx-inspector [data-field="label"]');
    await label.fill("Starts on first render");
    await label.press("Enter");
    await saved();

    // 3. A new session reads exactly that.
    const s2 = await connect();
    const r = (await s2.client.callTool({ name: "read_diagram", arguments: { id: SYSTEM_CONTEXT.id } })) as { content: Array<{ text: string }> };
    const read = JSON.parse(r.content[0]!.text);
    await s2.client.close();
    await s2.fx.close();
    const storeNode = read.document.nodes.find((n: any) => n.id === "store");
    expect(storeNode.position).toBeDefined();
    expect(read.layout.store.pinned).toBe(true);
    expect(read.layout.store.y).toBeGreaterThan(read.layout.mcp.y + read.layout.mcp.h);
    expect(read.document.nodes.find((n: any) => n.id === "model").label).toBe("Claude (model)");
    expect(read.document.edges.find((e: any) => e.id === "e_start").label).toBe("Starts on first render");
    expect(read.document.edges).toHaveLength(10);
  });
});
