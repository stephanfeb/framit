import type { ResolvedTheme } from "../schema/theme.js";
import { esc } from "./html.js";
import { pageHead, type PageOptions } from "./render.js";

/*
 * Pages for clicking through and presenting screens (docs/04-editor-runtime.md "Preview mode
 * specifics"): the player (present mode and the self-contained HTML export), the flow canvas
 * and the print page used for PDF export. All are pure functions of pre-rendered frames.
 */

/** One rendered frame of one screen, ready to place on a page. */
export interface ProtoFrame {
  screen: string;
  screenName: string;
  frame: string;
  name?: string;
  device: string;
  width: number;
  height: number;
  html: string;
  theme: ResolvedTheme;
}

export interface ProtoStep {
  screen: string;
  frame: string;
  label: string;
}

export type ScriptRef = { src: string } | { inline: string };

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const script = (s: ScriptRef) => ("src" in s ? `<script type="module" src="${esc(s.src)}"></script>` : `<script type="module">${s.inline.replace(/<\/script/gi, "<\\/script")}</script>`);
const frameMeta = (f: ProtoFrame) => ({ screen: f.screen, screenName: f.screenName, frame: f.frame, name: f.name, device: f.device, width: f.width, height: f.height });

const PLAYER_CSS = String.raw`
body.fx-player { margin: 0; height: 100vh; overflow: hidden; background: #16171b; font: 12px/1.4 "Inter Variable", system-ui, sans-serif; color: #e6e7eb; }
body.fx-player[data-fx-mode="light"] { background: #dfe1e6; }
#fx-stage { position: fixed; inset: 0 0 52px 0; display: grid; place-items: center; }
.fx-device-box { position: relative; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,.18), 0 24px 60px -20px rgba(0,0,0,.5); }
.fx-device { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; }
.fx-device > .fx-frame { min-height: 100% !important; }
.fx-player [data-to] { cursor: pointer; }
.fx-player.fx-hints [data-to] { outline: 2px solid rgba(59,108,255,.7); outline-offset: 2px; border-radius: 4px; }
#fx-hud { position: fixed; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 2px; align-items: center; padding: 4px; border-radius: 999px;
  background: rgba(24,25,29,.92); border: 1px solid #2c2e35; color: #e6e7eb; box-shadow: 0 6px 20px rgba(0,0,0,.25); white-space: nowrap; user-select: none; }
#fx-hud button, #fx-hud a { border: 0; background: none; color: inherit; font: inherit; min-width: 30px; height: 28px; padding: 0 8px; border-radius: 999px; cursor: pointer; text-decoration: none; display: inline-grid; place-items: center; }
#fx-hud button:hover:not(:disabled), #fx-hud a:hover { background: #2c2e35; }
#fx-hud button:disabled { opacity: .3; cursor: default; }
#fx-hud .fx-hud-title { padding: 0 10px; color: #b5b8c1; max-width: 46vw; overflow: hidden; text-overflow: ellipsis; }
#fx-hud .fx-hud-title b { color: #fff; font-weight: 600; }
#fx-hud .fx-hud-sep { width: 1px; height: 16px; background: #2c2e35; margin: 0 2px; }
#fx-hud button.is-on { background: #3b6cff; color: #fff; }
.fx-toast-mini { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); background: #24262c; color: #fff; padding: 6px 12px; border-radius: 8px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
`;

/**
 * The player: one frame full-bleed, hotspots navigate between screens. Every reachable frame
 * is embedded as a <template>, so the page needs no server (it is also the HTML export).
 */
export function renderPlayerPage(
  data: { title: string; frames: ProtoFrame[]; start: { screen: string; frame: string }; steps?: ProtoStep[]; exit?: string; live?: boolean },
  opts: PageOptions & { script: ScriptRef },
): string {
  const startFrame = data.frames.find((f) => f.screen === data.start.screen && f.frame === data.start.frame) ?? data.frames[0]!;
  const boot = { title: data.title, start: { screen: startFrame.screen, frame: startFrame.frame }, steps: data.steps ?? [], exit: data.exit, live: data.live ?? false, frames: data.frames.map(frameMeta) };
  const templates = data.frames.map((f) => `<template data-fx-screen="${esc(f.screen)}" data-fx-frame="${esc(f.frame)}">${f.html}</template>`).join("\n");
  return `${pageHead(data.title, data.frames.map((f) => f.theme), opts, PLAYER_CSS)}<body class="fx-player" data-fx-mode="${startFrame.theme.mode}">
<main id="fx-stage" aria-live="polite"></main>
<nav id="fx-hud" aria-label="Prototype controls"></nav>
${templates}
<script type="application/json" id="fx-player-boot">${json(boot)}</script>
${script(opts.script)}${opts.bodyEnd ?? ""}
</body></html>`;
}

