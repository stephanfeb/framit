// Bundles the browser runtimes (src/runtime) into dist/runtime/: editor.js and player.js.
// Kept separate from tsup because it targets the browser, not Node.
import { build } from "esbuild";

await build({
  entryPoints: { editor: "src/runtime/editor.ts", player: "src/runtime/player.ts", diagram: "src/runtime/diagram.ts" },
  outdir: "dist/runtime",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  logLevel: "info",
});
