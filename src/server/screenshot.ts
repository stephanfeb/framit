import type { Browser } from "playwright";
import { FramitError } from "../errors.js";

export interface CaptureOptions {
  width: number;
  height: number;
  /** Device pixel ratio. Defaults to 2 for phone-width frames so text stays legible, else 1. */
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

/** Launch headless Chromium: Playwright's bundled build, else an installed Chrome or Edge. */
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const attempts: Array<Parameters<typeof chromium.launch>[0]> = [{}, { channel: "chrome" }, { channel: "msedge" }];
  const errors: string[] = [];
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch (err) {
      errors.push((err as Error).message.split("\n")[0]!);
    }
  }
  throw new FramitError("BROWSER", "No Chromium-based browser available for screenshots.", {
    hint: "Run `npx playwright install chromium`, or install Google Chrome. The document was still saved.",
    data: { errors },
  });
}

/**
 * Headless Chromium screenshots (ADR-007). The browser launches on first use and is reused.
 * Tries Playwright's bundled Chromium, then an installed Chrome or Edge.
 */
export class Screenshotter {
  private browser: Promise<Browser> | undefined;

  private launch(): Promise<Browser> {
    this.browser ??= launchChromium().catch((err) => {
      this.browser = undefined;
      throw err;
    });
    return this.browser;
  }

  async capture(url: string, opts: CaptureOptions): Promise<Capture> {
    const browser = await this.launch();
    const scale = opts.scale ?? (opts.width < 640 ? 2 : 1);
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
    const b = this.browser;
    this.browser = undefined;
    if (b) await (await b.catch(() => undefined))?.close().catch(() => undefined);
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
  const extra = Math.round(fr.height - args.deviceHeight);
  if (extra > 4) issues.push({ message: `Content is ${extra}px taller than the ${args.deviceHeight}px viewport (the page scrolls).` });
  return issues;
}
