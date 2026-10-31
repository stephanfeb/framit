# 04 · Editor runtime

The runtime is the JavaScript shipped inside every preview page. It turns rendered HTML into
a Figma-like editing surface while keeping the DOM, not a scene graph, as the thing being
edited. See ADR-001 for why.

## Modes

| Mode | What happens | Shortcut |
|------|--------------|----------|
| **Design** | Click selects, double-click edits text, drag moves frames, handles resize. Form controls are inert. | `V` |
| **Preview** | Frames behave like the real app: inputs accept typing, selects open, tabs switch, hotspots navigate between screens. Nothing is selectable. | `P` |
| **Comment** | Click places a pin with a note; stored in the document under `comments`. | `C` |

Default is Design. Mode is per tab, remembered in `localStorage`.

## Canvas shell

The shell is an untransformed viewport containing:

1. `#canvas` – a transformed container (`translate` + `scale`) holding the frames.
2. `#overlay` – an untransformed layer for selection boxes, handles, guides, the floating
   toolbar, and diagram edge handles. Positions are computed from `getBoundingClientRect()`
   of the selected elements, so overlays stay crisp at any zoom.
3. `#panel` – a right-hand inspector: node type, props form generated from the component
   schema, notes, and the frame/device picker.
4. `#bar` – top bar: project and screen name, mode switch, zoom, export, open-in-MCP hint.

Pan: space+drag or trackpad. Zoom: pinch or ⌘+scroll, around the cursor. Fit: `⇧1`.

## Selection

- Single click selects the nearest ancestor with `data-node`.
- Click again on a selected container drills into the child under the cursor (Figma deep
  select). `Esc` goes up one level.
- Shift-click adds to selection. Marquee drag on empty canvas selects frames.
- Selection renders as an outline on the element plus eight handles on the overlay. Handles
  appear only when the node is resizable (frames always; flow children only along the axis
  their container allows, which maps to a `style.width` or `style.minHeight` patch).
- Hovering shows a faint outline and a type label, so the structure is discoverable.

## Editing operations and the patches they emit

| Interaction | Patch |
|-------------|-------|
| Double-click text, type, blur or `Esc` | `replace /props/content` (or `/props/label`) |
| Floating toolbar: role, bold, italic, align, link | `replace /props/role`, `/props/emphasis`, `/props/align`, `/props/to` |
| Drag a frame | `replace /frames/<i>/position` (by frame ID) |
| Resize a frame | `replace /frames/<i>/device` with `{width,height}` |
| Resize a flow child | `replace /style/width` or `/style/minHeight` |
| Drag a node within its container | `move` (reorders among siblings) |
| Drag a node into another container | `move` with new parent path |
| Inspector prop change | `replace /props/<key>` |
| Variant switch in toolbar | `replace /props/variant` |
| Delete | `remove` |
| Duplicate (`⌘D`) | `add` after self with fresh IDs |
| Insert from palette (`/` or `⌘K`) | `add` with component defaults |
| Drag a diagram node | `replace /nodes/<id>/position` (pins it) |
| Draw an edge between diagram nodes | `add /edges/-` |
| Comment pin | `add /comments/-` |

Text editing uses `contenteditable` scoped to the one text node, plain text only. Rich inline
marks are limited to what `text` supports (`emphasis`, `link`); paste is sanitised to plain
text. This keeps the document model honest and avoids HTML drift.

## Round trip

```
DOM event ──► runtime builds JSON Patch (node-ID addressed)
          ──► optimistic: DOM already reflects it
          ──► PATCH /api/doc/<kind>/<id>   { baseRevision, ops }
          ◄── 200 { revision }             ──► store revision
          ◄── 409 { current }              ──► reload document, re-render frame, toast
```

On a `changed` WebSocket event from another writer (a model tool call), the runtime re-fetches
the document and re-renders only the affected frames, preserving selection by node ID where
the node still exists.

Undo and redo are local to the tab: a stack of inverse patches, applied through the same
PATCH route. `⌘Z` / `⇧⌘Z`.

## Rendering inside the browser

The runtime does not contain a second renderer. When a frame must re-render after a remote
change or a structural patch, it asks the server: `GET /api/render/<kind>/<id>?frame=<fid>`
returns the HTML for that frame, and the runtime swaps it in. Small prop patches that the
runtime can apply to the DOM directly (text content, a class for `variant`) are applied
without a round trip. The list of "DOM-applicable" patches is intentionally short; when in
doubt, re-render the frame.

This keeps one renderer, on the server, and the runtime small.

## Floating toolbar

Appears above the selection. Contents depend on node type:

- `text`: role dropdown, B, I, U, link, list, align, comment, more.
- `button`: variant, size, icon, full width.
- `table`: dense, add column, add row.
- Containers: gap, padding, align, direction.
- Frames: device picker, background, name.

Built from the component schema plus a small per-type layout hint, so adding a component to
the catalogue gives it a toolbar for free.

## Inspector panel

A form generated from the node's Zod schema (via JSON Schema). Enums become selects, booleans
toggles, numbers steppers, token-typed fields show the token palette. The `notes` field is
always present. Read-only JSON of the node is available under a disclosure for debugging.

## Preview mode specifics

- Form controls are real; typed values are ephemeral and never patched.
- Hotspots (`to` props) navigate: the runtime swaps in the target screen's frame of the same
  device, with a 150ms crossfade, and pushes history so browser back works.
- A "Present" variant (`⌘⇧P`) hides the shell and shows one frame full-bleed for demos.

## Performance budget

- Runtime bundle under 60 KB gzipped, no framework.
- A screen with 5 frames and 500 nodes must select, drag, and zoom at 60fps on a laptop.
- Re-render of a single frame under 50ms server-side.

## Accessibility of the editor itself

Keyboard reachable: Tab cycles selection within a frame, arrows nudge (frames only), Enter
edits text, `Esc` exits. The toolbar and inspector are standard controls. Rendered wireframes
use semantic elements so screen readers can read a preview as a page.
