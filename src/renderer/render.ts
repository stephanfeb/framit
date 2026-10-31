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
export function createCtx(theme: ResolvedTheme, frameWidth: number, frameId: string, warnings: RenderWarning[]): RenderCtx {
  const ctx: RenderCtx = {
    theme,
    frameWidth,
    compact: frameWidth < COMPACT_BELOW,
    render: (node) => renderNode(node, ctx),
    renderAll: (nodes) => nodes.map((n) => renderNode(n, ctx)).join(""),
    text: richText,
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
      return `${node.id ? `data-node="${esc(node.id)}" ` : ""}data-type="${esc(node.type)}" class="${className}"${merged ? ` style="${esc(merged)}"` : ""}`;
    },
    warn: (node, message) => warnings.push({ frame: frameId, node, message }),
  };
  return ctx;
}

/** Render one frame's HTML (the `<section class="fx-frame">`), collecting warnings. */
export function renderFrame(placed: PlacedFrame, theme: ResolvedTheme): { html: string; warnings: RenderWarning[] } {
  const warnings: RenderWarning[] = [];
  const ctx = createCtx(theme, placed.width, placed.frame.id, warnings);
  const body = renderNode(placed.frame.root, ctx);
  const html = `<section class="fx-frame" data-frame="${esc(placed.frame.id)}" data-fx-theme="${esc(theme.id)}" data-fx-fidelity="${theme.fidelity}" style="${css({
    width: `${placed.width}px`,
    "min-height": `${placed.height}px`,
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
  /** Extra markup appended to <body>, e.g. the live-reload client. */
  bodyEnd?: string;
}

function head(title: string, theme: ResolvedTheme, opts: PageOptions, extraCss = "") {
  const fontCss = BASE_CSS.replaceAll('url("/assets/', `url("${opts.assetBase ?? ""}/assets/`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${fontCss}${UNKNOWN_CSS}${CANVAS_CSS}${compileThemeCss(theme)}${extraCss}</style></head>`;
}

/** The canvas page: every frame of a screen at its position, with labels. */
export function renderScreenPage(screen: Screen, theme: ResolvedTheme, opts: PageOptions = {}): { html: string; warnings: RenderWarning[] } {
  const placed = placeFrames(screen, theme);
  const warnings: RenderWarning[] = [];
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  const slots = placed.map((p) => {
    const r = renderFrame(p, theme);
    warnings.push(...r.warnings);
    return `<div class="fx-frame-slot" style="left:${p.x - minX}px;top:${p.y - minY}px"><div class="fx-frame-label">${esc(frameLabel(p))}</div>${r.html}</div>`;
  });
  const w = Math.max(...placed.map((p) => p.x - minX + p.width));
  const h = Math.max(...placed.map((p) => p.y - minY + p.height)) + 40;
  const html = `${head(`${screen.name} · Framit`, theme, opts)}<body class="fx-canvas-page" data-fx-mode="${theme.mode}"><div class="fx-canvas-head"><b>${esc(screen.name)}</b><span>${esc(screen.id)} · ${esc(theme.name)}</span></div><div class="fx-canvas" data-screen="${esc(screen.id)}" style="width:${w}px;min-height:${h}px">${slots.join("")}</div>${opts.bodyEnd ?? ""}</body></html>`;
  return { html, warnings };
}

/** A page containing exactly one frame at (0,0): used for screenshots and present mode. */
export function renderFramePage(screen: Screen, frameId: string, theme: ResolvedTheme, opts: PageOptions = {}): { html: string; warnings: RenderWarning[]; placed: PlacedFrame } | null {
  const placed = placeFrames(screen, theme).find((p) => p.frame.id === frameId);
  if (!placed) return null;
  const r = renderFrame(placed, theme);
  return { html: `${head(`${screen.name} · ${frameLabel(placed)}`, theme, opts)}<body class="fx-frame-page">${r.html}${opts.bodyEnd ?? ""}</body></html>`, warnings: r.warnings, placed };
}

export { head as pageHead };
