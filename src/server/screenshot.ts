import type { Browser } from "playwright";
import { FramitError } from "../errors.js";

export interface CaptureOptions {
  width: number;
  height: number;
  /**
   * Device pixel ratio, default 1. Image tokens scale with pixels: a phone frame at 1x is ~500
   * tokens and fully legible; at 2x it was ~1500. Desktop frames are downscaled by the model's
   * image pipeline anyway.
   */
  scale?: number;
  /** Stop capturing below this many CSS pixels. */
  maxHeight?: number;
  /** CSS selector of the element to capture. */
  selector?: string;
  /** Wait for this selector before capturing (pages that finish drawing in script). */
  waitFor?: string;
  /** Skip the layout checks (they only make sense for single frames). */
  noIssues?: boolean;
}

export interface LayoutIssue {
  node?: string;
  message: string;
}

export interface Capture {
  png: Buffer;
  width: number;
  height: number;
  issues: LayoutIssue[];
}

export const BROWSER_HINT =
  "Run `npx framit install-browser` (downloads the Chromium build matching Framit's Playwright), or install Google Chrome. Documents are still saved; only screenshots and export need a browser.";

export interface BrowserStatus {
  ok: boolean;
  /** Which browser launched: Playwright's Chromium, Google Chrome or Microsoft Edge. */
  via?: string;
  version?: string;
  hint?: string;
  errors?: string[];
}

const CANDIDATES: Array<{ via: string; channel?: string }> = [{ via: "Playwright Chromium" }, { via: "Google Chrome", channel: "chrome" }, { via: "Microsoft Edge", channel: "msedge" }];

/** Launch headless Chromium: Playwright's bundled build, else an installed Chrome or Edge. */
export async function launchBrowser(): Promise<{ browser: Browser; via: string }> {
  const { chromium } = await import("playwright");
  const errors: string[] = [];
  for (const c of CANDIDATES) {
    try {
      return { browser: await chromium.launch({ headless: true, ...(c.channel ? { channel: c.channel } : {}) }), via: c.via };
    } catch (err) {
      errors.push(`${c.via}: ${(err as Error).message.split("\n")[0]!}`);
    }
  }
  throw new FramitError("BROWSER", "No Chromium-based browser available for screenshots.", { hint: BROWSER_HINT, data: { errors } });
}

export async function launchChromium(): Promise<Browser> {
  return (await launchBrowser()).browser;
}

/**
 * Headless Chromium screenshots (ADR-007). The browser launches on first use and is reused.
 * Tries Playwright's bundled Chromium, then an installed Chrome or Edge.
 */
export class Screenshotter {
  private launched: Promise<{ browser: Browser; via: string }> | undefined;

  private async launch(): Promise<Browser> {
    this.launched ??= launchBrowser().catch((err) => {
      this.launched = undefined;
      throw err;
    });
    return (await this.launched).browser;
  }

  /** Launch (or reuse) the browser and say which one it is, or why there is none. */
  async status(): Promise<BrowserStatus> {
    try {
      const browser = await this.launch();
      return { ok: true, via: (await this.launched!).via, version: browser.version() };
    } catch (err) {
      const e = err as FramitError;
      return { ok: false, hint: e.hint ?? BROWSER_HINT, errors: (e.data as { errors?: string[] } | undefined)?.errors ?? [e.message] };
    }
  }

