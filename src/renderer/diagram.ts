import { edgeId, GROUP_PAD, ICON_BOX, NODE_PAD, type DiagramLayout } from "../diagram/layout.js";
import { KIND_ICONS, type DiagramT } from "../schema/diagram.js";
import type { ResolvedTheme } from "../schema/theme.js";
import { pathData } from "../shared/route.js";
import { esc } from "./html.js";
import { iconSvg } from "./icons.js";
import { pageHead, type PageOptions } from "./render.js";

/*
 * Diagram board: groups and lanes, an SVG layer of orthogonal edges, HTML nodes and edge labels,
 * all absolutely positioned from the layout and styled from the theme's --fx-* variables.
 */

export const BOARD_MARGIN = 40;

export const DIAGRAM_CSS = String.raw`
.fx-board { position: relative; background: var(--fx-color-bg); color: var(--fx-color-text); font-family: var(--fx-font-sans); font-size: 14px; line-height: 1.3; -webkit-font-smoothing: antialiased; }
.fx-board, .fx-board * { box-sizing: border-box; }
.fx-board > * { position: absolute; }
.fx-dg-group { border: 1.5px dashed color-mix(in srgb, var(--fx-color-muted) 45%, transparent); border-radius: var(--fx-radius-lg, 12px); background: color-mix(in srgb, var(--fx-color-surface2) 45%, transparent); }
.fx-dg-group.is-lane { border: 0; border-top: 1px solid var(--fx-color-border); border-bottom: 1px solid var(--fx-color-border); border-radius: 0; background: color-mix(in srgb, var(--fx-color-surface2) 70%, transparent); }
.fx-dg-group-label { position: absolute; left: ${GROUP_PAD.side}px; top: 11px; font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; color: var(--fx-color-muted); white-space: nowrap; }
.fx-dg-edges { left: 0; top: 0; overflow: visible; color: var(--fx-color-muted); pointer-events: none; }
.fx-dg-edge { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; }
.fx-dg-edge.is-dashed { stroke-dasharray: 6 5; }
.fx-dg-edge.is-dotted { stroke-dasharray: 1.5 4.5; stroke-linecap: round; }
.fx-dg-edge-hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; }
.fx-dg-node { display: grid; grid-template-columns: ${ICON_BOX}px 1fr; grid-auto-rows: min-content; column-gap: 10px; row-gap: 8px; align-content: start; padding: ${NODE_PAD}px;
  background: var(--fx-color-surface); border: 1px solid var(--fx-color-border); border-radius: var(--fx-radius-md, 8px); box-shadow: var(--fx-shadow-sm, 0 1px 2px rgba(0,0,0,.06)); overflow: hidden; }
.fx-dg-icon { width: ${ICON_BOX}px; height: ${ICON_BOX}px; border-radius: var(--fx-radius-sm, 6px); display: grid; place-items: center; background: var(--fx-color-surface2); color: var(--fx-color-muted); }
.fx-dg-head { display: flex; flex-direction: column; justify-content: center; min-width: 0; min-height: ${ICON_BOX}px; gap: 2px; }
.fx-dg-label { font-weight: 620; font-size: 14px; line-height: 18px; overflow-wrap: anywhere; }
.fx-dg-tech { font-family: var(--fx-font-mono); font-size: 11.5px; line-height: 16px; color: var(--fx-color-muted); overflow-wrap: anywhere; }
.fx-dg-desc { grid-column: 1 / -1; font-size: 12px; line-height: 16px; color: var(--fx-color-muted); overflow-wrap: anywhere; }
.fx-dg-node.is-emph { border: 1.5px solid var(--fx-color-accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--fx-color-accent) 14%, transparent), var(--fx-shadow-sm, none); }
.fx-dg-node.is-emph .fx-dg-icon { background: var(--fx-color-accent); color: var(--fx-color-accentText, #fff); }
.fx-dg-k-external { background: var(--fx-color-surface2); border-style: dashed; box-shadow: none; }
.fx-dg-k-database { border-radius: 50% 50% var(--fx-radius-md, 8px) var(--fx-radius-md, 8px) / 12px 12px var(--fx-radius-md, 8px) var(--fx-radius-md, 8px); padding-top: ${NODE_PAD + 12}px; }
.fx-dg-k-database::before { content: ""; position: absolute; left: -1px; right: -1px; top: -1px; height: 24px; border: 1px solid var(--fx-color-border); border-radius: 50%; background: var(--fx-color-surface2); }
.fx-dg-k-database.is-emph::before { border-color: var(--fx-color-accent); }
.fx-dg-k-queue { border-radius: var(--fx-radius-md, 8px); border-right-width: 4px; border-right-style: double; }
.fx-dg-k-function { border-radius: 4px; }
.fx-dg-k-client { border-radius: var(--fx-radius-lg, 12px); }
.fx-dg-k-actor { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 10px 8px; background: transparent; border-color: transparent; box-shadow: none; overflow: visible; }
.fx-dg-k-actor .fx-dg-icon { width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--fx-color-border); background: var(--fx-color-surface); color: var(--fx-color-text); }
.fx-dg-k-actor .fx-dg-head { align-items: center; min-height: 0; }
.fx-dg-k-note { display: block; background: color-mix(in srgb, var(--fx-color-warning) 16%, var(--fx-color-surface)); border-color: color-mix(in srgb, var(--fx-color-warning) 40%, transparent); border-radius: 2px; box-shadow: none; }
.fx-dg-k-note .fx-dg-head { min-height: 0; }
.fx-dg-k-note .fx-dg-desc { display: block; margin-top: 4px; }
.fx-dg-elabel { transform: translate(-50%, -50%); padding: 2px 7px; border-radius: 6px; font-size: 11.5px; line-height: 16px; color: var(--fx-color-text); background: var(--fx-color-bg); border: 1px solid var(--fx-color-border); white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.fx-dg-title { left: ${BOARD_MARGIN}px; top: 12px; font-size: 12px; color: var(--fx-color-muted); }
`;

