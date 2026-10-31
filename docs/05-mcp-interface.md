# 05 · MCP interface

Framit runs as a stdio MCP server. Register it in the client (Claude Code example):

```json
{
  "mcpServers": {
    "framit": { "command": "npx", "args": ["-y", "framit", "serve"] }
  }
}
```

The server roots itself at the client's working directory and stores everything in
`.framit/` there.

## Design principles for the tool surface

1. **Discoverable.** A model that knows nothing about Framit should be able to call
   `describe_dsl` and `list_components` and then produce a good screen. Tool descriptions
   carry the rules that matter most (read before write; prefer tokens; flow layout only).
2. **Show, don't tell.** Every render returns a screenshot inline. The model is expected to
   look at it and iterate.
3. **Few tools, rich documents.** The document is the API. Tools are mostly CRUD plus render.
4. **Idempotent writes.** Writing the same document twice is a no-op on disk and returns the
   same result.

## Tools

> **Implementation notes (M1).** `describe_dsl` returns Markdown (guide, composition patterns, examples
> and a component reference generated from the registry); the JSON Schema is opt-in via `jsonSchema`.
> `create_theme` takes `from` (copy a theme as the starting point) as well as `extends` (live link).
> Screen and theme documents are passed as plain objects and validated server-side, so the tool list stays
> small and validation errors can carry hints. `screenshot`, `export`, `open` and `lint` are not built yet.


### Project

| Tool | Input | Output |
|------|-------|--------|
| `init_project` | `name?`, `theme?` | Creates `.framit/` with a starter theme. Safe to call repeatedly. |
| `get_project` | – | Project metadata, counts, default theme, preview server URL if running. |

### Themes

| Tool | Input | Output |
|------|-------|--------|
| `create_theme` | `theme` document, or `from: <builtin>` + `overrides` + `notes` | Theme JSON, compiled CSS path, a **swatch sheet screenshot** showing type scale, colours, and every component in every variant. |
| `get_theme` | `id` | Theme JSON with `notes` first, plus the swatch sheet. This is what a fresh session calls to get oriented. |
| `update_theme` | `id`, `patch` (JSON Patch) or `merge` (deep merge) | As `create_theme`. Re-renders affected screens' cached screenshots lazily. |
| `list_themes` | – | IDs, names, fidelity, mode, screen counts. |
| `delete_theme` | `id` | Refuses if any screen references it unless `force`. |

### Screens

| Tool | Input | Output |
|------|-------|--------|
| `write_screen` | `screen` document, `expectedRevision?` | `{ id, revision, url, screenshots: [{frame, png}], warnings[] }`. Creates or replaces. Warnings include text overflow detected by the screenshot pass, unknown placeholder names, and style whitelist rejections. |
| `patch_screen` | `id`, `ops[]` (node-ID addressed JSON Patch), `expectedRevision?` | As `write_screen`. Preferred for small changes so human edits elsewhere in the document survive. |
| `read_screen` | `id`, `include: ["screenshot"]?` | Current document including human edits, comments, and revision. |
| `list_screens` | `theme?` | IDs, names, frames, revision, updatedAt, thumbnail. |
| `delete_screen` | `id` | |
| `duplicate_screen` | `id`, `newId`, `name` | Fresh node IDs throughout. |

### Diagrams and flows

Same CRUD shape: `write_diagram`, `patch_diagram`, `read_diagram`, `list_diagrams`,
`delete_diagram`, and the same five for flows. `write_diagram` output includes the computed
layout (node positions after elk) so the model can reason about it or pin nodes.

### Rendering and export

| Tool | Input | Output |
|------|-------|--------|
| `render` | `kind`, `id`, `frame?` | Ensures preview server is up; returns `url` and screenshots. |
| `screenshot` | `kind`, `id`, `frame?`, `scale?`, `mode: design|preview` | PNG inline, no URL side effects. |
| `export` | `kind`, `id`, `format: png|pdf|html`, `out?` | Writes to `.framit/exports/` or `out`; returns path. `html` is a self-contained file with the theme CSS inlined and the runtime in preview mode only (no editing, no server). |
| `open` | `kind`, `id` | Opens the preview URL in the default browser. |

### Discovery

| Tool | Input | Output |
|------|-------|--------|
| `describe_dsl` | `kind?` | JSON Schema for the requested document kind plus a short prose guide with worked examples. Large; models should call it once per session. |
| `list_components` | `category?` | Component names, one-line purposes, props with types and defaults, and a tiny rendered example each (screenshot strip). |
| `lint` | `kind`, `id` | Runs the checks that `write_*` warns about without rendering a screenshot. Also flags: unthemed colours, missing labels on inputs, buttons without actions in a flow, orphan hotspots. |

## Resources

For clients that surface resources:

| URI | Content |
|-----|---------|
| `framit://dsl/screen`, `framit://dsl/theme`, `framit://dsl/diagram`, `framit://dsl/flow` | JSON Schema |
| `framit://guide` | The prose authoring guide (same text `describe_dsl` returns) |
| `framit://themes/<id>` | Theme JSON |
| `framit://screens/<id>` | Screen JSON |
| `framit://screens/<id>/screenshot` | Latest PNG |

Resource templates are advertised so clients can list them.

## Prompts

Two MCP prompts, as a convenience for clients that support them:

- `new-theme`: walks the model through gathering mode, fidelity, accent, density, and a
  reference product, then calls `create_theme`.
- `wireframe`: given a product description and a list of screens, loops write → look →
  adjust for each, using a named theme.

## Tool description text

The descriptions are part of the product. Each one states, in order: what it does, when to
call it, the one rule that prevents the most common mistake. Example for `write_screen`:

> Create or replace a screen document. Frames are positioned on the canvas; everything inside
> a frame is flow layout (stack, row, grid), never coordinates. Prefer theme tokens over raw
> CSS values. If the screen already exists and you did not write it this turn, call
> `read_screen` first and pass `expectedRevision`, because a person may have edited it in the
> browser. Look at the returned screenshots before reporting success.

## Error model

Errors are MCP tool errors with a `code` and a `hint`:

| Code | Meaning | Hint example |
|------|---------|--------------|
| `SCHEMA` | Document failed validation | Path, message, and the nearest valid alternative ("`style.position` is not allowed; use frame `position` or a layout container") |
| `REVISION` | `expectedRevision` mismatch | Returns `current` document |
| `NOT_FOUND` | Unknown ID | Lists similar IDs |
| `THEME_MISSING` | Screen references a theme that does not exist | Lists themes |
| `RENDER` | Renderer threw | Includes node ID |
| `BROWSER` | Chromium unavailable | Install instructions; the write still succeeded |

A write never fails because a screenshot failed. The document is saved and the result says
the screenshot is missing.
