// Bundles the browser editor runtime (src/runtime) into dist/runtime/editor.js.
// Kept separate from tsup because it targets the browser, not Node.
import { build } from "esbuild";

await build({
  entryPoints: ["src/runtime/editor.ts"],
  outfile: "dist/runtime/editor.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  logLevel: "info",
});
