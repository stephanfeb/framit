import { defineConfig } from "tsup";

// Server bundle. The browser runtime is built separately by scripts/build-runtime.mjs.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
});
