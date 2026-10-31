/*
 * The static component stylesheet. It reads only --fx-* variables produced by the theme
 * compiler, so every theme restyles every component without touching this file.
 * Class prefix: fx-. Fidelity variants via [data-fx-fidelity].
 */
export const BASE_CSS = String.raw`
@font-face { font-family: "Inter Variable"; font-style: normal; font-weight: 100 900; font-display: block; src: url("/assets/fonts/inter.woff2") format("woff2"); }
@font-face { font-family: "JetBrains Mono Variable"; font-style: normal; font-weight: 100 800; font-display: block; src: url("/assets/fonts/jetbrains-mono.woff2") format("woff2"); }

.fx-frame, .fx-frame * { box-sizing: border-box; }
.fx-frame {
  --fx-soft: 12%;
  position: relative; display: flex; flex-direction: column; overflow: hidden;
  background: var(--fx-color-bg); color: var(--fx-color-text);
  font-family: var(--fx-font-sans); font-size: var(--fx-t-body-size); line-height: var(--fx-t-body-lh);
  letter-spacing: var(--fx-t-body-ls); font-feature-settings: "cv11", "ss01";
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
.fx-frame :where(h1,h2,h3,h4,p,ul,ol,figure,table) { margin: 0; padding: 0; }
.fx-frame :where(ul) { list-style: none; }
.fx-frame :where(button,input,select,textarea) { font: inherit; color: inherit; letter-spacing: inherit; }
.fx-frame :where(a) { color: inherit; text-decoration: none; cursor: pointer; }
.fx-frame svg.fx-icon { flex: none; display: block; stroke-width: 1.75; }
.fx-frame-body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.fx-frame-body > :where(.fx-app-shell, .fx-stack, .fx-split, .fx-grid) { flex: 1 1 auto; }

/* ---------- type ---------- */
.fx-t-display, .fx-t-h1, .fx-t-h2, .fx-t-h3, .fx-t-body, .fx-t-label, .fx-t-caption, .fx-t-overline, .fx-t-code { margin: 0; }
${["display", "h1", "h2", "h3", "body", "label", "caption", "overline", "code"]
  .map((r) => `.fx-t-${r} { font-size: var(--fx-t-${r}-size); line-height: var(--fx-t-${r}-lh); font-weight: var(--fx-t-${r}-weight); letter-spacing: var(--fx-t-${r}-ls); }`)
  .join("\n")}
.fx-t-overline { text-transform: uppercase; color: var(--fx-color-muted); }
.fx-t-code, .fx-mono { font-family: var(--fx-font-mono); }
.fx-t-code { background: var(--fx-color-surface2); border: var(--fx-stroke) solid var(--fx-color-border); border-radius: var(--fx-radius-sm); padding: 2px 6px; align-self: flex-start; }
.fx-t-caption { color: var(--fx-color-muted); }
.fx-text { min-width: 0; overflow-wrap: anywhere; }
.fx-muted { color: var(--fx-color-muted); }
.fx-strong { font-weight: 600; }
.fx-clamp { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.fx-ph { color: var(--fx-color-muted); font-weight: inherit; opacity: .9; }
.fx-caption { font-size: var(--fx-t-caption-size); line-height: var(--fx-t-caption-lh); }
${["accent", "info", "success", "warning", "danger"].map((t) => `.fx-tone-${t} { color: var(--fx-color-${t}); }\n.fx-bg-${t} { background: var(--fx-color-${t}); }`).join("\n")}
.fx-tone-neutral { color: var(--fx-color-text); }
.fx-bg-neutral { background: var(--fx-color-muted); }
.fx-muted-icon { color: var(--fx-color-muted); }

/* ---------- layout ---------- */
.fx-stack { display: flex; flex-direction: column; min-width: 0; }
.fx-row { display: flex; flex-direction: row; min-width: 0; }
.fx-row--stacked { flex-direction: column; }
.fx-row > .fx-field, .fx-row > .fx-stack { flex: 1 1 0%; }
.fx-grid { display: grid; min-width: 0; }
.fx-grid > * { min-width: 0; }
.fx-split { display: flex; align-items: flex-start; min-width: 0; }
.fx-split--collapsed { flex-direction: column; align-items: stretch; }
.fx-split--divider:not(.fx-split--collapsed) > .fx-split-fixed { border-right: var(--fx-stroke) solid var(--fx-color-border); align-self: stretch; }
.fx-spacer { min-width: 0; min-height: 0; }

.fx-app-shell { display: flex; min-height: 100%; min-width: 0; }
.fx-app-main { flex: 1 1 0%; display: flex; flex-direction: column; min-width: 0; }
.fx-app-content { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
.fx-app-content-inner { display: flex; flex-direction: column; width: 100%; margin: 0 auto; min-width: 0; }

.fx-sidebar {
  flex: none; display: flex; flex-direction: column; align-self: stretch;
  padding: var(--fx-space-lg) var(--fx-space-md); background: var(--fx-color-surface);
  border-right: var(--fx-stroke) solid var(--fx-color-border);
}
.fx-sidebar-brand { display: flex; align-items: center; gap: var(--fx-space-sm); padding: 0 var(--fx-space-sm); font-size: var(--fx-t-h3-size); font-weight: 700; letter-spacing: -0.01em; color: var(--fx-color-text); }
.fx-sidebar-brand .fx-icon { color: var(--fx-color-accent); }
.fx-sidebar-footer { margin-top: auto; padding: var(--fx-space-sm); font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }

.fx-topbar { display: flex; align-items: center; gap: var(--fx-space-md); min-height: 60px; padding: var(--fx-space-sm) var(--fx-space-xl); background: var(--fx-color-surface); }
.fx-topbar--border { border-bottom: var(--fx-stroke) solid var(--fx-color-border); }
.fx-topbar-leading { display: inline-flex; color: var(--fx-color-text); }
.fx-topbar-title { display: flex; flex-direction: column; font-size: var(--fx-t-h3-size); font-weight: 600; line-height: 1.25; min-width: 0; }
.fx-topbar-subtitle { font-size: var(--fx-t-caption-size); font-weight: 400; color: var(--fx-color-muted); }
.fx-topbar--center .fx-topbar-title { position: absolute; left: 50%; transform: translateX(-50%); align-items: center; }
.fx-topbar--center { position: relative; }
.fx-topbar-search { flex: 0 1 360px; margin-left: var(--fx-space-lg); height: 36px !important; background: var(--fx-color-surface2) !important; }
.fx-topbar-actions { margin-left: auto; display: flex; align-items: center; gap: var(--fx-space-sm); }

.fx-tabbar { display: flex; justify-content: space-around; padding: var(--fx-space-sm) var(--fx-space-sm) calc(var(--fx-space-sm) + 14px); background: var(--fx-color-surface); border-top: var(--fx-stroke) solid var(--fx-color-border); }
.fx-tabbar-item { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 500; color: var(--fx-color-muted); }
.fx-tabbar-item.is-active { color: var(--fx-color-accent); }
.fx-tabbar-badge { position: absolute; top: -2px; left: calc(50% + 6px); min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--fx-color-danger); color: #fff; font-size: 10px; line-height: 16px; text-align: center; }

.fx-card { display: flex; flex-direction: column; min-width: 0; padding: var(--fx-card-padding); border-radius: var(--fx-card-radius); background: var(--fx-color-surface); }
.fx-card--outlined { border: var(--fx-stroke) solid var(--fx-color-border); box-shadow: var(--fx-card-shadow); }
.fx-card--elevated { box-shadow: var(--fx-shadow-md); border: var(--fx-stroke) solid color-mix(in srgb, var(--fx-color-border) 50%, transparent); }
.fx-card--filled { background: var(--fx-color-surface2); }
.fx-card--plain { background: transparent; padding: 0; }
.fx-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--fx-space-md); }
.fx-card-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fx-card-title { font-size: var(--fx-t-h3-size); line-height: var(--fx-t-h3-lh); font-weight: var(--fx-t-h3-weight); letter-spacing: var(--fx-t-h3-ls); }
.fx-card-subtitle { font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }
.fx-card-head .fx-link { font-size: var(--fx-t-label-size); white-space: nowrap; }

.fx-section { display: flex; flex-direction: column; gap: var(--fx-space-md); min-width: 0; }
.fx-section--divider { border-top: var(--fx-stroke) solid var(--fx-color-border); padding-top: var(--fx-space-xl); }
.fx-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--fx-space-lg); }
.fx-section-titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.fx-section-title { font-size: var(--fx-t-h2-size); line-height: var(--fx-t-h2-lh); font-weight: var(--fx-t-h2-weight); letter-spacing: var(--fx-t-h2-ls); }
.fx-section-desc { color: var(--fx-color-muted); max-width: 60ch; }
.fx-section-actions { display: flex; gap: var(--fx-space-sm); flex: none; }
.fx-section-body { display: flex; flex-direction: column; min-width: 0; }
.fx-section--aside { flex-direction: row; gap: var(--fx-space-2xl); }
.fx-section--aside > .fx-section-head { flex: 0 0 34%; max-width: 320px; }
.fx-section--aside .fx-section-title { font-size: var(--fx-t-h3-size); line-height: var(--fx-t-h3-lh); }
.fx-section--aside > .fx-section-body { flex: 1 1 0%; }
.fx-section--aside .fx-section-actions { justify-content: flex-end; padding-top: var(--fx-space-sm); }

.fx-tabs { display: flex; flex-direction: column; min-width: 0; }
.fx-tabs-panel { display: flex; flex-direction: column; min-width: 0; }
.fx-tab-strip { display: flex; gap: var(--fx-space-lg); overflow: hidden; }
.fx-tab { appearance: none; background: none; border: 0; padding: 0 0 10px; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fx-t-label-size); font-weight: 500; color: var(--fx-color-muted); white-space: nowrap; cursor: pointer; }
.fx-tab.is-active { color: var(--fx-color-text); }
.fx-tab-count { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--fx-color-surface2); color: var(--fx-color-muted); line-height: 18px; }
.fx-tabs--underline .fx-tab-strip { border-bottom: var(--fx-stroke) solid var(--fx-color-border); }
.fx-tabs--underline .fx-tab { margin-bottom: calc(-1 * var(--fx-stroke)); border-bottom: 2px solid transparent; }
.fx-tabs--underline .fx-tab.is-active { border-bottom-color: var(--fx-color-accent); }
.fx-tabs--pill .fx-tab-strip { gap: 4px; padding: 4px; background: var(--fx-color-surface2); border-radius: var(--fx-radius-md); align-self: flex-start; }
.fx-tabs--pill .fx-tab { padding: 6px 12px; border-radius: calc(var(--fx-radius-md) - 2px); }
.fx-tabs--pill .fx-tab.is-active { background: var(--fx-color-surface); box-shadow: var(--fx-shadow-sm); }

/* ---------- content ---------- */
.fx-icon-wrap { display: inline-flex; }
.fx-image { display: flex; flex-direction: column; gap: var(--fx-space-sm); min-width: 0; }
.fx-image-box {
  width: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  color: var(--fx-color-muted); font-size: var(--fx-t-caption-size);
  background: color-mix(in srgb, var(--fx-color-muted) 10%, var(--fx-color-surface));
  border: var(--fx-stroke) solid color-mix(in srgb, var(--fx-color-border) 70%, transparent);
}
.fx-image figcaption { font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }

.fx-avatar { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
.fx-avatar-disc {
  position: relative; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
  font-weight: 600; letter-spacing: 0;
  background: color-mix(in oklch, oklch(0.72 0.11 var(--fx-avatar-hue, 250)) 30%, var(--fx-color-surface2));
  color: color-mix(in oklch, oklch(0.5 0.12 var(--fx-avatar-hue, 250)) 80%, var(--fx-color-text));
}
.fx-avatar--square { border-radius: var(--fx-radius-md); }
.fx-avatar-status { position: absolute; right: -1px; bottom: -1px; width: 30%; height: 30%; min-width: 8px; min-height: 8px; border-radius: 999px; border: 2px solid var(--fx-color-surface); }
.fx-status-online { background: var(--fx-color-success); } .fx-status-away { background: var(--fx-color-warning); } .fx-status-offline { background: var(--fx-color-muted); }
.fx-avatar-label { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.fx-avatar-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fx-avatar-caption { font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }

.fx-badge { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; }
.fx-badge--soft { background: color-mix(in srgb, currentColor var(--fx-soft), transparent); }
.fx-badge--soft.fx-tone-neutral { color: var(--fx-color-muted); background: var(--fx-color-surface2); }
.fx-badge--solid { background: currentColor; }
.fx-badge--solid { color: var(--fx-color-accentText); }
${["accent", "info", "success", "warning", "danger"].map((t) => `.fx-badge--solid.fx-tone-${t} { background: var(--fx-color-${t}); color: #fff; }`).join("\n")}
.fx-badge--solid.fx-tone-neutral { background: var(--fx-color-text); color: var(--fx-color-bg); }
.fx-badge--outline { border: var(--fx-stroke) solid currentColor; }
.fx-badge--outline.fx-tone-neutral { color: var(--fx-color-muted); border-color: var(--fx-color-border); }
.fx-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }

.fx-divider { flex: none; height: var(--fx-stroke); background: var(--fx-color-border); align-self: stretch; }
.fx-divider--vertical { width: var(--fx-stroke); height: auto; }
.fx-divider--label { display: flex; align-items: center; gap: var(--fx-space-md); height: auto; background: none; color: var(--fx-color-muted); font-size: var(--fx-t-caption-size); }
.fx-divider--label::before, .fx-divider--label::after { content: ""; flex: 1; height: var(--fx-stroke); background: var(--fx-color-border); }

.fx-link { display: inline-flex; align-items: center; gap: 4px; font-weight: 500; color: var(--fx-color-accent); align-self: flex-start; }
.fx-link--neutral { color: var(--fx-color-text); } .fx-link--danger { color: var(--fx-color-danger); }
.fx-link--underline span { text-decoration: underline; text-underline-offset: 3px; }

.fx-stat { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fx-stat-label { display: flex; align-items: center; gap: 6px; font-size: var(--fx-t-label-size); color: var(--fx-color-muted); font-weight: 500; }
.fx-stat-value { font-size: 28px; line-height: 1.15; font-weight: 650; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.fx-stat-foot { display: flex; align-items: center; gap: 8px; font-size: var(--fx-t-caption-size); }
.fx-stat-delta { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; }

.fx-progress { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fx-progress-head { display: flex; justify-content: space-between; font-size: var(--fx-t-label-size); font-weight: 500; }
.fx-progress-track { height: 8px; border-radius: 999px; background: var(--fx-color-surface2); overflow: hidden; }
.fx-progress-bar { height: 100%; border-radius: 999px; }

/* ---------- form ---------- */
.fx-button {
  appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; align-self: flex-start;
  height: var(--fx-button-height); padding: 0 14px; border-radius: var(--fx-button-radius);
  border: var(--fx-stroke) solid transparent; font-size: var(--fx-t-label-size); font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer;
}
.fx-row > .fx-button, .fx-topbar-actions > .fx-button { align-self: center; }
.fx-button--sm { height: calc(var(--fx-button-height) - 8px); padding: 0 10px; font-size: var(--fx-t-caption-size); gap: 6px; }
.fx-button--lg { height: calc(var(--fx-button-height) + 8px); padding: 0 20px; font-size: var(--fx-t-body-size); }
.fx-button--full { align-self: stretch; width: 100%; }
.fx-button--icon { width: var(--fx-button-height); padding: 0; }
.fx-button--icon.fx-button--sm { width: calc(var(--fx-button-height) - 8px); }
.fx-button--primary { background: var(--fx-color-accent); color: var(--fx-color-accentText); box-shadow: var(--fx-shadow-sm); }
.fx-button--secondary { background: var(--fx-color-surface); color: var(--fx-color-text); border-color: var(--fx-color-border); box-shadow: var(--fx-shadow-sm); }
.fx-button--ghost { background: transparent; color: var(--fx-color-text); }
.fx-button--danger { background: var(--fx-color-danger); color: #fff; }
.fx-button--link { background: none; color: var(--fx-color-accent); padding: 0; height: auto; }
.fx-button[disabled] { opacity: .5; cursor: not-allowed; }

.fx-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fx-field-label { font-size: var(--fx-t-label-size); font-weight: var(--fx-t-label-weight); line-height: var(--fx-t-label-lh); color: var(--fx-color-text); }
.fx-required { color: var(--fx-color-danger); margin-left: 2px; }
.fx-field-hint { font-size: var(--fx-t-caption-size); line-height: var(--fx-t-caption-lh); color: var(--fx-color-muted); }
.fx-field-error { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fx-t-caption-size); color: var(--fx-color-danger); }
.fx-control {
  display: flex; align-items: center; gap: 8px; min-width: 0; height: var(--fx-input-height); padding: 0 12px;
  background: var(--fx-color-surface); border: var(--fx-stroke) solid var(--fx-color-border); border-radius: var(--fx-input-radius);
  box-shadow: var(--fx-shadow-sm);
}
.fx-control.is-error { border-color: var(--fx-color-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fx-color-danger) 14%, transparent); }
.fx-control.is-disabled { opacity: .6; background: var(--fx-color-surface2); }
.fx-control input, .fx-control select { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; padding: 0; }
.fx-control input::placeholder, .fx-textarea::placeholder, .fx-placeholder, .fx-select.is-placeholder select { color: var(--fx-color-muted); opacity: 1; }
.fx-input-suffix { color: var(--fx-color-muted); font-size: var(--fx-t-label-size); }
.fx-select select { appearance: none; cursor: pointer; }
.fx-select-chevron { color: var(--fx-color-muted); pointer-events: none; }
.fx-textarea { height: auto; padding: 10px 12px; resize: none; display: block; width: 100%; line-height: var(--fx-t-body-lh); outline: 0; }

.fx-check, .fx-radio { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.fx-check input, .fx-radio input, .fx-switch input { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; }
.fx-check-box { flex: none; width: 18px; height: 18px; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; border: 1.5px solid color-mix(in srgb, var(--fx-color-muted) 60%, var(--fx-color-border)); background: var(--fx-color-surface); color: transparent; }
.fx-check input:checked + .fx-check-box { background: var(--fx-color-accent); border-color: var(--fx-color-accent); color: var(--fx-color-accentText); }
.fx-check-box svg { stroke-width: 3; }
.fx-check-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fx-radio-dot { flex: none; width: 18px; height: 18px; margin-top: 1px; border-radius: 999px; border: 1.5px solid color-mix(in srgb, var(--fx-color-muted) 60%, var(--fx-color-border)); background: var(--fx-color-surface); }
.fx-radio.is-checked .fx-radio-dot { border: 5px solid var(--fx-color-accent); }
.fx-radio-options { display: flex; flex-direction: column; gap: 10px; }
.fx-radio-group--row .fx-radio-options { flex-direction: row; flex-wrap: wrap; gap: var(--fx-space-lg); }
.fx-radio-group--cards .fx-radio { padding: 12px 14px; border: var(--fx-stroke) solid var(--fx-color-border); border-radius: var(--fx-radius-md); background: var(--fx-color-surface); }
.fx-radio-group--cards .fx-radio.is-checked { border-color: var(--fx-color-accent); box-shadow: 0 0 0 1px var(--fx-color-accent); }
.fx-radio-group--cards.fx-radio-group--row .fx-radio { flex: 1; }

.fx-toggle { display: flex; align-items: center; justify-content: space-between; gap: var(--fx-space-lg); cursor: pointer; }
.fx-toggle--bare { display: inline-flex; }
.fx-toggle-label { font-weight: 500; }
.fx-switch { position: relative; flex: none; display: inline-flex; }
.fx-switch-track { width: 36px; height: 20px; border-radius: 999px; background: color-mix(in srgb, var(--fx-color-muted) 35%, var(--fx-color-surface2)); position: relative; transition: background .15s; }
.fx-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
.fx-switch input:checked + .fx-switch-track { background: var(--fx-color-accent); }
.fx-switch input:checked + .fx-switch-track::after { transform: translateX(16px); }
.is-disabled { opacity: .55; }

/* ---------- data ---------- */
.fx-table-wrap { display: flex; flex-direction: column; min-width: 0; }
.fx-table-wrap--framed { background: var(--fx-color-surface); border: var(--fx-stroke) solid var(--fx-color-border); border-radius: var(--fx-card-radius); overflow: hidden; }
.fx-table-scroll { overflow-x: auto; }
.fx-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.fx-table th { text-align: left; font-size: var(--fx-t-caption-size); font-weight: 600; color: var(--fx-color-muted); white-space: nowrap; padding: 10px 16px; border-bottom: var(--fx-stroke) solid var(--fx-color-border); }
.fx-table--filled th { background: var(--fx-color-surface2); text-transform: uppercase; letter-spacing: .05em; font-size: 11px; }
.fx-table td { padding: 12px 16px; border-bottom: var(--fx-stroke) solid var(--fx-color-border); vertical-align: middle; }
.fx-table tbody tr:last-child td { border-bottom: 0; }
.fx-table--dense td { padding: 8px 16px; }
.fx-table--zebra tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--fx-color-surface2) 55%, transparent); }
.fx-table-wrap:not(.fx-table-wrap--framed) th:first-child, .fx-table-wrap:not(.fx-table-wrap--framed) td:first-child { padding-left: 0; }
.fx-td-check { width: 44px; }
.fx-td-check .fx-check-box { margin: 0; }
.fx-td-actions { width: 44px; text-align: right; }
.fx-cell-lead { display: inline-flex; align-items: center; gap: 10px; }
.fx-cell-stack { display: inline-flex; flex-direction: column; line-height: 1.35; }
.fx-cell-sub { font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }
.fx-table-footer { padding: 10px 16px; font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); border-top: var(--fx-stroke) solid var(--fx-color-border); }
.fx-table-wrap:not(.fx-table-wrap--framed) .fx-table-footer { padding-left: 0; }