export interface BoardRender {
  html: string;
  width: number;
  height: number;
  /** Diagram coordinates + offset = board coordinates. */
  offset: { x: number; y: number };
}

/** The board: one positioned element holding the whole diagram. */
export function renderBoard(d: DiagramT, layout: DiagramLayout, theme: ResolvedTheme): BoardRender {
  const ox = BOARD_MARGIN - layout.bounds.x;
  const oy = BOARD_MARGIN - layout.bounds.y;
  const width = Math.ceil(layout.bounds.w + 2 * BOARD_MARGIN);
  const height = Math.ceil(layout.bounds.h + 2 * BOARD_MARGIN);
  const pos = (b: { x: number; y: number; w: number; h: number }) => `left:${Math.round(b.x + ox)}px;top:${Math.round(b.y + oy)}px;width:${Math.round(b.w)}px;height:${Math.round(b.h)}px`;

  const groups = d.groups
    .map((g) => {
      const lg = layout.groups[g.id];
      if (!lg) return "";
      return `<div class="fx-dg-group${lg.lane ? " is-lane" : ""}" data-dgroup="${esc(g.id)}" style="${pos(lg)}"><span class="fx-dg-group-label" data-prop="/label">${esc(g.label)}</span></div>`;
    })
    .join("");

  const edges: string[] = [];
  const labels: string[] = [];
  d.edges.forEach((e, i) => {
    const id = edgeId(e, i);
    const le = layout.edges[i];
    if (!le || le.points.length < 2) return;
    const pts = le.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
    const dPath = pathData(pts);
    const cls = `fx-dg-edge${e.style !== "solid" ? ` is-${e.style}` : ""}`;
    edges.push(`<g data-dedge="${esc(id)}"><path class="fx-dg-edge-hit" d="${dPath}"/><path class="${cls}" d="${dPath}" marker-end="url(#fx-dg-arrow)"${e.bidirectional ? ' marker-start="url(#fx-dg-arrow)"' : ""}/></g>`);
    if (e.label && le.label) labels.push(`<div class="fx-dg-elabel" data-dedge-label="${esc(id)}" style="left:${Math.round(le.label.x + le.label.w / 2 + ox)}px;top:${Math.round(le.label.y + le.label.h / 2 + oy)}px"><span data-prop="/label">${esc(e.label)}</span></div>`);
  });
  const svg = `<svg class="fx-dg-edges" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="fx-dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0,1 L10,5 L0,9 z" fill="currentColor"/></marker></defs>${edges.join("")}</svg>`;

  const nodes = d.nodes
    .map((n) => {
      const ln = layout.nodes[n.id]!;
      const { svg: icon } = iconSvg(n.icon ?? KIND_ICONS[n.kind], n.kind === "actor" ? 24 : 18);
      const cls = `fx-dg-node fx-dg-k-${n.kind}${n.emphasis ? " is-emph" : ""}${ln.pinned ? " is-pinned" : ""}`;
      const head = `<span class="fx-dg-head"><span class="fx-dg-label" data-prop="/label">${esc(n.label)}</span>${n.tech ? `<span class="fx-dg-tech" data-prop="/tech">${esc(n.tech)}</span>` : ""}</span>`;
      const desc = n.description ? `<span class="fx-dg-desc" data-prop="/description">${esc(n.description)}</span>` : "";
      const iconEl = n.kind === "note" ? "" : `<span class="fx-dg-icon">${icon}</span>`;
      return `<div class="${cls}" data-dnode="${esc(n.id)}" data-kind="${n.kind}" style="${pos(ln)}">${iconEl}${head}${desc}</div>`;
    })
    .join("");

  const html = `<div class="fx-board" data-diagram="${esc(d.id)}" data-fx-theme="${esc(theme.id)}" data-fx-fidelity="${theme.fidelity}" data-ox="${ox}" data-oy="${oy}" style="width:${width}px;height:${height}px">${groups}${svg}${nodes}${labels.join("")}</div>`;
  return { html, width, height, offset: { x: ox, y: oy } };
}

