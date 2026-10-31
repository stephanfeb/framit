# 06 · Architecture decision records

Short records of the choices that shape the system. Add a new entry rather than editing an
old one; mark superseded entries.

---

## ADR-001 · Render and edit in the DOM, not a canvas/WebGL scene graph

**Status:** accepted · 2026-10-31

**Context.** Figma, the reference for "editable wireframes", renders everything itself in
WebGL from a custom scene graph. That buys an infinite canvas with tens of thousands of
objects, rotation, vector booleans, and pixel-identical output. It costs a reimplementation
of layout, text shaping, form controls, clipboard, IME, undo, and accessibility.

**Decision.** Framit renders documents to ordinary HTML and edits that HTML in place. A thin
canvas shell provides pan, zoom, selection, and frame dragging; everything inside a frame is
browser-laid-out DOM. SVG is used only for diagram edges and sketch-style placeholders.

**Reasons.**
- Framit describes UIs. The browser's layout engine is not an approximation of the target;
  it *is* the target. Flexbox wrapping in a wireframe tells the truth about the real app.
- Text wrapping, inputs, selects, scrolling, focus, and hover come free and behave correctly
  in preview mode.
- The LLM authors structure, not coordinates (see ADR-002).
- A theme is literally a stylesheet; consistency is enforced rather than hoped for.
- Export is trivial: the artifact is already HTML.
- This is the choice made by Webflow, Framer, Plasmic, Builder, v0, and Claude's own design
  tool. Penpot moved off the DOM only for performance at scales a local tool never reaches.

**Consequences.**
- No rotation, no vector editing, no boolean ops. If someone needs those, the answer is
  "use Figma". This boundary is deliberate and should be defended.
- Pan/zoom is a CSS transform; overlays live in an untransformed layer positioned from
  measured rects.
- Pixel output may differ slightly across machines (fonts). Acceptable.

---

## ADR-002 · Absolute positions only at the frame level; flow layout inside frames

**Status:** accepted · 2026-10-31

**Context.** A reference screenshot of a leading tool showed a table whose header read
"TSTATE" over "OG" and a cell where "You" collided with "In the wallet". That is the
signature of text placed at x,y by a model that cannot measure text width.

**Decision.** Frames and diagram nodes have `position`. Nothing else does. The schema
rejects `style.position`, `top`, `left`, and absolute coordinates on any node inside a frame.
Layout inside a frame is expressed with `stack`, `row`, `grid`, `split`, and friends.

**Consequences.**
- Overlap is impossible unless a human drags something, and humans drag frames, not text.
- Some Figma-style freedoms (pinning a badge to a card corner) need a component prop
  (`card.cornerSlot`) rather than coordinates. Add the prop; do not open the escape hatch.
- Resizing a flow child on the canvas patches `style.width` or `style.minHeight`, which the
  layout honours without breaking siblings.

---

## ADR-003 · One renderer, on the server; the browser runtime never re-implements it

**Status:** accepted · 2026-10-31

**Decision.** `(document, theme) → HTML` exists once, in TypeScript, in the server. The
preview server, exporter, and screenshot pipeline call it. The browser runtime applies a
short list of trivially DOM-safe patches directly (text content, a variant class) and asks
the server to re-render a frame for anything else.

**Reasons.** Two renderers drift. Keeping the runtime small (no framework, under 60 KB) is
only possible if it does not own rendering. Re-rendering one frame is fast.

**Consequences.** Editing requires the local server to be running. Exported HTML is
preview-only (no editing), which is the right behaviour for a shared file anyway.

---

## ADR-004 · JSON on disk is the single source of truth; patches are node-ID addressed

**Status:** accepted · 2026-10-31

**Decision.** Documents live as JSON files under `.framit/` in the user's project. Human
edits arrive as RFC 6902 patches whose paths are anchored to node IDs rather than array
indices. Models are asked to read-modify-write and may pass `expectedRevision`.

**Reasons.** Files are inspectable, diffable, and versionable with the user's own git.
Node-ID addressing keeps patches valid when a sibling list is reordered by another writer.
Optimistic concurrency with an optional revision check is enough for one user on one machine.

**Consequences.** No database. No lock files. The `revision` counter and atomic rename are
the whole concurrency story. If this ever becomes multi-user, revisit.

---

## ADR-005 · Declarative DSL with a sanitised `raw` escape hatch

**Status:** accepted · 2026-10-31

**Decision.** Models author a constrained, declarative component tree. A `raw` node accepts
an HTML string for one-off needs. `raw` content is sanitised (no scripts, no external
resources), is not structurally editable in the canvas (only replaceable), and triggers a
lint warning.