  async capture(url: string, opts: CaptureOptions): Promise<Capture> {
    const browser = await this.launch();
    const scale = opts.scale ?? 1;
    const context = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: scale });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 10_000 });
      const selector = opts.selector ?? ".fx-frame";
      const el = page.locator(selector).first();
      const box = await el.boundingBox();
      if (!box) throw new FramitError("RENDER", `Nothing to capture at ${selector}.`);
      const height = Math.min(box.height, opts.maxHeight ?? opts.height * 4);
      const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height }, fullPage: true, type: "png" });
      const issues = opts.noIssues ? [] : await page.evaluate(detectLayoutIssues, { selector, deviceHeight: opts.height });
      if (box.height > height) issues.push({ message: `Screenshot truncated at ${Math.round(height)}px of ${Math.round(box.height)}px.` });
      return { png, width: Math.round(box.width), height: Math.round(height), issues };
    } finally {
      await context.close();
    }
  }

  /** The layout checks of `capture`, without taking (or returning) an image. */
  async inspect(url: string, opts: CaptureOptions): Promise<LayoutIssue[]> {
    return this.withPage({ width: opts.width, height: opts.height }, async (page) => {
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 10_000 });
      return page.evaluate(detectLayoutIssues, { selector: opts.selector ?? ".fx-frame", deviceHeight: opts.height });
    });
  }

  /** Diagram nodes whose text does not fit their box (the size estimate was too small). */
  async inspectBoard(url: string, viewport: { width: number; height: number }): Promise<LayoutIssue[]> {
    return this.withPage(viewport, async (page) => {
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      return page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-dnode]")).flatMap((n) => {
          const box = n.getBoundingClientRect();
          const over = Array.from(n.querySelectorAll<HTMLElement>("*")).reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom - box.bottom), 0);
          return over > 1 ? [{ node: n.dataset.dnode, message: `Text in this node is clipped by ${Math.round(over)}px. Shorten the description or tech line.` }] : [];
        }),
      );
    });
  }

  /** Run `fn` with a fresh page in its own context (closed afterwards). */
  async withPage<T>(viewport: { width: number; height: number }, fn: (page: import("playwright").Page) => Promise<T>): Promise<T> {
    const browser = await this.launch();
    const context = await browser.newContext({ viewport });
    try {
      return await fn(await context.newPage());
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    const l = this.launched;
    this.launched = undefined;
    if (l) await (await l.catch(() => undefined))?.browser.close().catch(() => undefined);
  }
}

/** Runs in the page. Finds content that spills out of the frame or is clipped horizontally. */
function detectLayoutIssues(args: { selector: string; deviceHeight: number }): LayoutIssue[] {
  const frame = document.querySelector(args.selector) as HTMLElement | null;
  if (!frame) return [];
  const issues: LayoutIssue[] = [];
  const fr = frame.getBoundingClientRect();
  const seen = new Set<string>();
  for (const el of Array.from(frame.querySelectorAll<HTMLElement>("[data-node]"))) {
    const id = el.dataset.node!;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > fr.right + 1 && !seen.has(id)) {
      // Report only the outermost offender, not every descendant.
      const parentOffends = el.parentElement?.closest("[data-node]") && (el.parentElement.closest("[data-node]") as HTMLElement).getBoundingClientRect().right > fr.right + 1;
      if (!parentOffends) issues.push({ node: id, message: `${el.dataset.type} overflows the frame by ${Math.round(r.right - fr.right)}px horizontally.` });
      seen.add(id);
    }
  }
  for (const sc of Array.from(frame.querySelectorAll<HTMLElement>(".fx-table-scroll"))) {
    if (sc.scrollWidth > sc.clientWidth + 1) {
      const owner = sc.closest("[data-node]") as HTMLElement | null;
      issues.push({ node: owner?.dataset.node, message: `table is ${sc.scrollWidth - sc.clientWidth}px wider than its container and scrolls horizontally; consider fewer columns or a list on narrow frames.` });
    }
  }
  // Text cut off by an ellipsis or a fixed size: the element's content is wider/taller than its box.
  let truncated = 0;
  for (const el of Array.from(frame.querySelectorAll<HTMLElement>("[data-node], [data-node] *"))) {
    if (truncated >= 8 || el.closest(".fx-table-scroll")) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    // A text box: has text, and no component nodes inside it (those are checked on their own).
    if (!el.textContent!.trim() || el.querySelector("[data-node]") || el.querySelector("svg, img")) continue;
    const wide = el.scrollWidth - el.clientWidth, tall = el.scrollHeight - el.clientHeight;
    if (wide <= 1 && tall <= 2) continue;
    const owner = el.closest("[data-node]") as HTMLElement | null;
    const text = el.textContent!.trim().replace(/\s+/g, " ");
    issues.push({ node: owner?.dataset.node, message: `${owner?.dataset.type ?? "text"} "${text.length > 40 ? `${text.slice(0, 40)}…` : text}" is cut off${cs.textOverflow === "ellipsis" ? " with an ellipsis" : ""}. Shorten it or give it more room.` });
    truncated++;
  }
  const extra = Math.round(fr.height - args.deviceHeight);
  if (extra > 4) issues.push({ message: `Content is ${extra}px taller than the ${args.deviceHeight}px viewport (the page scrolls).` });
  return issues;
}
