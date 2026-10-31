import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Bundled fonts, by the file name base CSS refers to (/assets/fonts/<name>). */
export const FONTS: Record<string, string> = {
  "inter.woff2": "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "jetbrains-mono.woff2": "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
};

export function readFont(name: string): Promise<Uint8Array<ArrayBuffer>> | undefined {
  const pkg = FONTS[name];
  return pkg ? readFile(require.resolve(pkg)).then((b) => new Uint8Array(b)) : undefined;
}

let dataUrls: Promise<Record<string, string>> | undefined;

/** Font name → base64 data: URL, for self-contained exports. */
export function fontDataUrls(): Promise<Record<string, string>> {
  dataUrls ??= (async () => {
    const out: Record<string, string> = {};
    for (const name of Object.keys(FONTS)) out[name] = `data:font/woff2;base64,${Buffer.from((await readFont(name))!).toString("base64")}`;
    return out;
  })();
  return dataUrls;
}
