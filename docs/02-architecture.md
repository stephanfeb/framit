# 02 · Architecture

## Overview

Framit is three pieces sharing one document store on disk.

```
┌──────────────────────┐   stdio/MCP   ┌─────────────────────────────────────┐
│  MCP client          │◄─────────────►│  framit (one process)               │
│  (Claude Code, etc.) │               │                                     │
└──────────────────────┘               │  ┌───────────────┐  ┌────────────┐  │
                                       │  │ MCP server    │  │ Preview &  │  │
┌──────────────────────┐   http/ws     │  │ (tools,       │  │ edit server│  │
│  Browser             │◄─────────────►│  │  resources)   │  │ (localhost)│  │
│  (canvas + runtime)  │               │  └───────┬───────┘  └─────┬──────┘  │
└──────────────────────┘               │          │                │         │
                                       │          ▼                ▼         │
                                       │  ┌──────────────────────────────┐   │
                                       │  │ Renderer  (doc + theme → HTML)│   │
                                       │  └──────────────┬───────────────┘   │
                                       │                 │                   │
                                       │  ┌──────────────▼───────────────┐   │
                                       │  │ Document store  (.framit/)   │   │
                                       │  └──────────────────────────────┘   │
                                       │                                     │
                                       │  Headless Chromium (screenshots)    │
                                       └─────────────────────────────────────┘
```

### 1. MCP server

Speaks MCP over stdio. Exposes tools for themes, screens, diagrams, flows, rendering, and
export, plus resources for discovery. It never holds state the store does not have.
See [05-mcp-interface.md](05-mcp-interface.md).

### 2. Preview and edit server

A small HTTP server on localhost, started lazily by the MCP server the first time a render is
requested and kept alive for the process lifetime. It:

- serves the canvas page for a project, screen, diagram, or flow,
- serves the editor runtime (JS and CSS) and the theme stylesheet,
- accepts edit patches from the browser over HTTP (`PATCH /api/doc/screen/:id`) and
  pushes change notifications to open tabs over Server-Sent Events (`/api/events`) so a
  model-driven rewrite shows up without a manual reload (ADR-009).

`/s/:id` is the editor; `/s/:id?static` serves the plain canvas without the runtime, and
`/s/:id/f/:fid` a single frame for screenshots.

Port is chosen automatically and reported in tool results. Binds to 127.0.0.1 only.

### 3. Renderer

A pure function: `(document, theme) → HTML string`. No I/O. Used by the preview server, the
static exporter, and the screenshot pipeline. Because it is pure, it is also the easiest piece
to test: fixtures in, HTML out, snapshot compared.

The rendered HTML contains:

- one `<section data-frame>` per frame, absolutely positioned on the canvas,
- inside each frame, ordinary flow-layout HTML built from CSS grid and flexbox,
- `data-node="<id>"` on every element that corresponds to a document node,
- the theme as CSS custom properties on `:root` plus a component stylesheet,
- for diagrams, an SVG overlay for edges with nodes as HTML.

### Document store

Per project, in the working directory the MCP client was launched from:

```
.framit/
  project.json              # name, default theme, default device frames
  themes/
    <theme-id>.json         # tokens + component variants + prose notes
    <theme-id>.css          # generated; never hand-edited
  screens/
    <screen-id>.json
  diagrams/
    <diagram-id>.json
  flows/
    <flow-id>.json
  exports/                  # png, pdf, html produced by `export`
  .cache/                   # screenshots, rendered html; safe to delete
```

JSON on disk is the single source of truth. Both the browser (via patches) and the MCP
tools (via writes) mutate it. Everything else is derived.

### Screenshot pipeline

Playwright with headless Chromium. After `render` (or on request via `screenshot`) the server
loads the preview URL in a page sized to the frame, waits for fonts, and captures PNG. The
image is returned inline in the tool result so the calling model sees what it built. This
loop is the main quality mechanism: the model notices truncation, overlap, and bad spacing
and corrects before a human ever looks.

## Data flow

### Model writes a screen

1. Client calls `write_screen` with a document.
2. Server validates against the schema, assigns IDs to nodes that lack them, writes JSON.
3. Server renders, screenshots, and returns `{ id, url, screenshot, warnings }`.
4. Any open browser tab for that screen receives an SSE `change` event and re-fetches.

### Human edits on the canvas

1. Runtime detects a change (text commit, drag end, variant switch).
2. Runtime sends a JSON Patch (RFC 6902) scoped to node IDs: `PATCH /api/doc/screens/<id>`.
3. Server applies the patch to the JSON, validates, writes, bumps `revision`.
4. Server responds with the new revision. Runtime does not re-render from the response; the
   DOM is already correct. Other tabs are notified.

### Model reads after human edits

`read_screen` returns the current JSON, including `revision` and `updatedAt`. Models are
instructed (in tool descriptions) to read before overwriting a screen they did not create in
the current turn.

## Concurrency

Single user, local machine. Rules:

- The file on disk is truth.
- Human patches apply immediately.
- Model writes carry an optional `expectedRevision`. If it does not match, the write is
  rejected with the current document so the model can merge. If omitted, last write wins.
- No locking beyond atomic file replace (write temp, rename).

## Process model and lifecycle

- One process per MCP client session.
- Preview server starts on first render; shuts down when stdio closes.
- Chromium launches on first screenshot and is reused; closed on exit.
- No daemons, no background services left behind.

## Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Language | TypeScript | MCP SDK is first-class; same language across server and runtime |
| Runtime | Node 20+ (Bun-compatible) | Playwright requires Node; Bun used for dev speed where it works |
| MCP | `@modelcontextprotocol/sdk` | Official |
| HTTP | Hono | Tiny, typed, runs on Node and Bun |
| Validation | Zod | Schema doubles as the `describe_dsl` output via JSON Schema export |
| Screenshots | Playwright (Chromium only) | Reliable, fonts load, sized viewports |
| Diagram layout | elkjs | Layered layout with ports and groups; runs in Node |
| Editor runtime | Vanilla TS, no framework | Small surface, shipped inside every page, must stay light |
| Build | tsup for server, esbuild for runtime bundle | Fast, zero config |
| Tests | Vitest + snapshot HTML + Playwright visual diffs for the runtime | |

## Security posture

- Preview server binds to loopback only.
- Patches are validated against the schema; arbitrary HTML in `raw` nodes is sanitised
  (scripts stripped) before render.
- The server reads and writes only inside `.framit/` of the launch directory and
  `exports/` paths the user names.
