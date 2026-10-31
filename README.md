# Framit

A local MCP server that turns text descriptions into editable, themed wireframes: desktop and
mobile screens, architecture diagrams, and user flows. Output is a live HTML canvas you can
edit in the browser, and edits round-trip to the source so later sessions stay consistent.

Status: M4 (architecture diagrams) complete. See [docs/](docs/README.md) and `docs/07-roadmap.md`.

## Quick orientation

- `docs/01-vision.md` – what and why
- `docs/02-architecture.md` – how it fits together
- `docs/06-decisions.md` – the choices that matter, with reasons

Issues: `bd ready`.

## Development

```bash
npm install
npm run build      # server -> dist/cli.js, browser runtime -> dist/runtime/editor.js
npm test           # vitest
npm run typecheck
```

### Using Framit from Claude Code

Inside this repo, `.mcp.json` registers the local build at project scope, so a Claude Code
session started here picks up the `framit` tools after `npm run build` (approve the server
when prompted).

To use it from any other project, register it at user scope with an absolute path:

```bash
claude mcp add -s user framit -- node /absolute/path/to/framit/dist/cli.js serve
```

Framit stores everything in `.framit/` under the directory Claude Code was started in.
Override with `--root <dir>` or the `FRAMIT_ROOT` environment variable.

### Tools available today (M4)

| Area | Tools |
|------|-------|
| Project | `get_project`, `init_project` |
| Discovery | `describe_dsl` (guide + component reference), `list_components` |
| Themes | `list_themes`, `get_theme`, `create_theme`, `update_theme`, `delete_theme` |
| Screens | `write_screen`, `patch_screen`, `read_screen`, `list_screens`, `delete_screen`, `duplicate_screen` |
| Flows | `write_flow`, `patch_flow`, `read_flow`, `list_flows`, `delete_flow` |
| Diagrams | `write_diagram`, `patch_diagram`, `read_diagram`, `list_diagrams`, `delete_diagram` |
| Output | `render` (preview URL + screenshots), `export` (PNG, PDF, offline HTML prototype) |

Writes return a PNG of every frame so the calling model can check its work. Screenshots use
Playwright's Chromium if installed (`npx playwright install chromium`), otherwise an installed
Google Chrome or Edge. Set `FRAMIT_SCREENSHOTS=0` to disable them.

The preview server starts on first render on a random loopback port (`FRAMIT_PORT` to pin it).
Open the `url` from any tool result to edit the screen: click to select (double-click to drill
in), double-click text to retype it, change props in the floating toolbar or the inspector, drag
to reorder, `/` to insert a component, drag frames by their label. Every edit saves to the
screen document, so the next model session sees it. ⌘Z undoes. Changes made by the model show
up live. `?static` gives the plain canvas.

Prototypes: give a button, link, nav, tab bar or list item a `to` prop naming another screen. Press
`P` in the editor for Preview mode, where those hotspots navigate (browser Back works), or `⌘⇧P` to
present one frame full-window. A flow (`/f/<id>`) lays screens out in order with arrows from their
hotspots; **▶ Play** clicks through it. `export` with `format: "html"` writes one file that works
offline: fonts, theme and every reachable screen inlined.

Diagrams: ask for an architecture drawing ("draw the system context for this repo") and Framit lays
it out with elkjs: layered, with orthogonal arrows, in the project's theme. Open `/d/<id>` to tidy it.
Drag nodes, which pins them; drag the ● handle onto another node to connect them; double-click any
text to edit it. **Auto-layout** removes the pins again.

See [docs/examples](docs/examples/README.md) for what a blind session produces.
