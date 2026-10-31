import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Browser runtimes: `editor` (the canvas editor) and `player` (present mode, exported HTML,
 * flow canvas). The published package serves the prebuilt dist/runtime/<name>.js. When
 * running from source (tests, `bun src/...`), each is bundled in memory with esbuild on first
 * request so it can never be stale.
 */

export type RuntimeName = "editor" | "player";

const cached = new Map<RuntimeName, Promise<{ code: string }>>();

export function loadRuntime(name: RuntimeName = "editor"): Promise<{ code: string }> {
  let p = cached.get(name);
  if (!p) {
    p = (async () => {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const fromSource = here.split(path.sep).includes("src");
      if (!fromSource) return { code: await readFile(path.join(here, "runtime", `${name}.js`), "utf8") };
      const { build } = await import("esbuild");
      const entry = path.resolve(here, "..", "runtime", `${name}.ts`);
      // The player is inlined into exported files, so keep it minified and without source maps.
      const out = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, minify: name === "player", sourcemap: name === "player" ? false : "inline" });
      return { code: out.outputFiles[0]!.text };
    })();
    p.catch(() => cached.delete(name));
    cached.set(name, p);
  }
  return p;
}

/** For tests that rebuild the runtime between cases. */
export function resetRuntimeCache() {
  cached.clear();
}
