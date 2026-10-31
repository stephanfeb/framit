import { COMPONENTS, type AnyNode, type RenderCtx, type RenderNode } from "../components/index.js";
import type { FrameT, Screen } from "../schema/screen.js";
import type { ResolvedTheme } from "../schema/theme.js";
import { colorCss, styleCss } from "../schema/tokens.js";
import { BASE_CSS, CANVAS_CSS, UNKNOWN_CSS } from "./base-css.js";
import { css, esc, richText } from "./html.js";
import { iconSvg, suggestIcons } from "./icons.js";
import { compileThemeCss } from "./theme-css.js";

export interface RenderWarning {
  frame?: string;
  node?: string;
  message: string;
}

export const COMPACT_BELOW = 640;
export const FRAME_GAP = 120;

export interface PlacedFrame {
  frame: FrameT & { id: string };
  x: number;
  y: number;
  width: number;
  height: number;
}

export function deviceSize(device: FrameT["device"], theme: ResolvedTheme): { width: number; height: number } {
  if (typeof device === "object") return device;
  const [width, height] = theme.tokens.device[device];
  return { width, height };
}

/** Resolve frame positions; frames without one are placed left to right after the previous frame. */
export function placeFrames(screen: Screen, theme: ResolvedTheme): PlacedFrame[] {
  let nextX = 0;
  return screen.frames.map((frame, i) => {
    const { width, height } = deviceSize(frame.device, theme);
    const x = frame.position?.x ?? nextX;
    const y = frame.position?.y ?? 0;
    nextX = Math.max(nextX, x + width + FRAME_GAP);
    return { frame: { ...frame, id: frame.id ?? `f_${i}` }, x, y, width, height };
  });
}

function frameLabel(f: PlacedFrame): string {
  const device = typeof f.frame.device === "string" ? f.frame.device[0]!.toUpperCase() + f.frame.device.slice(1) : "Custom";
  return f.frame.name ?? `${device} · ${f.width}×${f.height}`;
}

/** A render context for one frame. Exported so the swatch sheet can render nodes directly. */
export function createCtx(theme: ResolvedTheme, frameWidth: number, frameId: string, warnings: RenderWarning[], links?: Record<string, string>): RenderCtx {
  const ctx: RenderCtx = {
    theme,
    frameWidth,
    compact: frameWidth < COMPACT_BELOW,
    render: (node) => renderNode(node, ctx),
    renderAll: (nodes) => nodes.map((n) => renderNode(n, ctx)).join(""),
    text: richText,
    edit: (pointer, s) => `<span data-prop="${esc(pointer)}">${richText(s)}</span>`,
    icon: (name, size, extra) => {
      const { svg, known } = iconSvg(name, size, extra);
      if (!known) {
        const alt = suggestIcons(name);
        warnings.push({ frame: frameId, message: `Unknown icon "${name}".${alt.length ? ` Try: ${alt.join(", ")}.` : " See https://lucide.dev/icons."}` });
      }
      return svg;
    },
    attrs: (node, className, style) => {
      const merged = [css(style ?? {}), styleCss(node.style)].filter(Boolean).join(";");
      // Explicit flow links come first so they win over a component's own data-to.
      const to = node.id && links?.[node.id] ? `data-to="${esc(links[node.id]!)}" ` : "";
      return `${to}${node.id ? `data-node="${esc(node.id)}" ` : ""}data-type="${esc(node.type)}" class="${className}"${merged ? ` style="${esc(merged)}"` : ""}`;
    },
    warn: (node, message) => warnings.push({ frame: frameId, node, message }),
  };
  return ctx;
}

export interface FrameRenderOptions {
  /** Screen id, recorded on the frame so the prototype runtime knows where it is. */
  screen?: string;
  /** Node id → target screen: extra hotspots declared by a flow's edges. */
  links?: Record<string, string>;
}

export const deviceName = (device: FrameT["device"]) => (typeof device === "string" ? device : "custom");

