# Framit

A local MCP server that turns text descriptions into editable, themed wireframes: desktop and
mobile screens, architecture diagrams, and user flows. Output is a live HTML canvas you can
edit in the browser, and edits round-trip to the source so later sessions stay consistent.

Status: M5 (catalogue and polish) complete. See [docs/](docs/README.md) and `docs/07-roadmap.md`.

## Install

Framit needs Node 20 or newer. Add it to Claude Code from the project you want to wireframe:

```bash
claude mcp add framit -- npx -y framit serve
```

Any other MCP client uses the same command over stdio:
`{ "command": "npx", "args": ["-y", "framit", "serve"] }`.

Then ask for something ("wireframe a settings page, desktop and phone"). On its first call the
model creates `.framit/` in the project and gives you the local preview URL, where you can see
and edit everything it draws.

**Screenshots and export need a Chromium-based browser.** Framit uses an installed Google Chrome or
Microsoft Edge if it finds one. Otherwise run `npx framit install-browser` once to download
Playwright's Chromium. Without a browser, documents are still saved and editable; tool results just
come without the screenshots the model uses to check its work.

`npx framit doctor` checks Node, the project folder and the browser, and prints the setup lines.

> The package is not on npm yet. Until it is, build from a checkout (see Development) and register
> the local build: `claude mcp add -s user framit -- node /absolute/path/to/framit/dist/cli.js serve`.
> `npm pack` produces the tarball that would be published.

## Quick orientation

- `docs/01-vision.md` – what and why
- `docs/02-architecture.md` – how it fits together
- `docs/06-decisions.md` – the choices that matter, with reasons

Issues: `bd ready`.

## Development

```bash
npm install
npm run build      # server -> dist/cli.js, browser runtimes -> dist/runtime/{editor,player,diagram}.js
npm test           # vitest
npm run typecheck
```

### Using Framit from Claude Code

Inside this repo, `.mcp.json` registers the local build at project scope, so a Claude Code
session started here picks up the `framit` tools after `npm run build` (approve the server
when prompted).

To use the local build from any other project, register it at user scope with an absolute path
(`node dist/cli.js doctor` prints this line for your checkout):

```bash
claude mcp add -s user framit -- node /absolute/path/to/framit/dist/cli.js serve
```

Framit stores everything in `.framit/` under the directory Claude Code was started in.
Override with `--root <dir>` or the `FRAMIT_ROOT` environment variable.

### Tools available today

| Area | Tools |
|------|-------|
| Project | `get_project`, `init_project` |
| Discovery | `describe_dsl` (guide + component reference), `list_components` |
| Themes | `list_themes`, `get_theme`, `create_theme`, `update_theme`, `delete_theme` |
| Screens | `write_screen`, `patch_screen`, `read_screen`, `list_screens`, `delete_screen`, `duplicate_screen` |
| Flows | `write_flow`, `patch_flow`, `read_flow`, `list_flows`, `delete_flow` |
| Diagrams | `write_diagram`, `patch_diagram`, `read_diagram`, `list_diagrams`, `delete_diagram` |
| Output | `render` (preview URL + screenshots), `export` (PNG, PDF, offline HTML prototype), `lint` (checks without screenshots) |
| Prompts | `new-theme`, `wireframe`, `address-comments` |

Writes return a PNG of every frame so the calling model can check its work. Screenshots use
Playwright's Chromium if installed (`framit install-browser`), otherwise an installed Google Chrome
or Edge; `init_project` reports which. Set `FRAMIT_SCREENSHOTS=0` to disable them.

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

Comments: press `C` in the editor and click any element to pin a comment to it. Claude sees open
comments (`get_project`), changes the screen, replies and resolves them; the `address-comments` prompt
runs that loop. The catalogue has 41 components, including modal, drawer, toast, alert, empty state
and chart sketches. Themes with `fidelity: "lo"` (the `wire-lo` starter) render as hand-drawn sketches.

See [docs/examples](docs/examples/README.md) for what a blind session produces.

## License

Apache License 2.0. See [LICENSE](LICENSE).
