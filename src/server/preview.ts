import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AddressInfo } from "node:net";
import { FramitError } from "../errors.js";
import { esc } from "../renderer/html.js";
import { z } from "zod";
import { COMPONENTS } from "../components/index.js";
import { EDITOR_CSS } from "../renderer/editor-css.js";
import { deviceName, placeFrames, renderCanvas, renderEditorPage, renderFrame, renderFramePage, renderScreenPage } from "../renderer/render.js";
import { COLOR_TOKENS, SPACE_TOKENS, TONES } from "../schema/tokens.js";
import { PatchOp } from "../store/patch.js";
import { loadRuntime } from "./runtime-bundle.js";
import { readFont } from "./assets.js";
import { renderFlowPage, renderPlayerPage } from "../renderer/prototype.js";
import { buildFlowView, buildPlayer } from "./prototype.js";
import { renderSwatchPage } from "../renderer/swatch.js";
import type { ChangeEvent, DocKind } from "../store/store.js";
import { DOC_KINDS } from "../store/store.js";
import { BUILTIN_THEMES } from "../themes/builtin.js";
import type { Workspace } from "./workspace.js";

/** Reloads a static page when the document it shows changes. */
const liveReload = (kind: string, id: string) =>
  `<script>(()=>{try{const es=new EventSource("/api/events");es.onmessage=(e)=>{const c=JSON.parse(e.data);if((c.kind===${JSON.stringify(kind)}&&c.id===${JSON.stringify(id)})||c.kind==="theme")location.reload()}}catch{}})()</script>`;

/**
 * Local preview server (docs/02-architecture.md). Started lazily on first render, bound to
 * loopback only, on an OS-assigned port.
 */
export class PreviewServer {
  private server: ServerType | undefined;
  private starting: Promise<string> | undefined;
  private url: string | undefined;

  constructor(private readonly ws: Workspace, private readonly port = Number(process.env.FRAMIT_PORT ?? 0)) {}

  get running(): string | undefined {
    return this.url;
  }

  ensureStarted(): Promise<string> {
    this.starting ??= new Promise<string>((resolve, reject) => {
      const server = serve({ fetch: this.app().fetch, port: this.port, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        this.url = `http://127.0.0.1:${info.port}`;
        resolve(this.url);
      });
      server.on("error", reject);
      this.server = server;
    });
    return this.starting;
  }

  async close(): Promise<void> {
    const server = this.server as (ServerType & { closeAllConnections?: () => void }) | undefined;
    // Open event streams from editor tabs would otherwise keep close() waiting.
    server?.closeAllConnections?.();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    this.server = undefined;
    this.starting = undefined;
    this.url = undefined;
  }

