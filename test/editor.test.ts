import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PreviewServer } from "../src/server/preview.js";
import { launchChromium } from "../src/server/screenshot.js";
import { Workspace } from "../src/server/workspace.js";
import { Store } from "../src/store/store.js";

// End-to-end tests of the browser editor runtime against a real preview server.

let root: string;
let store: Store;
let preview: PreviewServer;
let url: string;
let browser: Browser | undefined;
let page: Page;

const SCREEN = {
  id: "settings",
  name: "Settings",
  theme: "wire-mid-light",
  frames: [
    {
      id: "f_desk",
      name: "Desktop",
      device: { width: 900, height: 600 },
      root: {
        id: "n_root",
        type: "stack",
        props: { padding: "xl", gap: "lg" },
        children: [
          { id: "n_title", type: "text", props: { role: "h1", content: "Settings" } },
          { id: "n_intro", type: "text", props: { content: "Manage your account." } },
          {
            id: "n_row",
            type: "row",
            children: [
              { id: "n_cancel", type: "button", props: { label: "Cancel", variant: "ghost" } },
              { id: "n_save", type: "button", props: { label: "Save", variant: "primary" } },
            ],
          },
        ],
      },
    },
    { id: "f_phone", name: "Phone", device: "phone", root: { id: "n_proot", type: "stack", props: { padding: "md" }, children: [{ id: "n_ptitle", type: "text", props: { role: "h2", content: "Settings" } }] } },
  ],
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-editor-"));
  store = new Store(root);
  await store.init({ name: "Editor test" });
  const ws = new Workspace(store);
  await ws.themeDoc("wire-mid-light");
  preview = new PreviewServer(ws);
  url = await preview.ensureStarted();
  try {
    browser = await launchChromium();
  } catch {
    browser = undefined;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await preview.close();
  await rm(root, { recursive: true, force: true });
});

beforeEach(async (ctx) => {
  if (!browser) return ctx.skip();
  try {
    await store.delete("screen", "settings");
  } catch {
    /* first run */
  }
  await store.write("screen", SCREEN);
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  page = await context.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err));
  await page.goto(`${url}/s/settings`);
  await page.waitForSelector("body[data-ready='1']");
  // Deterministic view: 100% zoom, origin at a fixed offset.
  await page.evaluate(() => {
    const ed = (window as any).framit;
    ed.viewport.view = { x: 40, y: 40, z: 1 };
    ed.viewport.apply();
  });
});

const doc = async () => store.read("screen", "settings") as Promise<any>;
const saved = () => page.waitForFunction(() => document.getElementById("fx-status")?.textContent?.startsWith("Saved"));
const sel = () => page.evaluate(() => (window as any).framit.selection as string[]);
const node = (id: string) => page.locator(`[data-node="${id}"]`).first();

