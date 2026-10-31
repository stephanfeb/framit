import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FramitError } from "../errors.js";
import { renderPlayerPage, renderPrintPage, type ProtoFrame } from "../renderer/prototype.js";
import { fontDataUrls } from "./assets.js";
import type { PreviewServer } from "./preview.js";
import { buildFlowView, buildPlayer, renderScreenFrames, type ProtoTarget, type ProtoWarning } from "./prototype.js";
import { renderBoard, renderDiagramPage } from "../renderer/diagram.js";

export type ExportTarget = ProtoTarget | { kind: "diagram"; id: string };
import { loadRuntime } from "./runtime-bundle.js";
import type { Screenshotter } from "./screenshot.js";
import type { Workspace } from "./workspace.js";

/*
 * `export` (docs/05-mcp-interface.md): PNG per frame, one PDF with a page per frame, or one
 * self-contained HTML prototype (fonts, theme CSS, every reachable frame and the player
 * runtime inlined; no server needed).
 */

export type ExportFormat = "png" | "pdf" | "html";

export interface ExportResult {
  format: ExportFormat;
  files: Array<{ path: string; bytes: number; frame?: string; screen?: string }>;
  warnings: ProtoWarning[];
}

/**
 * Where an export goes. Default: .framit/exports/<id>.<ext> (PNG: a folder). `out` is taken
 * relative to the project root and must stay inside it (docs/02-architecture.md "Security").
 */
export function exportPath(root: string, base: string, target: ExportTarget, format: ExportFormat, out?: string): string {
  const name = target.kind === "screen" ? target.id : `${target.kind}-${target.id}`;
  if (!out) return path.join(base, "exports", format === "png" ? name : `${name}.${format}`);
  const abs = path.resolve(root, out);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new FramitError("SCHEMA", `Export path "${out}" is outside the project.`, { hint: "Give a path inside the project, e.g. design/onboarding.html." });
  if (format !== "png" && path.extname(abs).toLowerCase() !== `.${format}`) throw new FramitError("SCHEMA", `Export path for ${format} must end in .${format}.`);
  return abs;
}

/** The self-contained HTML prototype. */
export async function exportHtml(ws: Workspace, target: ProtoTarget): Promise<{ html: string; warnings: ProtoWarning[] }> {
  const p = await buildPlayer(ws, target);
  const [{ code }, fonts] = await Promise.all([loadRuntime("player"), fontDataUrls()]);
  const inline = code.replace(/\n?\/\/# sourceMappingURL=.*$/m, "");
  return { html: renderPlayerPage(p, { inlineFonts: fonts, script: { inline } }), warnings: p.warnings };
}

async function framesFor(ws: Workspace, target: ProtoTarget): Promise<ProtoFrame[]> {
  if (target.kind === "flow") return (await buildFlowView(ws, target.id)).steps;
  const all = await renderScreenFrames(ws, target.id);
  if (!target.frame) return all;
  const one = all.filter((f) => f.frame === target.frame);
  if (!one.length) throw new FramitError("NOT_FOUND", `Screen "${target.id}" has no frame "${target.frame}".`);
  return one;
}

export async function runExport(
  deps: { ws: Workspace; preview: PreviewServer; shots: Screenshotter },
  target: ExportTarget,
  format: ExportFormat,
  out?: string,
): Promise<ExportResult> {
  const { ws, preview, shots } = deps;
  const dest = exportPath(ws.store.root, ws.store.base, target, format, out);
  if (target.kind === "diagram") return exportDiagram(deps, target.id, format, dest);

  if (format === "html") {
    const { html, warnings } = await exportHtml(ws, target);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, html);
    return { format, files: [{ path: dest, bytes: Buffer.byteLength(html) }], warnings };
  }

  const frames = await framesFor(ws, target);
  if (format === "png") {
    await mkdir(dest, { recursive: true });
    const url = await preview.ensureStarted();
    const files: ExportResult["files"] = [];
    let i = 0;
    for (const f of frames) {
      const cap = await shots.capture(`${url}/s/${encodeURIComponent(f.screen)}/f/${encodeURIComponent(f.frame)}`, { width: f.width, height: f.height, scale: 2, maxHeight: 12_000, noIssues: true });
      const file = path.join(dest, `${target.kind === "flow" ? `${String(++i).padStart(2, "0")}-${f.screen}-` : ""}${f.frame}.png`);
      await writeFile(file, cap.png);
      files.push({ path: file, bytes: cap.png.length, frame: f.frame, screen: f.screen });
    }
    if (target.kind === "flow") {
      const v = await buildFlowView(ws, target.id);
      const cap = await shots.capture(`${url}/f/${encodeURIComponent(target.id)}?shot`, { width: v.width + 48, height: v.height + 48, scale: v.width > 2400 ? 1 : 2, selector: "#fx-flow-wrap", waitFor: "body[data-ready]", maxHeight: 12_000, noIssues: true });
      const file = path.join(dest, "00-flow.png");
      await writeFile(file, cap.png);
      files.unshift({ path: file, bytes: cap.png.length });
    }
    return { format, files, warnings: [] };
  }

  // PDF: one page per frame, each page sized to its frame's rendered size.
  const html = renderPrintPage(target.id, frames, { inlineFonts: await fontDataUrls() });
  const width = Math.max(...frames.map((f) => f.width));
  const pdf = await shots.withPage({ width, height: 900 }, async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".fx-print-page > .fx-frame")).map((f) => {
        const r = f.getBoundingClientRect();
        return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
      }),
    );
    await page.addStyleTag({ content: sizes.map((s, i) => `@page p${i} { size: ${s.w}px ${s.h}px; margin: 0 } .fx-print-page[data-page="${i}"] { page: p${i} }`).join("\n") });
    return page.pdf({ printBackground: true, preferCSSPageSize: true });
  });
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, pdf);
  return { format, files: [{ path: dest, bytes: (await stat(dest)).size }], warnings: [] };
}

/** Diagrams export as one board: a static HTML page, one PNG, or a one-page PDF. */
async function exportDiagram(deps: { ws: Workspace; shots: Screenshotter }, id: string, format: ExportFormat, dest: string): Promise<ExportResult> {
  const { diagram, theme, layout } = await deps.ws.diagram(id);
  const html = renderDiagramPage(diagram, layout, theme, { inlineFonts: await fontDataUrls() });
  const warnings = layout.warnings.map((w) => ({ node: w.node, message: w.message }));
  if (format === "html") {
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, html);
    return { format, files: [{ path: dest, bytes: Buffer.byteLength(html) }], warnings };
  }
  const { width, height } = renderBoard(diagram, layout, theme);
  const bytes = await deps.shots.withPage({ width, height }, async (page) => {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    if (format === "png") return page.locator(".fx-board").screenshot({ type: "png", scale: "device" });
    await page.addStyleTag({ content: `@page { size: ${width}px ${height}px; margin: 0 }` });
    return page.pdf({ printBackground: true, preferCSSPageSize: true });
  });
  const file = format === "png" ? path.join(dest, `${id}.png`) : dest;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return { format, files: [{ path: file, bytes: bytes.length }], warnings };
}