/** Render one frame's HTML (the `<section class="fx-frame">`), collecting warnings. */
export function renderFrame(placed: PlacedFrame, theme: ResolvedTheme, opts: FrameRenderOptions = {}): { html: string; warnings: RenderWarning[] } {
  const warnings: RenderWarning[] = [];
  const ctx = createCtx(theme, placed.width, placed.frame.id, warnings, opts.links);
  const body = renderNode(placed.frame.root, ctx);
  const html = `<section class="fx-frame" data-frame="${esc(placed.frame.id)}"${opts.screen ? ` data-screen="${esc(opts.screen)}"` : ""} data-device="${deviceName(placed.frame.device)}" data-w="${placed.width}" data-h="${placed.height}" data-fx-theme="${esc(theme.id)}" data-fx-fidelity="${theme.fidelity}" style="${css({
    width: `${placed.width}px`,
    "min-height": `${placed.height}px`,
    "--fx-vh": `${placed.height}px`,
    background: colorCss(placed.frame.background),
  })}"><div class="fx-frame-body">${body}</div></section>`;
  return { html, warnings };
}

export function renderNode(node: AnyNode, ctx: RenderCtx): string {
  const def = COMPONENTS[node.type];
  if (!def) {
    ctx.warn(node.id, `Unknown component "${node.type}".`);
    return `<div ${node.id ? `data-node="${esc(node.id)}" ` : ""}class="fx-unknown">unknown: ${esc(node.type)}</div>`;
  }
  const parsed = def.props.safeParse(node.props ?? {});
  if (!parsed.success) {
    ctx.warn(node.id, `Invalid ${node.type} props: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return `<div ${node.id ? `data-node="${esc(node.id)}" ` : ""}class="fx-unknown">invalid ${esc(node.type)}</div>`;
  }
  const rn: RenderNode<unknown> = { id: node.id ?? "", type: node.type, props: parsed.data, children: node.children ?? [], style: node.style };
  return def.render(rn as never, ctx);
}

// ---------- pages ----------

export interface PageOptions {
  /** Prefix for /assets URLs; "" for the preview server. */
  assetBase?: string;
  /** Font file name → data: URL, for self-contained pages. */
  inlineFonts?: Record<string, string>;
  /** Extra markup appended to <body>, e.g. the live-reload client. */
  bodyEnd?: string;
}

function head(title: string, theme: ResolvedTheme | ResolvedTheme[], opts: PageOptions, extraCss = "") {
  let base = BASE_CSS;
  for (const [name, dataUrl] of Object.entries(opts.inlineFonts ?? {})) base = base.replaceAll(`url("/assets/fonts/${name}")`, `url("${dataUrl}")`);
  base = base.replaceAll('url("/assets/', `url("${opts.assetBase ?? ""}/assets/`);
  const themes = [...new Map((Array.isArray(theme) ? theme : [theme]).map((t) => [t.id, t])).values()];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${base}${UNKNOWN_CSS}${CANVAS_CSS}${themes.map(compileThemeCss).join("")}${extraCss}</style></head>`;
}

/**
 * Frame slots for a canvas: each frame with its label, at its position. With `normalize`
 * the top-left frame sits at (0,0) (static pages); without it, real canvas coordinates are
 * kept (the editor applies its own pan/zoom transform).
 */
export function renderCanvas(screen: Screen, theme: ResolvedTheme, opts: { normalize?: boolean } = {}): { html: string; width: number; height: number; warnings: RenderWarning[]; placed: PlacedFrame[] } {
  const placed = placeFrames(screen, theme);
  const warnings: RenderWarning[] = [];
  const minX = opts.normalize ? Math.min(...placed.map((p) => p.x)) : 0;
  const minY = opts.normalize ? Math.min(...placed.map((p) => p.y)) : 0;
  const html = placed
    .map((p) => {
      const r = renderFrame(p, theme, { screen: screen.id });
      warnings.push(...r.warnings);
      return `<div class="fx-frame-slot" data-slot="${esc(p.frame.id)}" data-x="${p.x}" data-y="${p.y}" style="left:${p.x - minX}px;top:${p.y - minY}px"><div class="fx-frame-label" data-frame-label="${esc(p.frame.id)}">${esc(frameLabel(p))}</div>${r.html}</div>`;
    })
    .join("");
  const width = Math.max(...placed.map((p) => p.x - minX + p.width));
  const height = Math.max(...placed.map((p) => p.y - minY + p.height)) + 40;
  return { html, width, height, warnings, placed };
}

/** The static canvas page: every frame of a screen at its position, with labels. */
export function renderScreenPage(screen: Screen, theme: ResolvedTheme, opts: PageOptions = {}): { html: string; warnings: RenderWarning[] } {
  const c = renderCanvas(screen, theme, { normalize: true });
  const html = `${head(`${screen.name} · Framit`, theme, opts)}<body class="fx-canvas-page" data-fx-mode="${theme.mode}"><div class="fx-canvas-head"><b>${esc(screen.name)}</b><span>${esc(screen.id)} · ${esc(theme.name)}</span></div><div class="fx-canvas" data-screen="${esc(screen.id)}" style="width:${c.width}px;min-height:${c.height}px">${c.html}</div>${opts.bodyEnd ?? ""}</body></html>`;
  return { html, warnings: c.warnings };
}

/** The editor page: canvas with real coordinates inside the editing shell (docs/04-editor-runtime.md). */
export function renderEditorPage(screen: Screen, theme: ResolvedTheme, boot: Record<string, unknown>, opts: PageOptions & { editorCss: string } ): string {
  const c = renderCanvas(screen, theme);
  const bootJson = JSON.stringify(boot).replace(/</g, "\\u003c");
  return `${head(`${screen.name} · Framit`, theme, opts, opts.editorCss)}<body class="fx-editor" data-fx-mode="${theme.mode}" data-mode="design">
<header id="fx-bar"><div class="fx-bar-left"><a class="fx-bar-home" href="/" title="All screens">◆</a><b class="fx-bar-name">${esc(screen.name)}</b><span class="fx-bar-meta">${esc(screen.id)} · ${esc(theme.name)}</span></div>
<div class="fx-bar-mid"><div class="fx-seg" role="tablist"><button data-mode-btn="design" class="is-on" title="Design (V)">Design</button><button data-mode-btn="preview" title="Preview (P)">Preview</button><button data-mode-btn="comment" title="Comment (C)">Comment <span class="fx-cm-count" hidden></span></button></div></div>
<div class="fx-bar-right"><span id="fx-status" class="fx-status"></span><button id="fx-undo" title="Undo (⌘Z)" disabled>↶</button><button id="fx-redo" title="Redo (⇧⌘Z)" disabled>↷</button><button id="fx-insert" title="Insert component (/ or ⌘K)">＋</button><button id="fx-present" title="Present (⌘⇧P)">▶</button><button id="fx-zoom" title="Zoom to fit (⇧1)">100%</button><button id="fx-panel-toggle" title="Toggle inspector (⌘\\)">☰</button></div></header>
<div id="fx-viewport"><div id="fx-canvas" data-screen="${esc(screen.id)}">${c.html}</div></div>
<div id="fx-overlay"></div>
<div id="fx-pins"></div>
<aside id="fx-comments"></aside>
<aside id="fx-inspector"><div class="fx-insp-empty">Select something to inspect it.<br><br><kbd>Click</kbd> select · <kbd>Click</kbd> again to go deeper · <kbd>Dbl-click</kbd> edit text · <kbd>Esc</kbd> parent · <kbd>/</kbd> insert · <kbd>⌘Z</kbd> undo · <kbd>Space</kbd>+drag pan · <kbd>⌘</kbd>+scroll zoom</div></aside>
<div id="fx-toasts"></div>
<script type="application/json" id="fx-boot">${bootJson}</script>
<script type="module" src="/assets/editor.js"></script>
</body></html>`;
}

/** A page containing exactly one frame at (0,0): used for screenshots and present mode. */
export function renderFramePage(screen: Screen, frameId: string, theme: ResolvedTheme, opts: PageOptions = {}): { html: string; warnings: RenderWarning[]; placed: PlacedFrame } | null {
  const placed = placeFrames(screen, theme).find((p) => p.frame.id === frameId);
  if (!placed) return null;
  const r = renderFrame(placed, theme, { screen: screen.id });
  return { html: `${head(`${screen.name} · ${frameLabel(placed)}`, theme, opts)}<body class="fx-frame-page">${r.html}${opts.bodyEnd ?? ""}</body></html>`, warnings: r.warnings, placed };
}

export { head as pageHead };
