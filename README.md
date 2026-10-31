# Framit

A local MCP server that turns text descriptions into editable, themed wireframes: desktop and
mobile screens, architecture diagrams, and user flows. Output is a live HTML canvas you can
edit in the browser, and edits round-trip to the source so later sessions stay consistent.

Status: M1 (one beautiful screen) complete. See [docs/](docs/README.md) and `docs/07-roadmap.md`.

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

### Tools available today (M1)

| Area | Tools |
|------|-------|
| Project | `get_project`, `init_project` |
| Discovery | `describe_dsl` (guide + component reference), `list_components` |
| Themes | `list_themes`, `get_theme`, `create_theme`, `update_theme`, `delete_theme` |
| Screens | `write_screen`, `patch_screen`, `read_screen`, `list_screens`, `delete_screen`, `duplicate_screen` |
| Output | `render` (preview URL + screenshots) |

Writes return a PNG of every frame so the calling model can check its work. Screenshots use
Playwright's Chromium if installed (`npx playwright install chromium`), otherwise an installed
Google Chrome or Edge. Set `FRAMIT_SCREENSHOTS=0` to disable them.

The preview server starts on first render on a random loopback port (`FRAMIT_PORT` to pin it).
Open the `url` from any tool result to see the canvas; it reloads when the screen changes.

See [docs/examples](docs/examples/README.md) for what a blind session produces.
