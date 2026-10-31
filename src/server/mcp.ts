import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FramitError } from "../errors.js";
import { DSL_KINDS, GUIDE_STUB, jsonSchemaFor } from "../schema/index.js";
import type { Store } from "../store/store.js";
import { VERSION } from "../version.js";

const INSTRUCTIONS = `Framit turns descriptions into editable, themed wireframes stored in .framit/ in the
current project. Start a session with get_project; if it is not initialised, call init_project.
Call describe_dsl once per session before writing documents.`;

/** Wrap a handler so results become JSON text and FramitErrors become MCP tool errors. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const value = await fn(args);
      return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
    } catch (err) {
      const payload =
        err instanceof FramitError
          ? err.toJSON()
          : { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  };
}

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer({ name: "framit", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "init_project",
    {
      title: "Initialise Framit project",
      description:
        "Create the .framit/ store in the current project so themes, screens, diagrams and flows can be saved. " +
        "Safe to call repeatedly: an existing project is returned unchanged.",
      inputSchema: {
        name: z.string().min(1).optional().describe("Project name. Defaults to the directory name."),
        theme: z.string().optional().describe('Default theme id for new screens. Defaults to "wire-mid-light".'),
      },
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    tool(async ({ name, theme }: { name?: string; theme?: string }) => {
      const { project, created } = await store.init({ name, defaultTheme: theme });
      return { created, root: store.root, store: store.base, project };
    }),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Framit project",
      description:
        "Return project metadata, document counts, and the preview server URL if running. " +
        "Call this first in a session; if `initialized` is false, call init_project.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      if (!(await store.isInitialized())) {
        return { initialized: false, root: store.root, hint: "Call init_project to create .framit/ here." };
      }
      return {
        initialized: true,
        root: store.root,
        project: await store.getProject(),
        counts: await store.counts(),
        previewUrl: null, // preview server arrives in M1 (framit-1fa.6)
      };
    }),
  );

  server.registerTool(
    "describe_dsl",
    {
      title: "Describe the Framit DSL",
      description:
        "Return the JSON Schema and authoring guide for Framit documents. Call once per session before " +
        "writing any screen, theme, diagram or flow. Pass `kind` to get one schema; omit it for all.",
      inputSchema: {
        kind: z.enum(DSL_KINDS).optional().describe("Document kind to describe."),
      },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ kind }: { kind?: (typeof DSL_KINDS)[number] }) => {
      const kinds = kind ? [kind] : DSL_KINDS;
      const schemas = Object.fromEntries(kinds.map((k) => [k, jsonSchemaFor(k) ?? "not yet available"]));
      return { status: "stub", version: VERSION, guide: GUIDE_STUB, schemas };
    }),
  );

  return server;
}
