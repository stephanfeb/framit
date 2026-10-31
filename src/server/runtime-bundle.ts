import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The browser editor runtime. The published package serves the prebuilt
 * dist/runtime/editor.js. When running from source (tests, `bun src/...`), it is bundled in
 * memory with esbuild on first request so it can never be stale.
 */

let cached: Promise<{ code: string }> | undefined;

export function loadRuntime(): Promise<{ code: string }> {
  cached ??= (async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fromSource = here.split(path.sep).includes("src");
    if (!fromSource) return { code: await readFile(path.join(here, "runtime", "editor.js"), "utf8") };
    const { build } = await import("esbuild");
    const entry = path.resolve(here, "..", "runtime", "editor.ts");
    const out = await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", target: "es2022", write: false, minify: false, sourcemap: "inline" });
    return { code: out.outputFiles[0]!.text };
  })();
  cached.catch(() => (cached = undefined));
  return cached;
}

/** For tests that rebuild the runtime between cases. */
export function resetRuntimeCache() {
  cached = undefined;
}
