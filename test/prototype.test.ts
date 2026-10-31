import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { runExport } from "../src/server/export.js";
import { PreviewServer } from "../src/server/preview.js";
import { launchChromium, Screenshotter } from "../src/server/screenshot.js";
import { Workspace } from "../src/server/workspace.js";
import { Store } from "../src/store/store.js";
import { ALL_SET, ONBOARDING_FLOW, VERIFY, WELCOME } from "./fixtures/onboarding.js";

// M3: preview-mode navigation, present mode, the flow canvas and exports, in a real browser.

let root: string;
let store: Store;
let ws: Workspace;
let preview: PreviewServer;
let shots: Screenshotter;
let url: string;
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "framit-proto-"));
  store = new Store(root);
  await store.init({ name: "Prototype test" });
  ws = new Workspace(store);
  await ws.themeDoc("wire-mid-light");
  for (const s of [WELCOME, VERIFY, ALL_SET]) await store.write("screen", s);
  await store.write("flow", ONBOARDING_FLOW);
  preview = new PreviewServer(ws);
  url = await preview.ensureStarted();
  shots = new Screenshotter();
  try {
    browser = await launchChromium();
  } catch {
    browser = undefined;
  }
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await shots.close();
  await preview.close();
  await rm(root, { recursive: true, force: true });
});

async function open(target: string, viewport = { width: 1200, height: 900 }) {
  context = await browser!.newContext({ viewport });
  page = await context.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err));
  await page.goto(target);
  await page.waitForSelector("body[data-ready='1']");
}
afterEach(async () => {
  await context?.close().catch(() => undefined);
});

const hudTitle = () => page.locator('[data-hud="title"]').textContent();
const shown = () => page.evaluate(() => location.hash);

describe("prototype", { timeout: 30_000 }, () => {
  it("presents a flow: hotspots, steps, tabs, back", async (ctx) => {
    if (!browser) return ctx.skip();
    await open(`${url}/p/flow/onboarding`);
    expect(await shown()).toBe("#/welcome/f_phone");
    expect(await hudTitle()).toBe("Welcome · 1 / 3");
    // w_cta has no `to`: the flow's explicit edge makes it a hotspot.
    await page.locator('.fx-device [data-node="w_cta"]').click();
    await page.waitForFunction(() => location.hash === "#/verify-email/f_phone", null, { timeout: 3000 });
    await expect.poll(hudTitle).toBe("Verify email · 2 / 3");
    await page.locator(".fx-device input").first().fill("123456"); // live control, ephemeral
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => location.hash === "#/all-set/f_phone", null, { timeout: 3000 });
    const budgets = page.locator(".fx-device .fx-tab", { hasText: "Budgets" });
    await budgets.click();
    await expect.poll(() => budgets.getAttribute("class")).toContain("is-active");
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#/verify-email/f_phone", null, { timeout: 3000 });
    await page.locator('[data-hud="prev"]').click();
    await page.waitForFunction(() => location.hash === "#/welcome/f_phone", null, { timeout: 3000 });
  });

  it("keeps the device when following a hotspot in present mode", async (ctx) => {
    if (!browser) return ctx.skip();
    await open(`${url}/p/screen/welcome?frame=f_desk`, { width: 1600, height: 1000 });
    expect(await shown()).toBe("#/welcome/f_desk");
    await page.locator('.fx-device [data-node="w_dcta"]').click();
    await page.waitForFunction(() => location.hash === "#/verify-email/f_desk", null, { timeout: 3000 });
    await expect.poll(() => page.locator('.fx-device [data-node="v_dtitle"]').count()).toBe(1);
  });

  it("draws the flow canvas with an arrow per link", async (ctx) => {
    if (!browser) return ctx.skip();
    await open(`${url}/f/onboarding`);
    expect(await page.evaluate(() => document.body.dataset.edges)).toBe("3");
    expect(await page.locator('#fx-edges g[data-from="welcome/w_cta"] .fx-edge--explicit').count()).toBe(1);
    expect(await page.locator("#fx-edges .fx-edge-label text").textContent()).toBe("Tap Get started");
    expect(await page.locator(".fx-step").count()).toBe(3);
  });

  it("navigates in the editor's preview mode, goes back, and restores on leaving it", async (ctx) => {
    if (!browser) return ctx.skip();
    await open(`${url}/s/welcome`, { width: 1600, height: 1000 });
    const desk = () => page.locator('.fx-frame-slot[data-slot="f_desk"] > .fx-frame');
    // Design mode: a hotspot click selects, it does not navigate.
    await page.locator('[data-node="w_dcta"]').click();
    expect(await desk().getAttribute("data-screen")).toBe("welcome");
    await page.keyboard.press("p");
    await page.locator('[data-node="w_dcta"]').click();
    await expect.poll(() => desk().getAttribute("data-screen")).toBe("verify-email");
    expect(await page.locator('.fx-frame-slot[data-slot="f_phone"] > .fx-frame').getAttribute("data-screen")).toBe("welcome");
    await page.goBack();
    await expect.poll(() => desk().getAttribute("data-screen")).toBe("welcome");
    await page.locator('[data-node="w_dcta"]').click();
    await expect.poll(() => desk().getAttribute("data-screen")).toBe("verify-email");
    await page.keyboard.press("v");
    await expect.poll(() => desk().getAttribute("data-screen")).toBe("welcome");
    expect((await store.read("screen", "welcome")).revision).toBe(1);
    await page.keyboard.press("Meta+Shift+P");
    await page.waitForURL(/\/p\/screen\/welcome/);
  });

  it("exports a PDF with a page per step and PNGs per step plus an overview", async (ctx) => {
    if (!browser) return ctx.skip();
    const pdf = await runExport({ ws, preview, shots }, { kind: "flow", id: "onboarding" }, "pdf");
    const bytes = await readFile(pdf.files[0]!.path, "latin1");
    expect(bytes.startsWith("%PDF")).toBe(true);
    expect(bytes.match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(3);
    const png = await runExport({ ws, preview, shots }, { kind: "flow", id: "onboarding" }, "png");
    expect((await readdir(path.dirname(png.files[0]!.path))).sort()).toEqual(["00-flow.png", "01-welcome-f_phone.png", "02-verify-email-f_phone.png", "03-all-set-f_phone.png"]);
  });
});

describe("M3 acceptance", () => {
  it("a three-screen onboarding flow clicks through from one exported HTML file, offline", { timeout: 60_000 }, async (ctx) => {
    if (!browser) return ctx.skip();
    const r = await runExport({ ws, preview, shots }, { kind: "flow", id: "onboarding" }, "html", "exports/onboarding.html");
    const file = r.files[0]!.path;
    expect(file).toBe(path.join(root, "exports", "onboarding.html"));

    // Offline: the page may not fetch anything but itself.
    context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const requests: string[] = [];
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith("file:")) return route.continue();
      requests.push(u);
      return route.abort();
    });
    page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector("body[data-ready='1']");
    expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);

    await page.locator('.fx-device [data-node="w_cta"]').click();
    await page.waitForFunction(() => location.hash === "#/verify-email/f_phone", null, { timeout: 3000 });
    await page.locator('.fx-device [data-node="v_done"]').click();
    await page.waitForFunction(() => location.hash === "#/all-set/f_phone", null, { timeout: 3000 });
    await expect.poll(hudTitle).toBe("All set · 3 / 3");
    await page.locator('.fx-device [data-node="a_title"]').waitFor();
    // And back through history, as a browser would.
    await page.goBack();
    await page.waitForFunction(() => location.hash === "#/verify-email/f_phone", null, { timeout: 3000 });
    expect(requests).toEqual([]);
  });
});