async function editText(id: string, text: string, prop = "[data-prop]") {
  await node(id).locator(prop).first().dblclick();
  await page.waitForSelector("[contenteditable]");
  await page.keyboard.press("Meta+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await saved();
}

describe("editor", { timeout: 20_000 }, () => {
  it("boots the editor shell with frames at their positions", async () => {
    expect(await page.locator(".fx-frame").count()).toBe(2);
    expect(await page.locator("#fx-inspector").textContent()).toContain("Select something");
  });

  it("selects top-level blocks first, then drills deeper on a second click", async () => {
    await node("n_save").click();
    expect(await sel()).toEqual(["n_row"]);
    await node("n_save").click();
    expect(await sel()).toEqual(["n_save"]);
    await page.keyboard.press("Escape");
    expect(await sel()).toEqual(["n_row"]);
    await node("n_cancel").click({ modifiers: ["Meta"] });
    expect(await sel()).toEqual(["n_cancel"]);
    expect(await page.locator(".fx-toolbar").count()).toBe(1);
    expect(await page.locator("#fx-inspector .fx-insp-type").textContent()).toContain("button");
  });

  it("edits text in place and saves it to the document", async () => {
    await editText("n_title", "Account settings");
    expect((await doc()).frames[0].root.children[0].props.content).toBe("Account settings");
    await editText("n_save", "Save changes");
    expect((await doc()).frames[0].root.children[2].children[1].props.label).toBe("Save changes");
    expect(await node("n_save").textContent()).toBe("Save changes");
  });

  it("cancels a text edit with Escape", async () => {
    await node("n_intro").locator("[data-prop]").dblclick();
    await page.keyboard.type("nope");
    await page.keyboard.press("Escape");
    expect(await node("n_intro").textContent()).toBe("Manage your account.");
    expect((await doc()).revision).toBe(1);
  });

  it("drags a frame by its label and pins the other frames", async () => {
    const label = page.locator('[data-frame-label="f_phone"]');
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 110, box.y + 205, { steps: 5 });
    await page.mouse.up();
    await saved();
    const d = await doc();
    expect(d.frames[0].position).toEqual({ x: 0, y: 0 });
    expect(d.frames[1].position.x - 1020).toBe(100);
    expect(d.frames[1].position.y).toBe(200);
  });

  it("changes a prop from the floating toolbar and undoes it", async () => {
    await node("n_cancel").click({ modifiers: ["Meta"] });
    await page.locator(".fx-toolbar select[title=variant]").selectOption("danger");
    await saved();
    expect((await doc()).frames[0].root.children[2].children[0].props.variant).toBe("danger");
    await expect.poll(() => node("n_cancel").getAttribute("class")).toContain("fx-button--danger");
    await page.keyboard.press("Meta+Z");
    await page.waitForFunction(() => document.querySelector('[data-node="n_cancel"]')?.className.includes("fx-button--ghost"));
    expect((await doc()).frames[0].root.children[2].children[0].props.variant).toBe("ghost");
    await page.keyboard.press("Meta+Shift+Z");
    await page.waitForFunction(() => document.querySelector('[data-node="n_cancel"]')?.className.includes("fx-button--danger"));
  });

  it("edits a prop in the inspector", async () => {
    await node("n_title").click();
    const role = page.locator("#fx-inspector .fx-field-row", { hasText: "role" }).locator("select");
    await role.selectOption("h2");
    await saved();
    expect((await doc()).frames[0].root.children[0].props.role).toBe("h2");
  });

  it("deletes, duplicates and reorders with the keyboard", async () => {
    await node("n_intro").click();
    await page.keyboard.press("Backspace");
    await saved();
    expect((await doc()).frames[0].root.children.map((c: any) => c.id)).toEqual(["n_title", "n_row"]);
    await node("n_title").click();
    await page.keyboard.press("Meta+D");
    await saved();
    const kids = (await doc()).frames[0].root.children;
    expect(kids).toHaveLength(3);
    expect(kids[1].props.content).toBe("Settings");
    expect(kids[1].id).not.toBe("n_title");
    await page.keyboard.press("Alt+ArrowDown");
    await saved();
    expect((await doc()).frames[0].root.children[2].props.content).toBe("Settings");
  });

  it("drags a node to reorder it within its container", async () => {
    await node("n_save").click();
    await node("n_save").click();
    expect(await sel()).toEqual(["n_save"]);
    const from = (await node("n_save").boundingBox())!;
    const to = (await node("n_cancel").boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();
    await saved();
    expect((await doc()).frames[0].root.children[2].children.map((c: any) => c.id)).toEqual(["n_save", "n_cancel"]);
  });

  it("inserts a component from the palette", async () => {
    await node("n_row").click();
    await page.keyboard.press("/");
    await page.keyboard.type("badge");
    await page.keyboard.press("Enter");
    await saved();
    const row = (await doc()).frames[0].root.children[2];
    expect(row.children.map((c: any) => c.type)).toEqual(["button", "button", "badge"]);
    await expect.poll(() => sel()).toEqual([row.children[2].id]);
  });

  it("resizes a frame with its handle", async () => {
    await page.locator('[data-frame-label="f_desk"]').click();
    const handle = page.locator('.fx-ov-handle[data-h="e"]');
    const b = (await handle.boundingBox())!;
    await page.mouse.move(b.x + 4, b.y + 4);
    await page.mouse.down();
    await page.mouse.move(b.x + 104, b.y + 4, { steps: 4 });
    await page.mouse.up();
    await saved();
    expect((await doc()).frames[0].device.width).toBe(1000);
  });

  it("shows changes made by Claude without a reload", async () => {
    const d = await doc();
    d.frames[0].root.children[0].props.content = "Changed by the model";
    await store.write("screen", d, { source: "mcp" });
    await page.waitForFunction(() => document.querySelector('[data-node="n_title"]')?.textContent === "Changed by the model");
    expect(await page.locator(".fx-toast").first().textContent()).toContain("Updated by Claude");
  });

  it("lets form controls work in preview mode", async () => {
    const { doc: written } = await store.write("screen", { ...SCREEN, frames: [{ ...SCREEN.frames[0], root: { id: "n_r", type: "stack", children: [{ id: "n_in", type: "input", props: { label: "Name" } }] } }] });
    await page.reload();
    await page.waitForSelector("body[data-ready='1']");
    await page.keyboard.press("p");
    await page.locator('[data-node="n_in"] input').fill("Ada");
    expect(await page.locator('[data-node="n_in"] input').inputValue()).toBe("Ada");
    expect((await doc()).revision).toBe(written.revision);
  });

  it("rejects cross-origin writes", async () => {
    const res = await fetch(`${url}/api/doc/screen/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ ops: [{ op: "remove", node: "n_title" }] }),
    });
    expect(res.status).toBe(403);
  });
});

describe("M2 acceptance", () => {
  it("browser edits (three labels and a frame move) are what a new MCP session reads", { timeout: 60_000 }, async () => {
    await editText("n_title", "Account");
    await editText("n_cancel", "Discard");
    await editText("n_save", "Save profile");
    const label = page.locator('[data-frame-label="f_phone"]');
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 10, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 305, { steps: 5 });
    await page.mouse.up();
    await saved();

    // A brand-new server process on the same project = a new session.
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createFramitServer } = await import("../src/server/mcp.js");
    const fresh = createFramitServer(new Store(root), { screenshots: false });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "new-session", version: "0" });
    await Promise.all([fresh.mcp.connect(a), client.connect(b)]);
    const res = (await client.callTool({ name: "read_screen", arguments: { id: "settings" } })) as { content: Array<{ text: string }> };
    const read = JSON.parse(res.content[0]!.text).document;
    await client.close();
    await fresh.close();

    const desk = read.frames[0].root.children;
    expect(desk[0].props.content).toBe("Account");
    expect(desk[2].children.map((c: any) => c.props.label)).toEqual(["Discard", "Save profile"]);
    expect(read.frames[1].position).toEqual({ x: 1020 + 50, y: 300 });
    expect(read.revision).toBe(5);
  });
});
