/** Chrome of the editor (bar, overlay, toolbar, inspector, palette). Not part of any frame. */
export const EDITOR_CSS = String.raw`
body.fx-editor {
  --ui-bg: #ffffff; --ui-bg2: #f5f6f8; --ui-border: #e3e5ea; --ui-text: #1d2129; --ui-muted: #6b7180;
  --ui-accent: #3b6cff; --ui-accent-soft: rgba(59,108,255,.12); --ui-canvas: #e9eaee; --ui-danger: #e5484d;
  --ui-font: "Inter Variable", system-ui, -apple-system, sans-serif;
  margin: 0; height: 100vh; overflow: hidden; background: var(--ui-canvas); color: var(--ui-text); font: 12px/1.4 var(--ui-font);
  display: grid; grid-template-rows: 44px 1fr; grid-template-columns: 1fr 288px;
}
body.fx-editor[data-fx-mode="dark"] {
  --ui-bg: #17181c; --ui-bg2: #1f2025; --ui-border: #2b2d34; --ui-text: #e6e7eb; --ui-muted: #8d919c; --ui-canvas: #08090c; --ui-accent-soft: rgba(59,108,255,.22);
}
body.fx-editor.fx-panel-hidden { grid-template-columns: 1fr 0; }
body.fx-editor.fx-panel-hidden #fx-inspector { display: none; }
body.fx-editor button { font: inherit; color: inherit; }
#fx-bar { grid-column: 1 / -1; z-index: 30; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 10px; background: var(--ui-bg); border-bottom: 1px solid var(--ui-border); }
.fx-bar-left, .fx-bar-right, .fx-bar-mid { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fx-bar-left { flex: 1; } .fx-bar-right { flex: 1; justify-content: flex-end; }
.fx-bar-home { color: var(--ui-accent); text-decoration: none; font-size: 15px; padding: 0 4px; }
.fx-bar-name { font-weight: 600; white-space: nowrap; }
.fx-bar-meta { color: var(--ui-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fx-bar-right > button { min-width: 30px; height: 28px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: none; cursor: pointer; font-size: 13px; }
.fx-bar-right > button:hover:not(:disabled) { background: var(--ui-bg2); border-color: var(--ui-border); }
.fx-bar-right > button:disabled { opacity: .35; cursor: default; }
#fx-zoom { font-variant-numeric: tabular-nums; min-width: 52px !important; font-size: 12px !important; }
.fx-seg { display: flex; padding: 2px; background: var(--ui-bg2); border: 1px solid var(--ui-border); border-radius: 8px; }
.fx-seg button { border: 0; background: none; padding: 4px 12px; border-radius: 6px; cursor: pointer; color: var(--ui-muted); font-weight: 500; }
.fx-seg button.is-on { background: var(--ui-bg); color: var(--ui-text); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.fx-status { color: var(--ui-muted); white-space: nowrap; }
.fx-status.is-error { color: var(--ui-danger); }

#fx-viewport { position: relative; overflow: hidden; grid-row: 2; grid-column: 1; touch-action: none; }
#fx-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
#fx-canvas .fx-frame-slot { position: absolute; }
#fx-canvas .fx-frame { box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 28px -10px rgba(0,0,0,.22); }
.fx-frame-label { font: 500 calc(12px / var(--fx-z, 1))/1 var(--ui-font); color: var(--ui-muted); margin: 0 0 calc(8px / var(--fx-z, 1)) 1px; white-space: nowrap; user-select: none; cursor: default; }
body[data-mode="design"] .fx-frame-label { cursor: grab; }
body[data-mode="design"] .fx-frame-label:hover, .fx-frame-slot.is-selected > .fx-frame-label { color: var(--ui-accent); }
body[data-mode="design"] #fx-canvas .fx-frame, body[data-mode="design"] #fx-canvas .fx-frame * { cursor: default !important; user-select: none; }
body[data-mode="design"] #fx-canvas [contenteditable] { cursor: text !important; user-select: text; outline: none; }
body.fx-panning, body.fx-panning * { cursor: grabbing !important; }
body.fx-space #fx-viewport, body.fx-space #fx-viewport * { cursor: grab !important; }

#fx-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 20; }
body[data-mode="preview"] #fx-overlay { display: none; }
.fx-ov-box { position: absolute; box-sizing: border-box; border: 1.5px solid var(--ui-accent); pointer-events: none; }
.fx-ov-hover { border-width: 1px; border-style: solid; opacity: .75; }
.fx-ov-parent { border: 1px dashed var(--ui-accent); opacity: .5; }
.fx-ov-tag { position: absolute; transform: translateY(-100%); margin-top: -3px; padding: 2px 6px; border-radius: 4px; background: var(--ui-accent); color: #fff; font: 500 10.5px/1.4 var(--ui-font); white-space: nowrap; pointer-events: none; }
.fx-ov-tag i { font-style: normal; opacity: .7; margin-left: 4px; }
.fx-ov-handle { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; background: #fff; border: 1.5px solid var(--ui-accent); border-radius: 2px; pointer-events: auto; box-sizing: border-box; }
.fx-ov-handle[data-h="e"] { cursor: ew-resize; } .fx-ov-handle[data-h="s"] { cursor: ns-resize; } .fx-ov-handle[data-h="se"] { cursor: nwse-resize; }
.fx-ov-handle.is-off { background: var(--ui-bg2); border-color: var(--ui-border); pointer-events: none; }
.fx-ov-drop { position: absolute; background: var(--ui-accent); border-radius: 2px; pointer-events: none; }
.fx-ov-drop-target { position: absolute; border: 1.5px dashed var(--ui-accent); background: var(--ui-accent-soft); pointer-events: none; }
.fx-ov-marquee { position: absolute; border: 1px solid var(--ui-accent); background: var(--ui-accent-soft); }
.fx-ov-editing { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 2px; }

.fx-toolbar { position: absolute; display: flex; align-items: center; gap: 2px; padding: 4px; background: var(--ui-bg); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 10px; box-shadow: 0 6px 24px -6px rgba(0,0,0,.28); pointer-events: auto; font: 12px/1 var(--ui-font); white-space: nowrap; }
.fx-toolbar button, .fx-toolbar select { height: 28px; min-width: 28px; padding: 0 7px; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; font: inherit; }
.fx-toolbar button:hover, .fx-toolbar select:hover { background: var(--ui-bg2); }
.fx-toolbar button.is-on { background: var(--ui-accent-soft); color: var(--ui-accent); }
.fx-toolbar select { appearance: none; padding-right: 18px; background: no-repeat right 5px center / 8px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E"); }
.fx-toolbar .fx-tb-sep { width: 1px; height: 18px; background: var(--ui-border); margin: 0 3px; }
.fx-toolbar .fx-tb-type { padding: 0 8px 0 6px; color: var(--ui-muted); font-weight: 500; }
.fx-toolbar .fx-tb-danger:hover { color: var(--ui-danger); }

#fx-inspector { grid-row: 2; grid-column: 2; z-index: 25; overflow: auto; background: var(--ui-bg); border-left: 1px solid var(--ui-border); }
.fx-insp-empty { padding: 20px 16px; color: var(--ui-muted); line-height: 1.9; }
kbd { font: 500 10.5px/1 var(--ui-font); padding: 2px 5px; border: 1px solid var(--ui-border); border-bottom-width: 2px; border-radius: 4px; background: var(--ui-bg2); color: var(--ui-text); }
.fx-insp-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--ui-border); }
.fx-insp-type { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.fx-insp-id { font: 11px/1 ui-monospace, monospace; color: var(--ui-muted); }
.fx-insp-summary { margin-top: 6px; color: var(--ui-muted); }
.fx-insp-crumbs { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 8px; color: var(--ui-muted); }
.fx-insp-crumbs a { cursor: pointer; } .fx-insp-crumbs a:hover { color: var(--ui-accent); }
.fx-insp-section { padding: 10px 16px 14px; border-bottom: 1px solid var(--ui-border); }
.fx-insp-section h4 { margin: 0 0 8px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ui-muted); }
.fx-field-row { display: grid; grid-template-columns: 92px 1fr; align-items: center; gap: 8px; margin: 6px 0; }
.fx-field-row > label { color: var(--ui-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fx-field-row.is-wide { grid-template-columns: 1fr; }
.fx-field-row input[type=text], .fx-field-row input[type=number], .fx-field-row select, .fx-field-row textarea {
  width: 100%; box-sizing: border-box; height: 28px; padding: 0 8px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg2); color: var(--ui-text); font: 12px var(--ui-font); outline: none;
}
.fx-field-row textarea { height: auto; min-height: 64px; padding: 6px 8px; font: 11px/1.45 ui-monospace, SFMono-Regular, monospace; resize: vertical; }
.fx-field-row input:focus, .fx-field-row select:focus, .fx-field-row textarea:focus { border-color: var(--ui-accent); background: var(--ui-bg); }
.fx-field-row textarea.is-invalid { border-color: var(--ui-danger); }
.fx-field-row input[type=checkbox] { justify-self: start; width: 14px; height: 14px; accent-color: var(--ui-accent); }
.fx-insp-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.fx-insp-actions button { height: 26px; padding: 0 10px; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-bg2); cursor: pointer; }
.fx-insp-actions button:hover { border-color: var(--ui-accent); }

.fx-palette-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(10,12,16,.25); display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; pointer-events: auto; }
.fx-palette { width: 440px; max-height: 60vh; display: flex; flex-direction: column; background: var(--ui-bg); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 12px; box-shadow: 0 24px 64px -12px rgba(0,0,0,.4); overflow: hidden; font: 13px/1.4 var(--ui-font); }
.fx-palette input { border: 0; border-bottom: 1px solid var(--ui-border); padding: 14px 16px; font: 14px var(--ui-font); background: none; color: inherit; outline: none; }
.fx-palette ul { list-style: none; margin: 0; padding: 6px; overflow: auto; }
.fx-palette li { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.fx-palette li span { color: var(--ui-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fx-palette li.is-active { background: var(--ui-accent-soft); }
.fx-palette .fx-palette-hint { padding: 8px 16px; border-top: 1px solid var(--ui-border); color: var(--ui-muted); font-size: 11.5px; }

#fx-toasts { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 50; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.fx-toast { padding: 8px 14px; border-radius: 8px; background: #1d2129; color: #fff; font: 12.5px/1.4 var(--ui-font); box-shadow: 0 8px 24px -8px rgba(0,0,0,.4); animation: fx-toast-in .15s ease-out; }
.fx-toast.is-error { background: var(--ui-danger); }
@keyframes fx-toast-in { from { opacity: 0; transform: translateY(6px); } }
`;
