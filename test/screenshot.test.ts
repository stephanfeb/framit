import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFramitServer, type FramitServer } from "../src/server/mcp.js";
import { Store } from "../src/store/store.js";

// Real browser end to end. Needs Playwright's Chromium or an installed Chrome/Edge.
let root: string;
let client: Client;
let framit: FramitServer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-shot-"));
  framit = createFramitServer(new Store(root), { screenshots: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([framit.mcp.connect(a), client.connect(b)]);
  await client.callTool({ name: "init_project", arguments: {} });
});
afterAll(async () => {
  await client.close();
  await framit.close();
  await rm(root, { recursive: true, force: true });
});

it("returns one PNG per frame and reports horizontal overflow", { timeout: 60_000 }, async () => {
  const res = (await client.callTool({
    name: "write_screen",
    arguments: {
      screen: {
        name: "Overflow",
        frames: [
          { device: "phone", root: { type: "stack", props: { padding: "md" }, children: [{ id: "n_wide", type: "row", children: [{ type: "text", props: { content: "x" }, style: { minWidth: 900 } }] }] } },
          { device: "desktop", root: { type: "text", props: { content: "Desktop" } } },
        ],
      },
    },
  })) as { content: Array<{ type: string; text?: string; data?: string }> };
  const data = JSON.parse(res.content[0]!.text!);
  const images = res.content.filter((c) => c.type === "image");
  if (data.warnings.some((w: any) => /Screenshot unavailable/.test(w.message))) {
    console.warn("No browser available; skipping screenshot assertions.");
    return;
  }
  expect(images).toHaveLength(2);
  expect(Buffer.from(images[0]!.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
  // The text (not its width-constrained row) is the outermost element spilling out.
  expect(data.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ node: expect.stringMatching(/^n_/), message: expect.stringMatching(/^text overflows the frame by \d+px/) })]));
});

it("keeps image tokens down: phones at 1x, patches show only touched frames, at most four shots", { timeout: 60_000 }, async () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string; data?: string }> };
    return { data: JSON.parse(res.content[0]!.text!), images: res.content.filter((c) => c.type === "image") };
  };
  const frame = (id: string, device: string) => ({ id, device, root: { type: "text", props: { content: id } } });
  const w = await call("write_screen", { screen: { id: "many", name: "Many", frames: [frame("f_a", "phone"), frame("f_b", "phone"), frame("f_c", "desktop"), frame("f_d", "tablet"), frame("f_e", "phone")] } });
  if (w.data.warnings.some((x: any) => /Screenshot unavailable/.test(x.message))) return;
  expect(w.images).toHaveLength(4);
  expect(w.data.warnings).toContainEqual(expect.objectContaining({ message: expect.stringContaining("f_e") }));
  // PNG width lives at byte 16 of the IHDR chunk: a 390px phone frame is 390px wide, not 780.
  expect(Buffer.from(w.images[0]!.data!, "base64").readUInt32BE(16)).toBe(390);

  const p = await call("patch_screen", { id: "many", ops: [{ op: "replace", path: "/frames/1/root/props/content", value: "changed" }] });
  expect(p.images).toHaveLength(1);
  expect(p.data.screenshotted).toEqual(["f_b"]);
  expect(p.data.frames).toHaveLength(5);
  const noop = await call("patch_screen", { id: "many", ops: [{ op: "replace", path: "/frames/1/root/props/content", value: "changed" }] });
  expect(noop.images).toHaveLength(0);
});

it("lint finds cut-off text in the browser without returning images", { timeout: 60_000 }, async () => {
  await client.callTool({ name: "write_screen", arguments: { screenshots: false, screen: { id: "trunc", name: "T", frames: [{ device: "phone", root: { type: "list", props: { items: [{ title: "A remarkably long list item title that will never fit on one phone line" }] } } }] } } });
  const res = (await client.callTool({ name: "lint", arguments: { kind: "screen", id: "trunc" } })) as { content: Array<{ type: string; text?: string }> };
  expect(res.content.filter((c) => c.type === "image")).toHaveLength(0);
  const data = JSON.parse(res.content[0]!.text!);
  if (data.notes?.some((n: string) => /skipped/.test(n))) return;
  expect(data.issues).toContainEqual(expect.objectContaining({ rule: "layout", message: expect.stringContaining("cut off with an ellipsis") }));
});

it("anchors a modal to the frame even when nested in a card", { timeout: 60_000 }, async () => {
  const res = (await client.callTool({ name: "write_screen", arguments: { screen: { id: "dlg", name: "Dlg", frames: [{ id: "f_dlg", device: "desktop", root: { type: "stack", props: { padding: "xl" }, children: [{ type: "card", props: { title: "Danger zone" }, children: [{ id: "n_modal", type: "modal", props: { title: "Delete?", actions: [{ label: "Delete", variant: "danger" }] } }] }] } }] } } })) as { content: Array<{ type: string; text?: string }> };
  const data = JSON.parse(res.content[0]!.text!);
  if (data.warnings.some((w: any) => /Screenshot unavailable/.test(w.message))) return;
  await framit.shots.withPage({ width: 1440, height: 900 }, async (page) => {
    await page.goto(`${data.frames[0].url}`);
    const box = await page.locator('[data-node="n_modal"]').boundingBox();
    const frame = await page.locator(".fx-frame").boundingBox();
    expect(box).toBeTruthy();
    // Centred in the 1440×900 viewport of the frame, not inside the card.
    expect(Math.abs(box!.x + box!.width / 2 - (frame!.x + 720))).toBeLessThan(2);
    expect(Math.abs(box!.y + box!.height / 2 - (frame!.y + 450))).toBeLessThan(2);
  });
});

it("draws lo-fi frames as a sketch: mono type, hand-drawn outlines, crisp text", { timeout: 60_000 }, async () => {
  const res = (await client.callTool({ name: "write_screen", arguments: { screenshots: false, screen: { id: "lo", name: "Lo", theme: "wire-lo", frames: [{ id: "f_lo", device: "phone", root: { type: "card", props: { title: "Card" }, children: [{ id: "n_cb", type: "checkbox", props: { label: "Plain" } }] } }] } } })) as { content: Array<{ text?: string }> };
  const data = JSON.parse(res.content[0]!.text!);
  try {
    await framit.shots.withPage({ width: 390, height: 844 }, async (page) => {
      await page.goto(data.frames[0].url);
      const s = await page.evaluate(() => {
        const card = document.querySelector(".fx-card")!;
        const after = getComputedStyle(card, "::after"), before = getComputedStyle(card, "::before");
        return { font: getComputedStyle(document.querySelector(".fx-frame")!).fontFamily, border: getComputedStyle(card).borderTopColor, after: after.borderTopStyle, radius: after.borderTopLeftRadius, before: before.transform, box: getComputedStyle(document.querySelector(".fx-check-box")!, "::after").content };
      });
      expect(s.font).toContain("JetBrains Mono");
      expect(s.border).toBe("rgba(0, 0, 0, 0)");
      expect(s.after).toBe("solid");
      expect(s.radius).not.toBe("0px");
      expect(s.before).not.toBe("none"); // the second, rotated pass
      expect(s.box).toBe("none"); // small controls keep their plain border
    });
  } catch (err) {
    if (/No Chromium-based browser/.test(String(err))) return;
    throw err;
  }
});
