# 07 · Roadmap

Milestones are sized so each one ends with something a person can open in a browser.
Issues are tracked in beads (`bd ready` to see what is unblocked).

## M0 · Skeleton ✅

- Repo layout, TypeScript, tsup/esbuild builds, Vitest.
- MCP server that answers `get_project`, `init_project`, `describe_dsl` with a stub schema.
- `.framit/` store with atomic writes and revision counter.
- CI-free; local `npm test` and `npm run dev` only.

**Done when:** Claude Code can register the server and call `init_project`.

## M1 · One beautiful screen ✅

- Zod schemas for `theme` and `screen`.
- Theme compiler → CSS custom properties + component stylesheet.
- Three starter themes: `wire-lo`, `wire-mid-light`, `wire-mid-dark`.
- Renderer with ~15 components: app-shell, stack, row, grid, card, section, text, button,
  input, select, table, list, nav, badge, avatar, divider.
- Preview server (Hono) serving a static page per screen, no editing.
- Playwright screenshot pipeline; `write_screen` returns PNGs.
- `describe_dsl`, `list_components`, `get_theme` good enough to drive blind.

**Done when:** from a fresh session, "wireframe a settings page for a SaaS app, desktop and
phone" produces something you would paste into a doc, without the model seeing this repo.

*Shipped with 30 components* (pulled forward from M5: tabs, textarea, checkbox, toggle, radio-group,
image, icon, link, stat, progress, breadcrumb, pagination, tabbar, topbar, sidebar, spacer).
Result: [docs/examples](examples/README.md).

## M2 · Editable canvas ✅

- Canvas shell: pan, zoom, fit, frame drag and resize.
- Selection with deep-select, hover labels, handles.
- Inline text editing, floating toolbar for text and buttons.
- Node-ID JSON Patch pipeline, `PATCH /api/doc`, revision checks, SSE change events.
- Partial frame re-render from server.
- Undo/redo.
- Inspector panel generated from schema.

**Done when:** you edit three labels and move a frame in the browser, then `read_screen` in
a new session shows exactly that.

*Shipped with* reorder and reparent by drag, a component palette (`/` or ⌘K), duplicate and
delete, keyboard nudging. Runtime is ~13 KB gzipped. The acceptance criterion is an automated
test (`test/editor.test.ts`, "M2 acceptance").

## M3 · Preview mode and flows ✅

- Preview mode with live form controls and hotspot navigation.
- `flow` documents and the flow canvas with edges between screens.
- Present mode.
- `export` to PNG, PDF, and self-contained HTML.

**Done when:** a three-screen onboarding flow can be clicked through and exported as one HTML
file that works offline.

*Shipped:* the acceptance criterion is an automated test (`test/prototype.test.ts`, "M3
acceptance"). It opens the exported file from `file://` with every network request blocked and
clicks through all three screens. The ~170 KB file includes both fonts. ADR-010 covers the player
design.

## M4 · Diagrams ✅

- `diagram` schema, elkjs layout, node kinds with icons, groups and lanes.
- SVG edge overlay with orthogonal routing and labels.
- Drag to pin, draw edges between nodes on the canvas.
- Same theme, so diagrams and screens look like one document set.

**Done when:** "draw the system context for this repo" yields a diagram you would put in an
architecture doc, and you can tidy it by hand.

*Shipped:* elkjs 0.12.0 (pinned). The hand-tidying half of the criterion is an automated test
(`test/diagram-editor.test.ts`, "M4 acceptance"). It drags a node to pin it, renames a node and
relabels an arrow, and a new MCP session then reads exactly that. The blind-session half is in
[docs/examples](examples/README.md). Layout design: ADR-011.

## M5 · Catalogue and polish ✅

- Component catalogue to ~40: tabs, modal, drawer, toast, alert, stat, chart sketches,
  empty-state, pagination, breadcrumb, toggle, radio, textarea, image, icon, kbd, code. ✅ 41
  components; overlays are frame-level (see docs/03).
- `lint` tool and overflow detection in the screenshot pass. ✅ Static rules (raw colours, unlabelled
  fields, empty containers, missing screens, dead ends in flows) plus browser probes for overflow and
  cut-off text, with no image tokens. Screenshots for the model are now 1x, at most four per result,
  and `patch_screen` shows only the frames it changed.
- Comment mode. ✅ Pins on nodes (by id), side list with replies, resolve and delete, open-count badge,
  undo; the model sees open comments in `get_project` and resolves them with `patch_screen`.
- Lo-fi sketch rendering (hand-drawn strokes via SVG filters) as a theme fidelity. ✅ CSS rather than
  SVG filters. Displacement filters tore 1.5px strokes into dashes, so outlines are redrawn as two pen
  passes with irregular elliptical corners, and text stays crisp. Lo-fi frames use the mono font. Applies
  to any theme with `fidelity: "lo"`, and to diagrams.
- `new-theme` and `wireframe` MCP prompts. ✅ Plus `address-comments`.
- Packaging: `npx framit serve`, Playwright install guidance, first-run message. ✅ `framit doctor`
  and `framit install-browser`; the browser falls back to an installed Chrome or Edge; `init_project`
  tells the user the preview URL and screenshot status. The tarball (`npm pack`, about 120 KB) is
  smoke-tested by installing it into an empty folder. Not yet published to npm.

## Later / maybe

- tldraw shell (ADR-006 trigger).
- Light/dark theme pairs via `extends` with a single toggle in the canvas.
- Design tokens import (W3C DTCG JSON) so a real product's tokens seed a theme.
- Sequence diagrams.
- Figma export via the REST plugin API. Only if asked repeatedly.