/** A page with just the board (screenshots, ?static, export). */
export function renderDiagramPage(d: DiagramT, layout: DiagramLayout, theme: ResolvedTheme, opts: PageOptions = {}): string {
  const b = renderBoard(d, layout, theme);
  return `${pageHead(`${d.name} · Framit`, theme, opts, `${DIAGRAM_CSS}body{margin:0;background:#fff}`)}<body class="fx-diagram-page" data-fx-mode="${theme.mode}">${b.html}${opts.bodyEnd ?? ""}</body></html>`;
}

/** The diagram editor: the board inside the same shell as the screen editor. */
export function renderDiagramEditorPage(d: DiagramT, layout: DiagramLayout, theme: ResolvedTheme, boot: Record<string, unknown>, opts: PageOptions & { editorCss: string }): string {
  const b = renderBoard(d, layout, theme);
  const bootJson = JSON.stringify(boot).replace(/</g, "\\u003c");
  return `${pageHead(`${d.name} · Framit`, theme, opts, `${opts.editorCss}${DIAGRAM_CSS}${DIAGRAM_EDITOR_CSS}`)}<body class="fx-editor fx-diagram-editor" data-fx-mode="${theme.mode}" data-mode="design">
<header id="fx-bar"><div class="fx-bar-left"><a class="fx-bar-home" href="/" title="All documents">◆</a><b class="fx-bar-name">${esc(d.name)}</b><span class="fx-bar-meta">${esc(d.id)} · diagram · ${esc(theme.name)}</span></div>
<div class="fx-bar-mid"><button id="fx-tidy" class="fx-bar-btn" title="Remove all pins and lay out automatically">Auto-layout</button></div>
<div class="fx-bar-right"><span id="fx-status" class="fx-status"></span><button id="fx-undo" title="Undo (⌘Z)" disabled>↶</button><button id="fx-redo" title="Redo (⇧⌘Z)" disabled>↷</button><button id="fx-add" title="Add node (N)">＋</button><button id="fx-zoom" title="Zoom to fit (⇧1)">100%</button><button id="fx-panel-toggle" title="Toggle inspector (⌘\\)">☰</button></div></header>
<div id="fx-viewport"><div id="fx-canvas" data-diagram="${esc(d.id)}">${b.html}</div></div>
<div id="fx-overlay"></div>
<aside id="fx-inspector"><div class="fx-insp-empty">Select a node or an arrow.<br><br><kbd>Drag</kbd> a node to move and pin it · <kbd>Drag</kbd> the ● handle to another node to connect · <kbd>Dbl-click</kbd> text to edit · <kbd>⌫</kbd> delete · <kbd>N</kbd> add node · <kbd>⌘Z</kbd> undo · <kbd>Space</kbd>+drag pan</div></aside>
<div id="fx-toasts"></div>
<script type="application/json" id="fx-boot">${bootJson}</script>
<script type="module" src="/assets/diagram.js"></script>
</body></html>`;
}

export const DIAGRAM_EDITOR_CSS = String.raw`
.fx-diagram-editor #fx-canvas .fx-board { box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 28px -10px rgba(0,0,0,.22); }
.fx-diagram-editor .fx-dg-node { cursor: grab; user-select: none; }
.fx-diagram-editor .fx-dg-node.is-dragging { cursor: grabbing; opacity: .92; z-index: 5; }
.fx-diagram-editor .fx-dg-node.is-pinned::after { content: ""; position: absolute; top: 5px; right: 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--fx-color-muted); opacity: .45; }
.fx-diagram-editor .fx-dg-elabel, .fx-diagram-editor .fx-dg-group-label { cursor: default; user-select: none; }
.fx-diagram-editor [contenteditable] { cursor: text; user-select: text; outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 2px; }
.fx-diagram-editor .fx-dg-edges { pointer-events: none; }
.fx-diagram-editor .fx-dg-edge-hit { pointer-events: stroke; cursor: pointer; }
.fx-diagram-editor g.is-selected .fx-dg-edge { stroke: var(--ui-accent); stroke-width: 2.4; }
.fx-diagram-editor g.is-hover .fx-dg-edge { stroke: var(--ui-accent); }
.fx-diagram-editor .fx-dg-edges.is-live { z-index: 4; }
.fx-bar-btn { height: 28px; padding: 0 10px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg); cursor: pointer; }
.fx-bar-btn:hover { background: var(--ui-bg2); }
.fx-ov-port { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: var(--ui-accent); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3); pointer-events: auto; cursor: crosshair; }
.fx-ov-port:hover { transform: scale(1.2); }
.fx-ov-wire { position: fixed; inset: 0; pointer-events: none; overflow: visible; }
.fx-ov-wire path { fill: none; stroke: var(--ui-accent); stroke-width: 2; stroke-dasharray: 5 4; }
.fx-ov-target { position: absolute; border: 2px solid var(--ui-accent); border-radius: 10px; background: var(--ui-accent-soft); pointer-events: none; }
`;