.fx-list { display: flex; flex-direction: column; min-width: 0; }
.fx-list--inset { background: var(--fx-color-surface); border: var(--fx-stroke) solid var(--fx-color-border); border-radius: var(--fx-card-radius); overflow: hidden; }
.fx-list-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; min-width: 0; }
.fx-list--inset .fx-list-item { padding: 12px 16px; }
.fx-list--dense .fx-list-item { padding-top: 8px; padding-bottom: 8px; }
.fx-list--divided .fx-list-item + .fx-list-item { border-top: var(--fx-stroke) solid var(--fx-color-border); }
.fx-list-icon { flex: none; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--fx-radius-md); background: var(--fx-color-surface2); color: var(--fx-color-text); }
${["accent", "info", "success", "warning", "danger"].map((t) => `.fx-list-icon.fx-tone-${t} { color: var(--fx-color-${t}); background: color-mix(in srgb, var(--fx-color-${t}) var(--fx-soft), transparent); }`).join("\n")}
.fx-list-thumb { flex: none; width: 48px; height: 48px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--fx-radius-md); background: color-mix(in srgb, var(--fx-color-muted) 12%, var(--fx-color-surface)); color: var(--fx-color-muted); }
.fx-list-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fx-list-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.fx-list-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fx-list-meta { flex: none; font-size: var(--fx-t-caption-size); color: var(--fx-color-muted); }
.fx-list-sub { font-size: var(--fx-t-label-size); color: var(--fx-color-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fx-list-trail { flex: none; display: inline-flex; align-items: center; gap: 6px; }

/* ---------- navigation ---------- */
.fx-nav ul { display: flex; flex-direction: column; gap: 2px; }
.fx-nav-item { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; border-radius: var(--fx-radius-md); color: var(--fx-color-muted); font-weight: 500; white-space: nowrap; }
.fx-nav-item .fx-icon { opacity: .9; }
.fx-nav-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.fx-nav-item.is-active { color: var(--fx-color-text); }
.fx-nav--active-pill .fx-nav-item.is-active { background: var(--fx-color-surface2); }
.fx-nav--active-pill .fx-nav-item.is-active .fx-icon { color: var(--fx-color-accent); opacity: 1; }
.fx-nav--active-bar .fx-nav-item.is-active { box-shadow: inset 3px 0 0 var(--fx-color-accent); border-radius: 0 var(--fx-radius-md) var(--fx-radius-md) 0; background: color-mix(in srgb, var(--fx-color-accent) 8%, transparent); }
.fx-nav--active-text .fx-nav-item.is-active { color: var(--fx-color-accent); }
.fx-nav-badge { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--fx-color-surface2); color: var(--fx-color-muted); font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
.fx-nav-item.is-active .fx-nav-badge { background: var(--fx-color-accent); color: var(--fx-color-accentText); }
.fx-nav-heading { margin: var(--fx-space-md) 0 4px; padding: 0 10px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--fx-color-muted); }
.fx-nav-sub { margin-left: 18px; padding-left: 10px; border-left: var(--fx-stroke) solid var(--fx-color-border); }
.fx-nav-item--nested { height: 32px; font-size: var(--fx-t-label-size); }
.fx-nav--horizontal ul { flex-direction: row; gap: 4px; }
.fx-nav--horizontal .fx-nav-heading { display: none; }
.fx-nav--horizontal.fx-nav--active-bar .fx-nav-item.is-active { box-shadow: inset 0 -2px 0 var(--fx-color-accent); border-radius: 0; }

.fx-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: var(--fx-t-label-size); color: var(--fx-color-muted); flex-wrap: wrap; }
.fx-crumb.is-current { color: var(--fx-color-text); font-weight: 500; }