**Reasons.** The DSL is what makes themes a contract, editing reliable, and output
consistent. An escape hatch prevents the DSL's gaps from blocking a session; making it
slightly inconvenient keeps the pressure on growing the catalogue instead.

---

## ADR-006 · Hand-rolled canvas shell first; tldraw is the fallback

**Status:** accepted · 2026-10-31

**Context.** tldraw provides selection, handles, arrows with binding, zoom, and undo out of
the box, with custom HTML shapes. It brings React, a sizeable bundle, and a licence that
expects a watermark or key for commercial use.

**Decision.** Build a thin shell (pan, zoom, select, move/resize frames, overlay toolbar,
undo) by hand. Needs are narrow and the shell is a few thousand lines. Revisit for the
diagram editor if arrow binding and routing become a time sink.

**Trigger to revisit.** If the shell exceeds roughly 5k lines or diagram edge editing takes
more than a milestone, evaluate tldraw as the shell with Framit frames as custom shapes.

---

## ADR-007 · Screenshots are returned inline from every write

**Status:** accepted · 2026-10-31

**Decision.** `write_*`, `patch_*`, and `render` return PNG screenshots of affected frames in
the tool result. Playwright with Chromium is a hard dependency for this; a write still
succeeds if Chromium is missing, with a warning.

**Reasons.** The calling model is the first reviewer. Seeing the result closes the loop on
truncation, overflow, and poor hierarchy before a human looks. This single mechanism does
more for output quality than any amount of prompt text.

**Consequences.** Install size includes Chromium. Tool results are larger. Both acceptable
for a local developer tool.

---

## ADR-008 · Per-project store, not a global one

**Status:** accepted · 2026-10-31

**Decision.** All state lives in `.framit/` under the directory the MCP client was launched
from. No global store, no home-directory state beyond Playwright's browser cache.

**Reasons.** Consistency is per product. Themes and screens belong with the code they
describe and should travel with its repository. Built-in starter themes ship in the package
and are copied into the project on first use so they can be edited freely.

---

## ADR-009 · Server-Sent Events for change notifications, not WebSocket

**Status:** accepted · 2026-10-31

**Decision.** Change notifications flow server→browser over SSE (`GET /api/events`). Edits flow
browser→server as ordinary `PATCH` requests.

**Reasons.** Traffic is one-way in each direction, so a duplex socket adds nothing. SSE works
with Hono and `fetch` without another dependency, reconnects on its own, and keeps writes on
plain HTTP where origin and content-type checks already apply.

**Consequences.** Shutdown must close open event streams (`closeAllConnections`) or the HTTP
server never finishes closing.

---

## ADR-010 · Present mode and HTML export are the same page, with frames embedded

**Status:** accepted · 2026-10-31

**Decision.** The player page embeds, as `<template>` elements, every frame of every screen
reachable from the start through hotspots and flow edges. It navigates with URL hashes. The server
serves the page for present mode (adding live reload), and `export` writes the same page with
fonts and the runtime inlined.

**Reasons.** One code path means the export behaves exactly like present mode, and it cannot
depend on the server by accident: the acceptance test runs it with the network blocked.
Prototypes are small (tens of frames), so embedding everything costs little, and navigation is
instant.

**Consequences.** Reachability is capped at 60 screens. A screen linked only from outside the
start set is absent, and its hotspot toasts "No screen". The editor's Preview mode fetches frames
from the server instead, because there the documents change while you look at them.

---

## ADR-011 · Diagram layout runs on the server; a small router handles pins

**Status:** accepted · 2026-10-31

**Decision.** The server runs elkjs (layered, orthogonal edge routing, groups as compound
nodes). It estimates node sizes from text, and the renderer draws each node at exactly that size.
Pinned nodes are moved to their `position` after layout, and only the edges touching them are
re-routed, by a dependency-free orthogonal router (`src/shared/route.ts`). The browser uses the
same router to re-route live while a node is dragged. Lanes are stacked into full-width bands
after layout.

**Reasons.** The MCP server must return a screenshot and node positions without a browser
round trip. Fixed node sizes keep layout deterministic and testable. Elk's layered algorithm
cannot hold individual nodes at fixed coordinates, so "elk for everything else, router for pins"
keeps elk's quality where nothing was touched. Sharing the router means the live preview while
dragging matches the saved result.

**Consequences.** Text that is much longer than the estimate is clipped. Labels are meant to be
short, and `write_diagram` warns about long ones. The router does not spread several edges
across one side of a node, and it can cross other nodes in crowded spots. **Auto-layout**
(removing pins) gets elk's routing back. Revisit with libavoid if hand-tidied diagrams get large.
