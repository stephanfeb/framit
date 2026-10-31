# Framit documentation

Framit is a local MCP server that turns text descriptions into editable, themed wireframes:
desktop and mobile screens, architecture diagrams, and user flows. The output is a live
HTML canvas a person can edit in the browser, and every edit round-trips back to the source
document so later sessions build on the same truth.

| Doc | What it covers |
|-----|----------------|
| [01-vision.md](01-vision.md) | The brief, goals, non-goals, and what "good" looks like |
| [02-architecture.md](02-architecture.md) | The three components, data flow, on-disk layout |
| [03-document-model.md](03-document-model.md) | The DSL for screens, themes, diagrams, and flows |
| [04-editor-runtime.md](04-editor-runtime.md) | The browser canvas: modes, editing, round-trip patches |
| [05-mcp-interface.md](05-mcp-interface.md) | Tools and resources the MCP server exposes |
| [06-decisions.md](06-decisions.md) | Architecture decision records |
| [07-roadmap.md](07-roadmap.md) | Milestones |

Issues are tracked with beads (`bd`). See `AGENTS.md` at the repo root.
