import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFramitServer } from "./server/mcp.js";
import { Screenshotter } from "./server/screenshot.js";
import { STORE_DIRNAME, Store } from "./store/store.js";
import { PACKAGE, VERSION } from "./version.js";

const USAGE = `framit ${VERSION}

Usage:
  framit serve [--root <dir>]    Run the MCP server over stdio (default command)
  framit doctor [--root <dir>]   Check Node, the project root and the screenshot browser,
                                 and print how to add Framit to an MCP client
  framit install-browser         Download the Chromium build Framit's Playwright expects
  framit --version
  framit --help

The project root defaults to $FRAMIT_ROOT, then the current directory.
Documents are stored in <root>/${STORE_DIRNAME}/.`;

function parseArgs(argv: string[]) {
  const args = [...argv];
  let command = "serve";
  let root: string | undefined;
  while (args.length) {
    const a = args.shift()!;
    if (a === "--help" || a === "-h") command = "help";
    else if (a === "--version" || a === "-v") command = "version";
    else if (a === "--root") root = args.shift();
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (!a.startsWith("-")) command = a;
    else throw new Error(`Unknown option ${a}`);
  }
  return { command, root: path.resolve(root ?? process.env.FRAMIT_ROOT ?? process.cwd()) };
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function serve(root: string) {
  const store = new Store(root, VERSION);
  const framit = createFramitServer(store);
  const transport = new StdioServerTransport();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await framit.close();
    process.exit(0);
  };
  transport.onclose = () => void shutdown();
  process.stdin.on("close", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  await framit.mcp.connect(transport);
  // stdout carries the protocol; everything human-readable goes to stderr.
  console.error(`[framit] ${VERSION} serving ${store.root}`);
  if (process.stdin.isTTY) console.error(`[framit] This is an MCP server speaking over stdio: add it to an MCP client rather than running it in a terminal. See \`framit doctor\`.`);
  else if (!(await exists(store.base))) console.error(`[framit] No ${STORE_DIRNAME}/ here yet; it is created when the model calls init_project.`);
}

async function doctor(root: string): Promise<number> {
  const ok = (s: string) => console.log(`  ✓ ${s}`);
  const bad = (s: string) => console.log(`  ✗ ${s}`);
  const warn = (s: string) => console.log(`  ! ${s}`);
  let failed = false;
  console.log(`framit ${VERSION}\n`);

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) ok(`Node ${process.versions.node}`);
  else (bad(`Node ${process.versions.node}: Framit needs Node 20 or newer.`), (failed = true));

  try {
    await access(root, constants.W_OK);
    const base = path.join(root, STORE_DIRNAME);
    ok(`Project root ${root} is writable; ${(await exists(base)) ? `${STORE_DIRNAME}/ present` : `${STORE_DIRNAME}/ will be created by init_project`}`);
  } catch {
    bad(`Project root ${root} is missing or not writable. Pass --root or set FRAMIT_ROOT.`);
    failed = true;
  }

  const shots = new Screenshotter();
  const b = await shots.status();
  await shots.close();
  if (b.ok) ok(`Screenshots and export: ${b.via} ${b.version}`);
  else {
    warn(`No browser for screenshots and export. ${b.hint}`);
    for (const e of b.errors ?? []) console.log(`      ${e}`);
  }

  const cli = fileURLToPath(import.meta.url);
  const viaNpx = cli.includes(`${path.sep}_npx${path.sep}`);
  console.log(`
Add Framit to Claude Code (run in your project):
  claude mcp add framit -- npx -y ${PACKAGE} serve${viaNpx ? "" : `
or, from this install:
  claude mcp add framit -- node ${cli} serve`}

Other MCP clients (stdio):
  { "mcpServers": { "framit": { "command": "npx", "args": ["-y", "${PACKAGE}", "serve"] } } }
`);
  return failed ? 1 : 0;
}

/** Run the Playwright CLI that Framit depends on, so the browser build matches its version. */
function installBrowser(): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  console.log(`[framit] Installing Chromium for Playwright ${require("playwright/package.json").version}…`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => (console.error(`[framit] ${err.message}`), resolve(1)));
  });
}

async function main() {
  const { command, root } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "help":
      return void console.log(USAGE);
    case "version":
      return void console.log(VERSION);
    case "serve":
      return serve(root);
    case "doctor":
      return process.exit(await doctor(root));
    case "install-browser":
      return process.exit(await installBrowser());
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

main().catch((err) => {
  console.error(`[framit] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
