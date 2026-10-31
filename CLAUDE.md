# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:1105d646 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

```bash
npm install
npm run build      # dist/cli.js (server) + dist/runtime/{editor,player,diagram}.js (browser runtimes)
npm test           # vitest; test/screenshot.test.ts needs Chromium or Chrome
npm run typecheck
```

## Architecture Overview

Local MCP server that renders wireframes as HTML. Design docs live in `docs/` (start with
`docs/02-architecture.md` and the ADRs in `docs/06-decisions.md`).

- `src/components/` is the single component registry: each component has its Zod props schema,
  example and render function. Schema, renderer, `describe_dsl` and the swatch sheet derive from it.
- `src/schema/` holds screen/theme schemas, tokens and the generated authoring guide.
- `src/renderer/` is pure `(document, theme) -> HTML`; `base-css.ts` reads only `--fx-*` variables
  from the compiled theme.
- `src/store/` is the `.framit/` document store (atomic writes, revisions, node-ID JSON Patch).
- `src/diagram/` lays diagrams out with elkjs; `src/shared/` holds code shared with the browser
  runtimes in `src/runtime/` (patch core, orthogonal router).
- `src/server/` wires the MCP tools, the Hono preview server and the Playwright screenshotter.

## Conventions & Patterns

- Everything inside a frame is flow layout; never add positioning to the style whitelist (ADR-002).
- Adding a component = one `defineComponent` in `src/components/`, with an example. Nothing else.
- Pin new dependencies to versions at least two weeks old.
