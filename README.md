# Framit

A local MCP server that turns text descriptions into editable, themed wireframes: desktop and
mobile screens, architecture diagrams, and user flows. Output is a live HTML canvas you can
edit in the browser, and edits round-trip to the source so later sessions stay consistent.

Status: M0 (skeleton) complete. See [docs/](docs/README.md) and `docs/07-roadmap.md`.

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

### Tools available today (M0)

| Tool | Purpose |
|------|---------|
| `get_project` | Project metadata and document counts; says whether `.framit/` exists |
| `init_project` | Creates `.framit/`; idempotent |
| `describe_dsl` | JSON Schema and guide for documents (stub until M1) |