  app(): Hono {
    const app = new Hono();
    const ws = this.ws;

    app.onError((err, c) => {
      const status = err instanceof FramitError ? (err.code === "NOT_FOUND" || err.code === "THEME_MISSING" ? 404 : 400) : 500;
      const body = err instanceof FramitError ? err.toJSON() : { code: "INTERNAL", message: err.message };
      return c.req.path.startsWith("/api/") ? c.json(body, status) : c.html(errorPage(body), status);
    });

    app.get("/assets/fonts/:name", async (c) => {
      const font = readFont(c.req.param("name"));
      if (!font) return c.notFound();
      const data = await font;
      return c.body(data, 200, { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" });
    });

    app.get("/", async (c) => {
      const screens = await ws.store.list("screen");
      const flows = await ws.store.list("flow");
      const themes = [...new Set([...(await ws.store.list("theme")).map((t) => t.id), ...Object.keys(BUILTIN_THEMES)])];
      const project = await ws.store.getProject();
      return c.html(indexPage(project.name, screens, flows, themes));
    });

    // Mutating requests must come from our own pages. The server is loopback-only, but a
    // web page in the user's browser could still try to send requests to it.
    app.use("/api/*", async (c, next) => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        const origin = c.req.header("origin");
        const host = c.req.header("host");
        if (!origin || !host || new URL(origin).host !== host) return c.json({ code: "FORBIDDEN", message: "Cross-origin write rejected." }, 403);
        if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ code: "SCHEMA", message: "Expected application/json." }, 415);
      }
      await next();
    });

    app.get("/assets/editor.js", async (c) => {
      const { code } = await loadRuntime();
      return c.body(code, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    });

    app.get("/s/:id", async (c) => {
      const { doc, screen, theme } = await ws.screen(c.req.param("id"));
      if (c.req.query("static") !== undefined) return c.html(renderScreenPage(screen, theme, { bodyEnd: liveReload("screen", screen.id) }).html);
      return c.html(renderEditorPage(screen, theme, { kind: "screen", id: screen.id, revision: doc.revision }, { editorCss: EDITOR_CSS }));
    });

    app.get("/assets/player.js", async (c) => {
      const { code } = await loadRuntime("player");
      return c.body(code, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
    });

    // Present mode: the player for a screen (starting at ?frame) or a flow.
    app.get("/p/:kind/:id", async (c) => {
      const kind = c.req.param("kind");
      const id = c.req.param("id");
      if (kind !== "screen" && kind !== "flow") throw new FramitError("NOT_FOUND", `Cannot present a ${kind}.`);
      const p = await buildPlayer(ws, kind === "flow" ? { kind, id } : { kind, id, frame: c.req.query("frame") });
      const exit = kind === "flow" ? `/f/${encodeURIComponent(id)}` : `/s/${encodeURIComponent(id)}`;
      return c.html(renderPlayerPage({ ...p, exit, live: true }, { script: { src: "/assets/player.js" } }));
    });

    // Flow canvas. ?shot renders at 1:1 without chrome, for screenshots.
    app.get("/f/:id", async (c) => {
      const v = await buildFlowView(ws, c.req.param("id"));
      const shot = c.req.query("shot") !== undefined;
      return c.html(renderFlowPage({ flow: v.flow, steps: v.steps, edges: v.edges, width: v.width, height: v.height, shot, live: !shot }, { script: { src: "/assets/player.js" } }));
    });

    app.get("/api/meta", (c) =>
      c.json({
        components: Object.fromEntries(
          Object.values(COMPONENTS).map((d) => {
            const { width: _w, ...example } = d.example;
            return [d.type, { type: d.type, category: d.category, container: d.container, summary: d.summary, props: z.toJSONSchema(d.props, { io: "input", unrepresentable: "any" }), example: { type: d.type, ...example } }];
          }),
        ),
        tokens: { space: SPACE_TOKENS, color: COLOR_TOKENS, tone: TONES },
      }),
    );

    app.patch("/api/doc/screen/:id", async (c) => {
      const body = (await c.req.json()) as { baseRevision?: number; ops?: unknown[] };
      const ops = z.array(PatchOp).min(1).parse(body.ops ?? []);
      try {
        const r = await ws.patchScreen(c.req.param("id"), ops, { baseRevision: body.baseRevision, source: c.req.header("x-framit-client") ?? "browser" });
        return c.json({ revision: r.doc.revision, rebased: r.rebased, doc: r.doc });
      } catch (err) {
        if (err instanceof FramitError && err.code === "REVISION") return c.json(err.toJSON(), 409);
        throw err;
      }
    });

    app.get("/api/render/canvas/:id", async (c) => {
      const { doc, screen, theme } = await ws.screen(c.req.param("id"));
      const r = renderCanvas(screen, theme);
      return c.json({ revision: doc.revision, html: r.html, warnings: r.warnings });
    });

    app.get("/s/:id/f/:fid", async (c) => {
      const { screen, theme } = await ws.screen(c.req.param("id"));
      const page = renderFramePage(screen, c.req.param("fid"), theme, { bodyEnd: c.req.query("live") ? liveReload("screen", screen.id) : "" });
      if (!page) throw new FramitError("NOT_FOUND", `Screen "${screen.id}" has no frame "${c.req.param("fid")}".`);
      return c.html(page.html);
    });

    app.get("/t/:id", async (c) => {
      const theme = await ws.theme(c.req.param("id"));
      const only = c.req.query("components")?.split(",").filter(Boolean);
      return c.html(renderSwatchPage(theme, { components: only, bodyEnd: c.req.query("live") === "0" ? "" : liveReload("theme", theme.id) }).html);
    });

    app.get("/api/doc/:kind/:id", async (c) => {
      const kind = c.req.param("kind") as DocKind;
      if (!DOC_KINDS.includes(kind)) throw new FramitError("NOT_FOUND", `Unknown kind "${kind}".`);
      return c.json(await ws.store.read(kind, c.req.param("id")));
    });

    app.get("/api/render/screen/:id", async (c) => {
      const { screen, theme } = await ws.screen(c.req.param("id"));
      const fid = c.req.query("frame");
      const placed = placeFrames(screen, theme).filter((p) => !fid || p.frame.id === fid);
      if (!placed.length) throw new FramitError("NOT_FOUND", `Screen "${screen.id}" has no frame "${fid}".`);
      return c.json(placed.map((p) => ({ frame: p.frame.id, name: p.frame.name, device: deviceName(p.frame.device), width: p.width, height: p.height, ...renderFrame(p, theme, { screen: screen.id }) })));
    });

    app.get("/api/events", (c) =>
      streamSSE(c, async (stream) => {
        const onChange = (e: ChangeEvent) => void stream.writeSSE({ data: JSON.stringify(e) });
        ws.store.events.on("change", onChange);
        stream.onAbort(() => void ws.store.events.off("change", onChange));
        while (!stream.aborted) await stream.sleep(25_000).then(() => stream.writeSSE({ event: "ping", data: "" }));
      }),
    );

    return app;
  }
}

