import { CATEGORIES, COMPONENTS, type AnyNode } from "../components/index.js";
import { TYPE_ROLES, type ResolvedTheme } from "../schema/theme.js";
import { esc } from "./html.js";
import { createCtx, pageHead, type PageOptions, type RenderWarning } from "./render.js";

const CATEGORY_ORDER = CATEGORIES;
const WIDTH = 1280;

const SWATCH_CSS = String.raw`
.fx-sw { display: flex; flex-direction: column; gap: 40px; padding: 48px; }
.fx-sw-head { display: flex; flex-direction: column; gap: 10px; max-width: 820px; }
.fx-sw-notes { color: var(--fx-color-muted); line-height: 1.6; }
.fx-sw-h { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--fx-color-muted); margin-bottom: 14px; }
.fx-sw-colors { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.fx-sw-color { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.fx-sw-chip { height: 56px; border-radius: var(--fx-radius-md); border: 1px solid var(--fx-color-border); }
.fx-sw-type { display: flex; flex-direction: column; gap: 10px; }
.fx-sw-type-row { display: grid; grid-template-columns: 140px 1fr; align-items: baseline; gap: 16px; }
.fx-sw-meta { font-size: 11px; color: var(--fx-color-muted); font-family: var(--fx-font-mono); }
.fx-sw-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.fx-sw-cell { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px dashed var(--fx-color-border); border-radius: var(--fx-radius-md); min-width: 0; }
.fx-sw-cell--wide { grid-column: span 2; }
/* Overlays (modal, drawer, toast) preview inside their own cell. */
.fx-sw-cell { contain: layout; position: relative; overflow: hidden; }
.fx-sw-cell:has(.fx-overlay) { --fx-vh: 100%; min-height: 300px; }
.fx-sw-cell--full { grid-column: 1 / -1; }
.fx-sw-name { font-family: var(--fx-font-mono); font-size: 11px; color: var(--fx-color-muted); }
.fx-sw-variants { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
`;

/**
 * The theme swatch sheet: colours, type scale, and every component (with variants)
 * rendered in the theme. Returned by create_theme / get_theme so a model can see the
 * theme before using it.
 */
export function renderSwatchPage(theme: ResolvedTheme, opts: PageOptions & { components?: string[] } = {}): { html: string; warnings: RenderWarning[]; width: number } {
  const types = opts.components ?? Object.keys(COMPONENTS);
  const warnings: RenderWarning[] = [];
  const ctx = createCtx(theme, WIDTH, "swatch", warnings);
  const cells: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    for (const def of Object.values(COMPONENTS).filter((d) => d.category === cat && types.includes(d.type))) {
      const { width, ...ex } = def.example;
      const nodes: AnyNode[] = [{ ...ex, type: def.type }];
      for (const v of def.variants ?? []) nodes.push({ type: def.type, props: v, children: ex.children });
      const column = def.container || def.category === "data" || width !== undefined;
      const wide = (width ?? 0) > 380;
      cells.push(
        `<div class="fx-sw-cell${wide ? " fx-sw-cell--wide" : ""}"><div class="fx-sw-name">${esc(def.type)}</div><div class="fx-sw-variants" style="${width ? `max-width:${width}px;` : ""}${column ? "flex-direction:column;align-items:stretch" : ""}">${ctx.renderAll(nodes)}</div></div>`,
      );
    }
  }
  const grid = cells.join("");

  const t = theme.tokens;
  const colors = Object.entries(t.color)
    .map(([k, v]) => `<div class="fx-sw-color"><div class="fx-sw-chip" style="background:${v}"></div><b>${k}</b><span class="fx-sw-meta">${v}</span></div>`)
    .join("");
  const type = TYPE_ROLES.map((r) => {
    const [size, lh, w] = t.type[r];
    return `<div class="fx-sw-type-row"><span class="fx-sw-meta">${r} · ${size}/${Math.round(size * lh)} · ${w}</span><span class="fx-t-${r}">${r === "code" ? "const theme = load()" : "The quick brown fox jumps"}</span></div>`;
  }).join("");

  const sheet = `<section class="fx-frame" data-frame="swatch" data-fx-theme="${esc(theme.id)}" data-fx-fidelity="${theme.fidelity}" style="width:${WIDTH}px"><div class="fx-sw">
<div class="fx-sw-head"><span class="fx-t-overline">Theme · ${esc(theme.id)} · ${theme.fidelity}-fi ${theme.mode}</span><h1 class="fx-t-h1">${esc(theme.name)}</h1><p class="fx-sw-notes">${esc(theme.notes)}</p></div>
<div><div class="fx-sw-h">Colour</div><div class="fx-sw-colors">${colors}</div></div>
<div><div class="fx-sw-h">Type</div><div class="fx-sw-type">${type}</div></div>
<div><div class="fx-sw-h">Components</div><div class="fx-sw-grid">${grid}</div></div>
</div></section>`;
  return { html: `${pageHead(`${theme.name} · swatch`, theme, opts, SWATCH_CSS)}<body class="fx-frame-page">${sheet}${opts.bodyEnd ?? ""}</body></html>`, warnings, width: WIDTH };
}

