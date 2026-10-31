import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { createMcpServer } from "./server/mcp.js";
import { Store } from "./store/store.js";
import { VERSION } from "./version.js";

const USAGE = `framit ${VERSION}

Usage:
  framit serve [--root <dir>]   Run the MCP server over stdio (default command)
  framit --version
  framit --help

The project root defaults to $FRAMIT_ROOT, then the current directory.
Documents are stored in <root>/.framit/.`;

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
  return { command, root };
}

async function main() {
  const { command, root } = parseArgs(process.argv.slice(2));
  if (command === "help") return void console.log(USAGE);
  if (command === "version") return void console.log(VERSION);
  if (command !== "serve") throw new Error(`Unknown command "${command}".\n\n${USAGE}`);

  const store = new Store(path.resolve(root ?? process.env.FRAMIT_ROOT ?? process.cwd()), VERSION);
  const server = createMcpServer(store);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; everything human-readable goes to stderr.
  console.error(`[framit] ${VERSION} serving ${store.root}`);
}

main().catch((err) => {
  console.error(`[framit] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