const PAGE_CSS = `body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#101828}main{max-width:760px;margin:48px auto;padding:0 20px}h1{font-size:22px;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#667085;margin:32px 0 8px}a{color:#4f5bd5;text-decoration:none}ul{list-style:none;padding:0;margin:0;background:#fff;border:1px solid #e4e7ec;border-radius:10px}li{padding:10px 14px;border-top:1px solid #e4e7ec;display:flex;justify-content:space-between}li:first-child{border-top:0}.m{color:#667085;font-size:12px}pre{white-space:pre-wrap;background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:14px}`;

type Summary = { id: string; name?: string; revision: number };

function indexPage(name: string, screens: Summary[], flows: Summary[], themes: string[]) {
  const items = (xs: string[]) => (xs.length ? `<ul>${xs.join("")}</ul>` : `<p class="m">None yet.</p>`);
  return `<!doctype html><meta charset="utf-8"><title>${esc(name)} · Framit</title><style>${PAGE_CSS}</style><main><h1>${esc(name)}</h1><div class="m">Framit preview</div><h2>Screens</h2>${items(screens.map((s) => `<li><a href="/s/${esc(s.id)}">${esc(s.name ?? s.id)}</a><span class="m">${esc(s.id)} · rev ${s.revision} · <a href="/p/screen/${esc(s.id)}">present</a></span></li>`))}<h2>Flows</h2>${items(flows.map((f) => `<li><a href="/f/${esc(f.id)}">${esc(f.name ?? f.id)}</a><span class="m">${esc(f.id)} · rev ${f.revision} · <a href="/p/flow/${esc(f.id)}">play</a></span></li>`))}<h2>Themes</h2>${items(themes.map((t) => `<li><a href="/t/${esc(t)}">${esc(t)}</a></li>`))}</main>`;
}

function errorPage(e: { code: string; message: string; hint?: string }) {
  return `<!doctype html><meta charset="utf-8"><title>${esc(e.code)}</title><style>${PAGE_CSS}</style><main><h1>${esc(e.code)}</h1><pre>${esc(e.message)}${e.hint ? `\n\n${esc(e.hint)}` : ""}</pre><p><a href="/">All screens</a></p></main>`;
}