.fx-pagination { display: flex; align-items: center; justify-content: space-between; gap: var(--fx-space-md); font-size: var(--fx-t-label-size); }
.fx-pages { display: flex; align-items: center; gap: 4px; }
.fx-page { min-width: 32px; height: 32px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--fx-radius-md); border: var(--fx-stroke) solid var(--fx-color-border); background: var(--fx-color-surface); font-weight: 500; }
.fx-page.is-active { background: var(--fx-color-accent); border-color: var(--fx-color-accent); color: var(--fx-color-accentText); }
.fx-page-gap { color: var(--fx-color-muted); padding: 0 4px; }

/* ---------- lo-fi ---------- */
[data-fx-fidelity="lo"] .fx-image-box { background:
  linear-gradient(to top right, transparent calc(50% - 0.75px), var(--fx-color-border) calc(50% - 0.75px), var(--fx-color-border) calc(50% + 0.75px), transparent calc(50% + 0.75px)),
  linear-gradient(to bottom right, transparent calc(50% - 0.75px), var(--fx-color-border) calc(50% - 0.75px), var(--fx-color-border) calc(50% + 0.75px), transparent calc(50% + 0.75px)),
  var(--fx-color-surface); border-color: var(--fx-color-border); }
[data-fx-fidelity="lo"] .fx-avatar-disc { background: var(--fx-color-surface2); color: var(--fx-color-muted); border: var(--fx-stroke) solid var(--fx-color-border); }
[data-fx-fidelity="lo"] .fx-control, [data-fx-fidelity="lo"] .fx-button { box-shadow: none; }
`;

/** Styles for the canvas page around frames (not part of any frame). */
export const CANVAS_CSS = String.raw`
html, body { margin: 0; padding: 0; }
body.fx-canvas-page { min-height: 100vh; background: var(--fx-canvas-bg, #e7e8ec); font-family: "Inter Variable", system-ui, sans-serif; }
body.fx-canvas-page[data-fx-mode="dark"] { --fx-canvas-bg: #050609; --fx-canvas-label: #8b91a7; }
.fx-canvas-head { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 12px; padding: 12px 20px; font-size: 13px; color: var(--fx-canvas-label, #5f6472); background: color-mix(in srgb, var(--fx-canvas-bg, #e7e8ec) 85%, transparent); backdrop-filter: blur(8px); }
.fx-canvas-head b { color: inherit; font-weight: 600; }
.fx-canvas { position: relative; margin: 24px 40px 80px; }
.fx-canvas .fx-frame-slot { position: absolute; }
.fx-frame-label { font-size: 12px; font-weight: 500; color: var(--fx-canvas-label, #5f6472); margin: 0 0 8px 2px; }
.fx-canvas .fx-frame { box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 24px -8px rgba(0,0,0,.18); border-radius: 4px; }
body.fx-frame-page { margin: 0; background: transparent; }
body.fx-frame-page .fx-frame { border-radius: 0; }
`;

export const UNKNOWN_CSS = String.raw`
.fx-unknown { display: flex; align-items: center; justify-content: center; min-height: 40px; padding: 8px; border: 1.5px dashed var(--fx-color-danger); border-radius: var(--fx-radius-sm); color: var(--fx-color-danger); font-size: 12px; font-family: var(--fx-font-mono); }
`;