const FLOW_CSS = String.raw`
body.fx-flow-page { margin: 0; min-height: 100vh; background: #eceef2; font: 13px/1.4 "Inter Variable", system-ui, sans-serif; color: #1d2129; }
body.fx-flow-page[data-fx-mode="dark"] { background: #0c0d10; color: #e6e7eb; }
.fx-flow-head { position: sticky; top: 0; z-index: 5; display: flex; gap: 12px; align-items: center; padding: 10px 16px; background: inherit; border-bottom: 1px solid rgba(127,127,127,.2); }
.fx-flow-head a { color: #3b6cff; text-decoration: none; }
.fx-flow-head .fx-flow-meta { color: #6b7180; flex: 1; }
.fx-flow-head .fx-play { background: #3b6cff; color: #fff; padding: 6px 12px; border-radius: 8px; font-weight: 600; }
#fx-flow-wrap { padding: 48px 48px 64px; overflow: auto; }
body.fx-flow-shot #fx-flow-wrap { padding: 24px; overflow: visible; }
body.fx-flow-shot .fx-flow-head { display: none; }
#fx-flow { position: relative; transform-origin: 0 0; }
#fx-flow .fx-frame-slot { position: absolute; }
#fx-flow .fx-frame { box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 28px -10px rgba(0,0,0,.25); border-radius: 4px; overflow: hidden; }
#fx-flow .fx-frame-label { font: 600 13px/1 "Inter Variable", system-ui, sans-serif; margin: 0 0 10px; display: flex; gap: 8px; align-items: center; white-space: nowrap; }
#fx-flow .fx-step-n { display: inline-grid; place-items: center; min-width: 20px; height: 20px; border-radius: 999px; background: #3b6cff; color: #fff; font-size: 11px; }
#fx-flow .fx-step-sub { color: #6b7180; font-weight: 500; }
#fx-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
#fx-edges .fx-edge { fill: none; stroke: #3b6cff; stroke-width: 2; }
#fx-edges .fx-edge--explicit { stroke-dasharray: 6 4; }
#fx-edges .fx-hot { fill: rgba(59,108,255,.08); stroke: #3b6cff; stroke-width: 1.5; }
#fx-edges .fx-edge-dot { fill: #3b6cff; }
#fx-edges .fx-edge-label rect { fill: #3b6cff; }
#fx-edges .fx-edge-label text { fill: #fff; font: 600 12px "Inter Variable", system-ui, sans-serif; }
`;

/** The flow canvas: each step's frame in a row, arrows drawn by the runtime from hotspots. */
export function renderFlowPage(
  data: {
    flow: { id: string; name: string; description?: string };
    steps: Array<ProtoFrame & { label: string; x: number; y: number }>;
    edges: Array<{ from: { screen: string; node: string }; to: string; label?: string; explicit: boolean }>;
    width: number;
    height: number;
    shot?: boolean;
    live?: boolean;
  },
  opts: PageOptions & { script: ScriptRef },
): string {
  const mode = data.steps[0]?.theme.mode ?? "light";
  const slots = data.steps
    .map(
      (s, i) =>
        `<div class="fx-frame-slot fx-step" data-step="${i}" data-step-screen="${esc(s.screen)}" style="left:${s.x}px;top:${s.y}px"><div class="fx-frame-label"><span class="fx-step-n">${i + 1}</span>${esc(s.label)}<span class="fx-step-sub">${esc(s.screen)}${s.name ? ` · ${esc(s.name)}` : ""}</span></div>${s.html}</div>`,
    )
    .join("");
  const meta = `${data.steps.length} screen${data.steps.length === 1 ? "" : "s"} · ${data.edges.length} link${data.edges.length === 1 ? "" : "s"}${data.flow.description ? ` · ${esc(data.flow.description)}` : ""}`;
  return `${pageHead(`${data.flow.name} · Flow`, data.steps.map((s) => s.theme), opts, FLOW_CSS)}<body class="fx-flow-page${data.shot ? " fx-flow-shot" : ""}" data-fx-mode="${mode}">
<header class="fx-flow-head"><a href="/" title="All documents">◆</a><b>${esc(data.flow.name)}</b><span class="fx-flow-meta">${meta}</span><a class="fx-play" href="/p/flow/${esc(data.flow.id)}">▶ Play</a></header>
<div id="fx-flow-wrap"><div id="fx-flow" data-flow="${esc(data.flow.id)}" style="width:${data.width}px;height:${data.height}px">${slots}<svg id="fx-edges" width="${data.width}" height="${data.height}" xmlns="http://www.w3.org/2000/svg"></svg></div></div>
<script type="application/json" id="fx-flow-boot">${json({ edges: data.edges, shot: data.shot ?? false, live: data.live ?? false })}</script>
${script(opts.script)}${opts.bodyEnd ?? ""}
</body></html>`;
}

/** Frames one after another, one per printed page (PDF export sizes each page in the browser). */
export function renderPrintPage(title: string, frames: ProtoFrame[], opts: PageOptions = {}): string {
  const css = `body.fx-print{margin:0;background:#fff}.fx-print-page{break-after:page;width:max-content}.fx-print-page:last-child{break-after:auto}.fx-print-page .fx-frame{box-shadow:none}@page{margin:0}`;
  return `${pageHead(title, frames.map((f) => f.theme), opts, css)}<body class="fx-print">${frames.map((f, i) => `<div class="fx-print-page" data-page="${i}">${f.html}</div>`).join("")}${opts.bodyEnd ?? ""}</body></html>`;
}
