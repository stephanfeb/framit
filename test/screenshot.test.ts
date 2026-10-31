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
