import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { COMPONENTS } from "../components/index.js";
import { FramitError } from "../errors.js";
import { placeFrames, renderScreenPage, type RenderWarning } from "../renderer/render.js";
import { componentReference, propLines, SCREEN_GUIDE, THEME_GUIDE, TYPE_LEGEND } from "../schema/guide.js";
import { Screen, validate } from "../schema/screen.js";
import { ResolvedTheme, deepMerge } from "../schema/theme.js";
import { slugify } from "../store/ids.js";
import { walkScreenNodes } from "../store/nodes.js";
import { applyPatch, PatchOp } from "../store/patch.js";
import type { Store } from "../store/store.js";
import { BUILTIN_THEMES } from "../themes/builtin.js";
import { VERSION } from "../version.js";
import { PreviewServer } from "./preview.js";
import { Screenshotter } from "./screenshot.js";
import { Workspace } from "./workspace.js";
import { Flow, FLOW_GUIDE, screenHotspots, type FlowT } from "../schema/flow.js";
import { buildFlowView, checkFlow, loadFlow, type ProtoWarning } from "./prototype.js";
import { runExport, type ExportFormat } from "./export.js";
import { DIAGRAM_GUIDE, Diagram, type DiagramT } from "../schema/diagram.js";

const INSTRUCTIONS = `Framit turns descriptions into editable, themed wireframes (desktop and mobile screens) stored in
.framit/ in the current project, with a local browser preview.

Typical session:
1. get_project (init_project if not initialised).
2. describe_dsl once, to learn the screen format and component catalogue.
3. Pick or create a theme: list_themes / get_theme (read its notes!) / create_theme.
4. write_screen, then LOOK at the returned screenshots and fix problems with patch_screen.
5. Give the user the preview URL. It opens an editor: they can select, retype text, change props,
   reorder, insert and move frames, and every edit is saved to the screen document.

Prototypes: give buttons, links, nav/tab bar/list items a \`to\` prop naming another screen id, and they
navigate in Preview mode, in Present mode (/p/screen/<id>) and in exported HTML. A flow (write_flow) puts
screens in order on one canvas with arrows; describe_dsl kind=flow explains it. export writes PNG, PDF or
a single offline HTML prototype.

Architecture drawings: write_diagram (nodes, groups/lanes, edges; laid out automatically). Call describe_dsl
kind=diagram first. People tidy diagrams by dragging nodes, which pins them: read_diagram before
changing one and keep the ids and positions you find.

Because people edit screens in the browser, read_screen before changing an existing screen and prefer
patch_screen, which leaves their edits intact.`;

type Image = { label: string; png: Buffer };
type Out = { data: unknown; images?: Image[] };

/** Wrap a handler: JSON text + inline images on success, structured MCP tool error on failure. */
function tool<A>(fn: (args: A) => Promise<Out>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      const { data, images = [] } = await fn(args);
      return {
        content: [
          { type: "text", text: JSON.stringify(data, null, 2) },
          ...images.flatMap((img) => [
            { type: "text" as const, text: img.label },
            { type: "image" as const, data: img.png.toString("base64"), mimeType: "image/png" },
          ]),
        ],
      };
    } catch (err) {
      const payload = err instanceof FramitError ? err.toJSON() : { code: "INTERNAL", message: err instanceof Error ? err.message : String(err) };
      return { isError: true, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  };
}

const Obj = z.record(z.string(), z.unknown());

export interface FramitServer {
  mcp: McpServer;
  preview: PreviewServer;
  shots: Screenshotter;
  close(): Promise<void>;
}

export function createMcpServer(store: Store, opts: { screenshots?: boolean } = {}): McpServer {
  return createFramitServer(store, opts).mcp;
}

