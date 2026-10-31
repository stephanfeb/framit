import { FramitError } from "../errors.js";
import { Screen, validate } from "../schema/screen.js";
import type { ResolvedTheme } from "../schema/theme.js";
import { BUILTIN_THEMES } from "../themes/builtin.js";
import { resolveTheme } from "../themes/resolve.js";
import type { Store, StoredDoc } from "../store/store.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileThemeCss } from "../renderer/theme-css.js";
import { applyPatch, type PatchOp } from "../store/patch.js";

/**
 * Domain operations shared by the MCP tools and the preview server: theme resolution
 * (including copying built-ins into the project on first use, ADR-008) and typed loading
 * of screens.
 */
export class Workspace {
  constructor(readonly store: Store) {}

  /** Load a stored theme document, copying a built-in theme into the project if needed. */
  async themeDoc(id: string): Promise<StoredDoc> {
    try {
      return await this.store.read("theme", id);
    } catch (err) {
      if (err instanceof FramitError && err.code === "NOT_FOUND" && BUILTIN_THEMES[id]) {
        const { doc } = await this.store.write("theme", { ...BUILTIN_THEMES[id], kind: "theme" });
        await this.writeThemeCss(await this.resolve(doc));
        return doc;
      }
      if (err instanceof FramitError && err.code === "NOT_FOUND") {
        const known = [...new Set([...(await this.store.list("theme")).map((t) => t.id), ...Object.keys(BUILTIN_THEMES)])];
        throw new FramitError("THEME_MISSING", `No theme "${id}".`, { hint: `Available themes: ${known.join(", ")}. Or create one with create_theme.` });
      }
      throw err;
    }
  }

  async theme(id: string): Promise<ResolvedTheme> {
    return this.resolve(await this.themeDoc(id));
  }

  resolve(doc: Record<string, unknown>): Promise<ResolvedTheme> {
    return resolveTheme(doc, async (baseId) => {
      try {
        return await this.themeDoc(baseId);
      } catch {
        return undefined;
      }
    });
  }

  /** Keep `.framit/themes/<id>.css` in sync with the theme JSON (generated; never hand-edited). */
  async writeThemeCss(theme: ResolvedTheme): Promise<void> {
    const dir = path.join(this.store.base, "themes");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${theme.id}.css`), compileThemeCss(theme));
  }

  async screen(id: string): Promise<{ doc: StoredDoc; screen: Screen; theme: ResolvedTheme }> {
    const doc = await this.store.read("screen", id);
    const screen = validate(Screen, doc, `screen "${id}"`);
    const themeId = screen.theme ?? (await this.store.getProject()).defaultTheme;
    return { doc, screen, theme: await this.theme(themeId) };
  }

  /**
   * Apply node-addressed ops to a screen and save it. When `baseRevision` is stale, ops that
   * are fully node-addressed are rebased onto the current document (they target nodes by id,
   * so unrelated concurrent edits do not invalidate them); anything else is a REVISION error.
   */
  async patchScreen(id: string, ops: PatchOp[], opts: { baseRevision?: number; source?: string } = {}): Promise<{ doc: StoredDoc; changed: boolean; rebased: boolean }> {
    const current = await this.store.read("screen", id);
    const stale = opts.baseRevision !== undefined && current.revision !== opts.baseRevision;
    if (stale && !ops.every((o) => o.node !== undefined && (o.op !== "move" && o.op !== "copy" ? true : o.fromNode !== undefined || o.from === undefined))) {
      throw new FramitError("REVISION", `Screen "${id}" is at revision ${current.revision}, not ${opts.baseRevision}.`, { hint: "Re-read it and reapply your change.", data: { current } });
    }
    let next: StoredDoc;
    try {
      next = applyPatch(current, ops);
    } catch (err) {
      if (stale && err instanceof FramitError) throw new FramitError("REVISION", `Screen "${id}" changed underneath this edit: ${err.message}`, { data: { current } });
      throw err;
    }
    validate(Screen, next, "patched screen");
    if (typeof next.theme === "string") await this.theme(next.theme);
    const { doc, changed } = await this.store.write("screen", next, { expectedRevision: current.revision, source: opts.source });
    return { doc, changed, rebased: stale };
  }

  async defaultThemeId(): Promise<string> {
    return (await this.store.getProject()).defaultTheme;
  }
}
