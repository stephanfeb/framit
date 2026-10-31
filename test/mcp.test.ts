import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/server/mcp.js";
import { Store } from "../src/store/store.js";

let root: string;
let client: Client;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-mcp-"));
  const server = createMcpServer(new Store(root));
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterEach(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };
  const text = res.content[0]!.text;
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // SDK-level validation errors are plain text.
  }
  return { isError: !!res.isError, body };
}

describe("framit MCP server", () => {
  it("advertises the M0 tools with instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["describe_dsl", "get_project", "init_project"]);
    expect(client.getInstructions()).toContain("init_project");
  });

  it("reports an uninitialised project, then initialises it idempotently", async () => {
    const before = await call("get_project");
    expect(before.body).toMatchObject({ initialized: false, root });

    const init = await call("init_project", { name: "Demo" });
    expect(init.isError).toBe(false);
    expect(init.body.created).toBe(true);
    await stat(path.join(root, ".framit", "project.json"));

    const again = await call("init_project", { name: "Other" });
    expect(again.body).toMatchObject({ created: false, project: { name: "Demo" } });

    const after = await call("get_project");
    expect(after.body).toMatchObject({
      initialized: true,
      project: { name: "Demo", defaultTheme: "wire-mid-light" },
      counts: { screen: 0, theme: 0, diagram: 0, flow: 0 },
    });
  });

  it("describes the DSL with JSON Schema for screens and themes", async () => {
    const all = await call("describe_dsl");
    expect(all.body.status).toBe("stub");
    expect(all.body.schemas.screen.type).toBe("object");
    expect(all.body.schemas.screen.required).toEqual(expect.arrayContaining(["id", "name", "theme", "frames"]));
    expect(all.body.schemas.theme.required).toEqual(expect.arrayContaining(["tokens", "notes"]));
    expect(all.body.schemas.diagram).toBe("not yet available");

    const one = await call("describe_dsl", { kind: "screen" });
    expect(Object.keys(one.body.schemas)).toEqual(["screen"]);
  });

  it("returns structured tool errors", async () => {
    const invalid = await call("describe_dsl", { kind: "spreadsheet" });
    expect(invalid.isError).toBe(true);
    expect(String(invalid.body)).toMatch(/kind/);

    // Framit errors carry a code and a hint.
    const store = new Store(root);
    const err = await store.read("screen", "nope").catch((e) => e);
    expect(err.toJSON()).toMatchObject({ code: "NOT_INITIALIZED", hint: expect.stringContaining("init_project") });
  });
});