export function createFramitServer(store: Store, opts: { screenshots?: boolean } = {}): FramitServer {
  const ws = new Workspace(store);
  const preview = new PreviewServer(ws);
  const shots = new Screenshotter();
  const screenshotsEnabled = opts.screenshots ?? process.env.FRAMIT_SCREENSHOTS !== "0";
  const mcp = new McpServer({ name: "framit", version: VERSION }, { instructions: INSTRUCTIONS });

  // ---------- shared helpers ----------

  async function screenResult(id: string, extra: Record<string, unknown>, want: { screenshots: boolean; frames?: string[] }): Promise<Out> {
    const { doc, screen, theme } = await ws.screen(id);
    const url = await preview.ensureStarted();
    const warnings: RenderWarning[] = [...renderScreenPage(screen, theme).warnings];
    const known = new Set((await store.list("screen")).map((s) => s.id));
    for (const h of screenHotspots(doc)) if (!known.has(h.to)) warnings.push({ node: h.node, message: `Hotspot leads to "${h.to}", which is not a screen (yet). It does nothing until that screen exists.` });
    const placed = placeFrames(screen, theme).filter((p) => !want.frames || want.frames.includes(p.frame.id));
    const images: Image[] = [];
    if (want.screenshots && screenshotsEnabled) {
      for (const p of placed) {
        try {
          const cap = await shots.capture(`${url}/s/${screen.id}/f/${p.frame.id}`, { width: p.width, height: p.height });
          images.push({ label: `Frame ${p.frame.id}${p.frame.name ? ` "${p.frame.name}"` : ""} (${typeof p.frame.device === "string" ? p.frame.device : "custom"} ${p.width}×${p.height}):`, png: cap.png });
          warnings.push(...cap.issues.map((i) => ({ frame: p.frame.id, node: i.node, message: i.message })));
        } catch (err) {
          warnings.push({ message: `Screenshot unavailable: ${err instanceof FramitError ? `${err.message} ${err.hint ?? ""}` : (err as Error).message}` });
          break;
        }
      }
    }
    return {
      data: {
        id: doc.id,
        revision: doc.revision,
        updatedAt: doc.updatedAt,
        theme: theme.id,
        ...extra,
        url: `${url}/s/${screen.id}`,
        frames: placed.map((p) => ({ id: p.frame.id, name: p.frame.name, device: p.frame.device, width: p.width, height: p.height, url: `${url}/s/${screen.id}/f/${p.frame.id}` })),
        warnings,
      },
      images,
    };
  }

  async function swatch(themeId: string, components?: string[]): Promise<{ url: string; image?: Image; warning?: string }> {
    const url = await preview.ensureStarted();
    const q = components ? `&components=${encodeURIComponent(components.join(","))}` : "";
    const pageUrl = `${url}/t/${themeId}`;
    if (!screenshotsEnabled) return { url: pageUrl };
    try {
      const cap = await shots.capture(`${pageUrl}?live=0${q}`, { width: 1280, height: 900, scale: components ? 1 : 0.5, maxHeight: 8000 });
      return { url: pageUrl, image: { label: components ? `Components in theme ${themeId}:` : `Swatch sheet for theme ${themeId} (colours, type scale, every component):`, png: cap.png } };
    } catch (err) {
      return { url: pageUrl, warning: `Screenshot unavailable: ${(err as Error).message}` };
    }
  }

  function themeSummary(t: ResolvedTheme) {
    // Notes first: they carry the designer's intent to later sessions.
    return { id: t.id, name: t.name, notes: t.notes, fidelity: t.fidelity, mode: t.mode, tokens: t.tokens, components: t.components };
  }

  async function saveTheme(input: Record<string, unknown>, expectedRevision?: number) {
    const resolved = await ws.resolve(input); // validates, follows extends
    const { doc, changed } = await store.write("theme", { ...input, kind: "theme" }, { expectedRevision });
    await ws.writeThemeCss(resolved);
    return { doc, changed, resolved };
  }

  /** A flow's tool result: URLs, steps, edges, warnings and a screenshot of the flow canvas. */
  async function flowResult(id: string, extra: Record<string, unknown>, wantShot: boolean, preWarnings: ProtoWarning[] = []): Promise<Out> {
    const v = await buildFlowView(ws, id);
    const url = await preview.ensureStarted();
    const warnings: ProtoWarning[] = [...preWarnings];
    for (const o of v.outside) warnings.push({ screen: o.screen, node: o.node, message: `Hotspot leads to "${o.to}", which is not a step of this flow (no arrow; it still navigates when playing if that screen exists).` });
    const inbound = new Set(v.edges.map((e) => e.to));
    v.steps.slice(1).forEach((s, i) => {
      if (!inbound.has(s.screen)) warnings.push({ screen: s.screen, message: `Step ${i + 2} ("${s.label}") has no hotspot leading to it. Give a button or link in an earlier step \`to: "${s.screen}"\`, or add an edge.` });
    });
    const images: Image[] = [];
    if (wantShot && screenshotsEnabled) {
      try {
        const cap = await shots.capture(`${url}/f/${encodeURIComponent(id)}?shot`, { width: v.width + 48, height: v.height + 48, scale: v.width > 2400 ? 0.5 : 1, selector: "#fx-flow-wrap", waitFor: "body[data-ready]", maxHeight: 6000, noIssues: true });
        images.push({ label: `Flow ${id} (${v.steps.length} steps, ${v.edges.length} arrows):`, png: cap.png });
      } catch (err) {
        warnings.push({ message: `Screenshot unavailable: ${(err as Error).message}` });
      }
    }
    return {
      data: {
        id: v.doc.id,
        revision: v.doc.revision,
        ...extra,
        url: `${url}/f/${encodeURIComponent(id)}`,
        playUrl: `${url}/p/flow/${encodeURIComponent(id)}`,
        steps: v.steps.map((s, i) => ({ step: i + 1, screen: s.screen, frame: s.frame, label: s.label, device: s.device })),
        edges: v.edges.map((e) => ({ from: `${e.from.screen}/${e.from.node}`, to: e.to, label: e.label, explicit: e.explicit || undefined })),
        warnings,
      },
      images,
    };
  }

  async function saveFlow(input: Record<string, unknown>, opts: { expectedRevision?: number; screenshots: boolean }) {
    const flow: FlowT = validate(Flow, input, "flow");
    const warnings = await checkFlow(ws, flow);
    const { doc, changed } = await store.write("flow", { ...flow, kind: "flow" }, { expectedRevision: opts.expectedRevision, source: "mcp" });
    return flowResult(doc.id, { changed }, opts.screenshots, warnings);
  }

  /** A diagram's tool result: URL, computed layout, lint warnings and a screenshot of the board. */
  async function diagramResult(id: string, extra: Record<string, unknown>, wantShot: boolean): Promise<Out> {
    const { doc, diagram, layout } = await ws.diagram(id);
    const url = await preview.ensureStarted();
    const warnings: Array<{ node?: string; message: string }> = [...layout.warnings];
    const linked = new Set(diagram.edges.flatMap((e) => [e.from, e.to]));
    for (const n of diagram.nodes) {
      if (!linked.has(n.id) && n.kind !== "note" && diagram.nodes.length > 1) warnings.push({ node: n.id, message: `"${n.label}" has no edges. Connect it or drop it.` });
      if (n.label.length > 32) warnings.push({ node: n.id, message: `Label "${n.label}" is long; keep labels to 1–3 words and move detail into tech or description.` });
    }
    const pairs = new Set(diagram.edges.map((e) => `${e.from}\u0000${e.to}`));
    for (const e of diagram.edges) if (e.from < e.to && pairs.has(`${e.to}\u0000${e.from}`)) warnings.push({ message: `Edges ${e.from} → ${e.to} and ${e.to} → ${e.from} both exist. Prefer one edge with bidirectional: true (and a label naming both directions) unless the two flows really differ.` });
    if (diagram.nodes.length > 24) warnings.push({ message: `${diagram.nodes.length} nodes is a lot for one diagram; consider splitting it (context, then containers).` });
    const images: Image[] = [];
    if (wantShot && screenshotsEnabled) {
      try {
        const w = Math.ceil(layout.bounds.w + 80), h = Math.ceil(layout.bounds.h + 80);
        const cap = await shots.capture(`${url}/d/${encodeURIComponent(id)}?static&live=0`, { width: w, height: h, scale: w > 2200 ? 1 : w < 900 ? 2 : 1.5, selector: ".fx-board", maxHeight: 6000, noIssues: true });
        images.push({ label: `Diagram ${id} (${diagram.nodes.length} nodes, ${diagram.edges.length} edges):`, png: cap.png });
      } catch (err) {
        warnings.push({ message: `Screenshot unavailable: ${(err as Error).message}` });
      }
    }
    const round = (v: number) => Math.round(v);
    return {
      data: {
        id: doc.id,
        revision: doc.revision,
        ...extra,
        url: `${url}/d/${encodeURIComponent(id)}`,
        size: { width: round(layout.bounds.w), height: round(layout.bounds.h) },
        layout: Object.fromEntries(Object.values(layout.nodes).map((n) => [n.id, { x: round(n.x), y: round(n.y), w: round(n.w), h: round(n.h), ...(n.pinned ? { pinned: true } : {}) }])),
        warnings,
      },
      images,
    };
  }

  // ---------- project ----------

  mcp.registerTool(
    "init_project",
    {
      title: "Initialise Framit project",
      description: "Create the .framit/ store in the current project. Safe to call repeatedly: an existing project is returned unchanged.",
      inputSchema: {
        name: z.string().min(1).optional().describe("Project name. Defaults to the directory name."),
        theme: z.string().optional().describe('Default theme for new screens: a starter (wire-mid-light, wire-mid-dark, wire-lo) or a theme you will create. Defaults to "wire-mid-light".'),
      },
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    tool(async ({ name, theme }: { name?: string; theme?: string }) => {
      const { project, created } = await store.init({ name, defaultTheme: theme });
      if (BUILTIN_THEMES[project.defaultTheme]) await ws.themeDoc(project.defaultTheme);
      return { data: { created, root: store.root, store: store.base, project, next: "Call describe_dsl, then get_theme to read the default theme's notes." } };
    }),
  );

  mcp.registerTool(
    "get_project",
    {
      title: "Get Framit project",
      description: "Project metadata, document counts, default theme and preview URL. Call first in a session; if `initialized` is false, call init_project.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      if (!(await store.isInitialized())) return { data: { initialized: false, root: store.root, hint: "Call init_project to create .framit/ here." } };
      return { data: { initialized: true, root: store.root, project: await store.getProject(), counts: await store.counts(), previewUrl: preview.running ?? null } };
    }),
  );

  // ---------- discovery ----------

  mcp.registerTool(
    "describe_dsl",
    {
      title: "Describe the Framit DSL",
      description: "The authoring guide and full component reference for screens (and themes). Call once per session before writing screens. Set jsonSchema=true only if you need the formal JSON Schema.",
      inputSchema: {
        kind: z.enum(["screen", "theme", "flow", "diagram"]).default("screen"),
        jsonSchema: z.boolean().default(false).describe("Also return the JSON Schema (large)."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ kind, jsonSchema }: { kind: "screen" | "theme" | "flow" | "diagram"; jsonSchema: boolean }): Promise<CallToolResult> => {
      const text =
        kind === "theme"
          ? THEME_GUIDE
          : kind === "flow"
            ? FLOW_GUIDE
            : kind === "diagram"
              ? DIAGRAM_GUIDE
            : `${SCREEN_GUIDE}\n## Component reference\n${TYPE_LEGEND}\n\n${componentReference()}\n`;
      const content: CallToolResult["content"] = [{ type: "text", text }];
      if (jsonSchema) {
        const schema = kind === "theme" ? ResolvedTheme : kind === "flow" ? Flow : kind === "diagram" ? Diagram : Screen;
        content.push({ type: "text", text: JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) });
      }
      return { content };
    },
  );

  mcp.registerTool(
    "list_components",
    {
      title: "List components",
      description: "Component types with summaries, props and an example node. Filter by category or types. preview=true adds a screenshot of those components rendered in a theme.",
      inputSchema: {
        category: z.enum(["layout", "navigation", "content", "form", "data"]).optional(),
        types: z.array(z.string()).optional().describe("Only these component types."),
        preview: z.boolean().default(false),
        theme: z.string().optional().describe("Theme for the preview; defaults to the project default."),
      },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ category, types, preview: wantPreview, theme }: { category?: string; types?: string[]; preview: boolean; theme?: string }) => {
      const defs = Object.values(COMPONENTS).filter((d) => (!category || d.category === category) && (!types || types.includes(d.type)));
      if (types) {
        const unknown = types.filter((t) => !COMPONENTS[t]);
        if (unknown.length) throw new FramitError("NOT_FOUND", `Unknown component types: ${unknown.join(", ")}.`, { hint: `Known: ${Object.keys(COMPONENTS).join(", ")}.` });
      }
      const data = {
        legend: TYPE_LEGEND,
        components: defs.map((d) => {
          const { width: _w, ...example } = d.example;
          return { type: d.type, category: d.category, container: d.container, summary: d.summary, props: propLines(d), example: { type: d.type, ...example } };
        }),
      };
      if (!wantPreview) return { data };
      const sw = await swatch(theme ?? (await ws.defaultThemeId()), defs.map((d) => d.type));
      return { data: { ...data, previewUrl: sw.url, warning: sw.warning }, images: sw.image ? [sw.image] : [] };
    }),
  );

  // ---------- themes ----------

  mcp.registerTool(
    "list_themes",
    {
      title: "List themes",
      description: "Themes in this project plus starter themes that can be used or copied. Read a theme's notes with get_theme before designing in it.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      const stored = await store.list("theme");
      const project = await store.getProject();
      const themes = [];
      for (const s of stored) {
        const doc = await store.read("theme", s.id);
        themes.push({ id: s.id, name: s.name, fidelity: doc.fidelity, mode: doc.mode, extends: doc.extends, revision: s.revision, default: s.id === project.defaultTheme });
      }
      const starters = Object.values(BUILTIN_THEMES)
        .filter((t) => !stored.some((s) => s.id === t.id))
        .map((t) => ({ id: t.id, name: t.name, fidelity: t.fidelity, mode: t.mode, starter: true, default: t.id === project.defaultTheme }));
      return { data: { themes: [...themes, ...starters] } };
    }),
  );

  mcp.registerTool(
    "get_theme",
    {
      title: "Get theme",
      description: "A theme's notes (designer intent), tokens and component settings, plus a swatch-sheet screenshot. Call this at the start of any session that will add screens, and follow the notes.",
      inputSchema: { id: z.string(), swatch: z.boolean().default(true).describe("Include the swatch sheet screenshot.") },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ id, swatch: wantSwatch }: { id: string; swatch: boolean }) => {
      const doc = await ws.themeDoc(id);
      const t = await ws.resolve(doc);
      const sw = wantSwatch ? await swatch(id) : undefined;
      return { data: { ...themeSummary(t), extends: doc.extends, revision: doc.revision, swatchUrl: sw?.url, warning: sw?.warning }, images: sw?.image ? [sw.image] : [] };
    }),
  );

  mcp.registerTool(
    "create_theme",
    {
      title: "Create theme",
      description:
        "Create a theme. Easiest: set `from` to a starter (wire-mid-light, wire-mid-dark, wire-lo) or existing theme and pass only what differs in `theme` (e.g. tokens.color, components, notes). " +
        "Always write `notes`: prose describing the intent (accent usage, density, tone) for future sessions. Returns a swatch sheet; check it. See describe_dsl kind=theme for the fields.",
      inputSchema: {
        theme: Obj.describe("Theme document: { id, name, fidelity?, mode?, tokens?, components?, notes, extends? }. Partial when `from` or `extends` is set."),
        from: z.string().optional().describe("Copy this theme as the starting point (no lasting link, unlike `extends`)."),
        replace: z.boolean().default(false).describe("Overwrite an existing theme with the same id."),
      },
    },
    tool(async ({ theme, from, replace }: { theme: Record<string, unknown>; from?: string; replace: boolean }) => {
      const input: Record<string, unknown> = { ...theme };
      if (!input.id && typeof input.name === "string") input.id = slugify(input.name);
      if (!replace && typeof input.id === "string" && (await store.list("theme")).some((t) => t.id === input.id)) {
        throw new FramitError("SCHEMA", `Theme "${String(input.id)}" already exists.`, { hint: "Use update_theme to change it, or pass replace=true." });
      }
      let doc = input;
      if (from) {
        const base = await ws.theme(from);
        const { id: _i, name: _n, revision: _r, updatedAt: _u, kind: _k, ...rest } = base as Record<string, unknown>;
        doc = deepMerge(rest, input);
      }
      const saved = await saveTheme(doc);
      const sw = await swatch(saved.resolved.id);
      return {
        data: { ...themeSummary(saved.resolved), revision: saved.doc.revision, css: `.framit/themes/${saved.resolved.id}.css`, swatchUrl: sw.url, warning: sw.warning },
        images: sw.image ? [sw.image] : [],
      };
    }),
  );

  mcp.registerTool(
    "update_theme",
    {
      title: "Update theme",
      description: "Change a theme with a deep `merge` (e.g. {tokens:{color:{accent:\"#e5484d\"}}}) or JSON Patch `ops`. Every screen using it changes too. Update `notes` when the intent changes.",
      inputSchema: {
        id: z.string(),
        merge: Obj.optional(),
        ops: z.array(PatchOp).optional().describe("RFC 6902 ops on the stored theme document."),
        expectedRevision: z.number().int().optional(),
      },
    },
    tool(async ({ id, merge, ops, expectedRevision }: { id: string; merge?: Record<string, unknown>; ops?: PatchOp[]; expectedRevision?: number }) => {
      if (!merge && !ops) throw new FramitError("SCHEMA", "Pass `merge` or `ops`.");
      const current = await ws.themeDoc(id);
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new FramitError("REVISION", `Theme "${id}" is at revision ${current.revision}, not ${expectedRevision}.`, { data: { current } });
      }
      let next: Record<string, unknown> = current;
      if (merge) next = deepMerge(next, { ...merge, id });
      if (ops) next = applyPatch(next, ops);
      const saved = await saveTheme(next, current.revision);
      const sw = await swatch(id);
      return { data: { ...themeSummary(saved.resolved), revision: saved.doc.revision, changed: saved.changed, swatchUrl: sw.url, warning: sw.warning }, images: sw.image ? [sw.image] : [] };
    }),
  );

  mcp.registerTool(
    "delete_theme",
    {
      title: "Delete theme",
      description: "Delete a theme. Refuses while screens use it unless force=true.",
      inputSchema: { id: z.string(), force: z.boolean().default(false) },
      annotations: { destructiveHint: true },
    },
    tool(async ({ id, force }: { id: string; force: boolean }) => {
      const users: string[] = [];
      for (const s of await store.list("screen")) if ((await store.read("screen", s.id)).theme === id) users.push(s.id);
      if (users.length && !force) throw new FramitError("SCHEMA", `Theme "${id}" is used by: ${users.join(", ")}.`, { hint: "Switch those screens to another theme, or pass force=true." });
      await store.delete("theme", id);
      return { data: { deleted: id, orphanedScreens: users } };
    }),
  );

  // ---------- screens ----------

  mcp.registerTool(
    "write_screen",
    {
      title: "Write screen",
      description:
        "Create or replace a screen. Frames are device viewports; everything inside a frame is flow layout (stack, row, grid…), never coordinates. Prefer theme tokens over raw CSS values. " +
        "If the screen already exists and you did not write it this turn, call read_screen first and pass expectedRevision, because a person may have edited it in the browser. " +
        "Returns a screenshot of every frame: look at them and fix problems before reporting success. Call describe_dsl first if you have not this session.",
      inputSchema: {
        screen: Obj.describe("Screen document: { id?, name, theme?, description?, frames: [{ name?, device, root }] }. id defaults to a slug of name."),
        expectedRevision: z.number().int().optional().describe("Fail if the stored revision differs (0 = must not exist)."),
        screenshots: z.boolean().default(true),
      },
    },
    tool(async ({ screen, expectedRevision, screenshots }: { screen: Record<string, unknown>; expectedRevision?: number; screenshots: boolean }) => {
      const input: Record<string, unknown> = { ...screen };
      if (!input.id && typeof input.name === "string") input.id = slugify(input.name);
      input.theme ??= await ws.defaultThemeId();
      validate(Screen, input, "screen");
      await ws.theme(String(input.theme));
      const { doc, changed } = await store.write("screen", input, { expectedRevision, source: "mcp" });
      return screenResult(doc.id, { changed }, { screenshots });
    }),
  );

  mcp.registerTool(
    "patch_screen",
    {
      title: "Patch screen",
      description:
        "Change part of a screen with node-addressed JSON Patch, leaving everything else (including a person's browser edits) intact. Preferred over write_screen for fixes. " +
        'Each op: { op: add|remove|replace|move|copy|test, node?: id, path?: "/props/label", value?, fromNode?, from? }. With `node`, path is relative to that node; ' +
        '{op:"remove", node:"n_x"} deletes a node; {op:"add", node:"n_parent", path:"/children/-", value:{…}} appends; {op:"move", fromNode:"n_x", node:"n_parent", path:"/children/0"} moves. Returns screenshots of the frames.',
      inputSchema: {
        id: z.string(),
        ops: z.array(PatchOp).min(1),
        expectedRevision: z.number().int().optional(),
        screenshots: z.boolean().default(true),
      },
    },
    tool(async ({ id, ops, expectedRevision, screenshots }: { id: string; ops: PatchOp[]; expectedRevision?: number; screenshots: boolean }) => {
      const current = await store.read("screen", id);
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new FramitError("REVISION", `Screen "${id}" is at revision ${current.revision}, not ${expectedRevision}.`, { hint: "Re-read it and reapply your change.", data: { current } });
      }
      const { changed } = await ws.patchScreen(id, ops, { source: "mcp" });
      return screenResult(id, { changed }, { screenshots });
    }),
  );

  mcp.registerTool(
    "read_screen",
    {
      title: "Read screen",
      description: "The current screen document, including edits a person made in the browser editor, with its revision and editor URL. Call before modifying a screen you did not just write, and keep node ids when rewriting.",
      inputSchema: { id: z.string(), screenshots: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ id, screenshots }: { id: string; screenshots: boolean }) => {
      const doc = await store.read("screen", id);
      const r = await screenResult(id, {}, { screenshots });
      return { data: { document: doc, url: (r.data as { url: string }).url, warnings: (r.data as { warnings: unknown }).warnings }, images: r.images };
    }),
  );

  mcp.registerTool(
    "list_screens",
    {
      title: "List screens",
      description: "All screens with theme, frames and revision.",
      inputSchema: { theme: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ theme }: { theme?: string }) => {
      const out = [];
      for (const s of await store.list("screen")) {
        const d = await store.read("screen", s.id);
        if (theme && d.theme !== theme) continue;
        const frames = Array.isArray(d.frames) ? (d.frames as Array<{ id?: string; name?: string; device?: unknown }>).map((f) => ({ id: f.id, name: f.name, device: f.device })) : [];
        out.push({ id: s.id, name: s.name, description: d.description, theme: d.theme, frames, revision: s.revision, updatedAt: s.updatedAt });
      }
      return { data: { screens: out, previewUrl: preview.running ?? null } };
    }),
  );

  mcp.registerTool(
    "delete_screen",
    {
      title: "Delete screen",
      description: "Delete a screen document.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    tool(async ({ id }: { id: string }) => {
      await store.delete("screen", id);
      const flows: string[] = [];
      for (const f of await store.list("flow")) if (((await store.read("flow", f.id)).steps as Array<{ screen: string }> | undefined)?.some((s) => s.screen === id)) flows.push(f.id);
      return { data: { deleted: id, ...(flows.length ? { brokenFlows: flows, hint: "These flows still list the screen as a step; patch_flow to remove it." } : {}) } };
    }),
  );

  mcp.registerTool(
    "duplicate_screen",
    {
      title: "Duplicate screen",
      description: "Copy a screen under a new id with fresh node ids. Useful for variants (empty state, error state) of an existing screen.",
      inputSchema: { id: z.string(), newId: z.string(), name: z.string().optional(), screenshots: z.boolean().default(false) },
    },
    tool(async ({ id, newId, name, screenshots }: { id: string; newId: string; name?: string; screenshots: boolean }) => {
      const src = structuredClone(await store.read("screen", id));
      for (const f of (src.frames as Array<Record<string, unknown>>) ?? []) delete f.id;
      walkScreenNodes(src, (n) => void delete n.id);
      const { revision: _r, updatedAt: _u, ...rest } = src;
      await store.write("screen", { ...rest, id: newId, name: name ?? `${String(src.name)} (copy)` }, { expectedRevision: 0 });
      return screenResult(newId, { duplicatedFrom: id }, { screenshots });
    }),
  );

  mcp.registerTool(
    "render",
    {
      title: "Render",
      description: "Preview URL plus fresh screenshots of a screen (optionally one frame), a flow's canvas, or a theme's swatch sheet. Use to show the user or to re-check after browser edits.",
      inputSchema: { kind: z.enum(["screen", "theme", "flow", "diagram"]).default("screen"), id: z.string(), frame: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ kind, id, frame }: { kind: "screen" | "theme" | "flow" | "diagram"; id: string; frame?: string }) => {
      if (kind === "diagram") return diagramResult(id, {}, true);
      if (kind === "flow") return flowResult(id, {}, true);
      if (kind === "theme") {
        await ws.themeDoc(id);
        const sw = await swatch(id);
        return { data: { url: sw.url, warning: sw.warning }, images: sw.image ? [sw.image] : [] };
      }
      return screenResult(id, {}, { screenshots: true, frames: frame ? [frame] : undefined });
    }),
  );

  // ---------- flows ----------

  mcp.registerTool(
    "write_flow",
    {
      title: "Write flow",
      description:
        "Create or replace a flow: existing screens in order on one canvas, with arrows from hotspots (`to` props) between them. " +
        "Write the screens first and give their buttons/links `to: \"<screen id>\"`. Returns the flow canvas screenshot, a playUrl that clicks through it, " +
        "and warnings for steps nothing leads to. See describe_dsl kind=flow.",
      inputSchema: {
        flow: Obj.describe('Flow document: { id?, name, device?, steps: [{ screen, frame?, label? }], edges?: [{ from: { screen, node }, to, label? }] }.'),
        expectedRevision: z.number().int().optional(),
        screenshots: z.boolean().default(true),
      },
    },
    tool(async ({ flow, expectedRevision, screenshots }: { flow: Record<string, unknown>; expectedRevision?: number; screenshots: boolean }) => {
      const input: Record<string, unknown> = { ...flow };
      if (!input.id && typeof input.name === "string") input.id = slugify(input.name);
      return saveFlow(input, { expectedRevision, screenshots });
    }),
  );

  mcp.registerTool(
    "patch_flow",
    {
      title: "Patch flow",
      description: 'Change part of a flow with JSON Patch, e.g. {op:"add", path:"/steps/-", value:{screen:"done"}} or {op:"replace", path:"/edges/0/label", value:"Tap Next"}.',
      inputSchema: { id: z.string(), ops: z.array(PatchOp).min(1), expectedRevision: z.number().int().optional(), screenshots: z.boolean().default(true) },
    },
    tool(async ({ id, ops, expectedRevision, screenshots }: { id: string; ops: PatchOp[]; expectedRevision?: number; screenshots: boolean }) => {
      const current = await store.read("flow", id);
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new FramitError("REVISION", `Flow "${id}" is at revision ${current.revision}, not ${expectedRevision}.`, { data: { current } });
      }
      const { revision: _r, updatedAt: _u, ...next } = applyPatch(current, ops);
      return saveFlow({ ...next, id }, { expectedRevision: current.revision, screenshots });
    }),
  );

  mcp.registerTool(
    "read_flow",
    {
      title: "Read flow",
      description: "A flow document with its resolved steps and edges (including those derived from hotspots), canvas URL and play URL.",
      inputSchema: { id: z.string(), screenshots: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ id, screenshots }: { id: string; screenshots: boolean }) => {
      const { doc } = await loadFlow(ws, id);
      const r = await flowResult(id, {}, screenshots);
      return { data: { document: doc, ...(r.data as object) }, images: r.images };
    }),
  );

  mcp.registerTool(
    "list_flows",
    {
      title: "List flows",
      description: "All flows with their steps and revision.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      const flows = [];
      for (const f of await store.list("flow")) {
        const d = await store.read("flow", f.id);
        flows.push({ id: f.id, name: f.name, description: d.description, steps: (d.steps as Array<{ screen: string }>).map((s) => s.screen), revision: f.revision, updatedAt: f.updatedAt });
      }
      return { data: { flows, previewUrl: preview.running ?? null } };
    }),
  );

  mcp.registerTool(
    "delete_flow",
    {
      title: "Delete flow",
      description: "Delete a flow document. Its screens are not touched.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    tool(async ({ id }: { id: string }) => {
      await store.delete("flow", id, "mcp");
      return { data: { deleted: id } };
    }),
  );

  // ---------- diagrams ----------

  mcp.registerTool(
    "write_diagram",
    {
      title: "Write diagram",
      description:
        "Create or replace an architecture diagram: nodes (kind, label, tech), groups or lanes, labelled edges. Layout is automatic (layered, orthogonal arrows). " +
        "Returns a screenshot and each node's computed position: look at it and fix with patch_diagram. Call describe_dsl kind=diagram first. " +
        "If the diagram exists and you did not write it this turn, read_diagram first: a person may have tidied it, and their pins live in node positions.",
      inputSchema: {
        diagram: Obj.describe("Diagram document: { id?, name, direction?, theme?, nodes: [{ id, label, kind?, tech?, description?, group? }], groups?: [{ id, label, lane? }], edges?: [{ from, to, label?, style?, bidirectional? }] }."),
        expectedRevision: z.number().int().optional(),
        screenshots: z.boolean().default(true),
      },
    },
    tool(async ({ diagram, expectedRevision, screenshots }: { diagram: Record<string, unknown>; expectedRevision?: number; screenshots: boolean }) => {
      const input: Record<string, unknown> = { ...diagram };
      if (!input.id && typeof input.name === "string") input.id = slugify(input.name);
      const d: DiagramT = await ws.checkDiagram(input);
      const { doc, changed } = await store.write("diagram", { ...input, kind: "diagram", id: d.id }, { expectedRevision, source: "mcp" });
      return diagramResult(doc.id, { changed }, screenshots);
    }),
  );

  mcp.registerTool(
    "patch_diagram",
    {
      title: "Patch diagram",
      description:
        "Change part of a diagram, leaving a person's tidying intact. Ops address nodes, groups and edges by id: " +
        '{op:"replace", node:"api", path:"/label", value:"Ledger API"}; {op:"add", path:"/nodes/-", value:{id:"cache", label:"Redis", kind:"cache"}}; ' +
        '{op:"add", path:"/edges/-", value:{from:"api", to:"cache"}}; {op:"remove", node:"e_x"} (an edge id); removing a node also removes its edges; ' +
        '{op:"remove", node:"api", path:"/position"} unpins.',
      inputSchema: { id: z.string(), ops: z.array(PatchOp).min(1), expectedRevision: z.number().int().optional(), screenshots: z.boolean().default(true) },
    },
    tool(async ({ id, ops, expectedRevision, screenshots }: { id: string; ops: PatchOp[]; expectedRevision?: number; screenshots: boolean }) => {
      const current = await store.read("diagram", id);
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new FramitError("REVISION", `Diagram "${id}" is at revision ${current.revision}, not ${expectedRevision}.`, { hint: "Re-read it and reapply your change.", data: { current } });
      }
      const { changed } = await ws.patchDiagram(id, ops, { source: "mcp" });
      return diagramResult(id, { changed }, screenshots);
    }),
  );

  mcp.registerTool(
    "read_diagram",
    {
      title: "Read diagram",
      description: "The current diagram document (including a person's edits and pins), its revision, editor URL and computed layout.",
      inputSchema: { id: z.string(), screenshots: z.boolean().default(false) },
      annotations: { readOnlyHint: true },
    },
    tool(async ({ id, screenshots }: { id: string; screenshots: boolean }) => {
      const doc = await store.read("diagram", id);
      const r = await diagramResult(id, {}, screenshots);
      return { data: { document: doc, ...(r.data as object) }, images: r.images };
    }),
  );

  mcp.registerTool(
    "list_diagrams",
    {
      title: "List diagrams",
      description: "All diagrams with node and edge counts.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    tool(async () => {
      const diagrams = [];
      for (const s of await store.list("diagram")) {
        const d = await store.read("diagram", s.id);
        diagrams.push({ id: s.id, name: s.name, description: d.description, nodes: (d.nodes as unknown[]).length, edges: ((d.edges as unknown[]) ?? []).length, revision: s.revision, updatedAt: s.updatedAt });
      }
      return { data: { diagrams, previewUrl: preview.running ?? null } };
    }),
  );

  mcp.registerTool(
    "delete_diagram",
    {
      title: "Delete diagram",
      description: "Delete a diagram document.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    tool(async ({ id }: { id: string }) => {
      await store.delete("diagram", id, "mcp");
      return { data: { deleted: id } };
    }),
  );

  // ---------- export ----------

  mcp.registerTool(
    "export",
    {
      title: "Export",
      description:
        "Write a screen, flow or diagram to disk. Diagrams: html is a static page, png one image, pdf one page. Screens and flows: html: ONE self-contained file that works offline, a clickable prototype (hotspots navigate; arrow keys step through a flow). " +
        "pdf: one page per frame (flow: per step). png: one image per frame in a folder (flow: plus an overview). Default location .framit/exports/; `out` is a path inside the project.",
      inputSchema: {
        kind: z.enum(["screen", "flow", "diagram"]).default("screen"),
        id: z.string(),
        format: z.enum(["html", "pdf", "png"]),
        frame: z.string().optional().describe("Screen exports: start at (html) or only include (png, pdf) this frame."),
        out: z.string().optional().describe("File (html, pdf) or folder (png), relative to the project root."),
      },
    },
    tool(async ({ kind, id, format, frame, out }: { kind: "screen" | "flow" | "diagram"; id: string; format: ExportFormat; frame?: string; out?: string }) => {
      const r = await runExport({ ws, preview, shots }, kind === "screen" ? { kind, id, frame } : { kind, id }, format, out);
      return {
        data: {
          format,
          files: r.files.map((f) => ({ ...f, path: f.path, relative: path.relative(store.root, f.path) })),
          warnings: r.warnings,
          ...(format === "html" ? { open: `file://${r.files[0]!.path}` } : {}),
        },
      };
    }),
  );

  return {
    mcp,
    preview,
    shots,
    async close() {
      await Promise.allSettled([preview.close(), shots.close()]);
    },
  };
}
