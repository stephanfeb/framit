# 03 · Document model

Framit documents are JSON. The calling model writes them; the renderer compiles them to HTML;
the editor runtime patches them. The model is deliberately small and declarative: it
describes *intent and structure*, never pixel positions inside a frame.

The schema is defined once in Zod and exported as JSON Schema through the `describe_dsl` tool,
so this document describes the shape and the reasoning; the schema is the authority.

## Common

Every node has:

```jsonc
{
  "id": "n_7f3a",        // stable; assigned by server if missing; used for patches
  "type": "button",      // component type
  "props": { ... },      // component-specific
  "children": [ ... ],   // containers only
  "style": { ... },      // small, constrained overrides (see Style escape hatch)
  "notes": "..."         // designer annotation, shown in a side panel, never rendered in-frame
}
```

Every document has:

```jsonc
{
  "kind": "screen" | "diagram" | "flow" | "theme",
  "id": "account-overview",
  "name": "Account overview",
  "revision": 12,
  "updatedAt": "2026-10-31T17:49:00Z",
  "theme": "fintech-dark"       // not on theme docs
}
```

## Screens

A screen is one or more **frames** on a canvas. A frame is a device viewport.

```jsonc
{
  "kind": "screen",
  "id": "account-overview",
  "name": "Account overview",
  "theme": "fintech-dark",
  "frames": [
    {
      "id": "f_desktop",
      "device": "desktop",              // desktop | laptop | tablet | phone | { width, height }
      "position": { "x": 0, "y": 0 },   // canvas coordinates; the ONLY absolute positions
      "root": { "type": "app-shell", "props": {...}, "children": [...] }
    },
    {
      "id": "f_phone",
      "device": "phone",
      "position": { "x": 1600, "y": 0 },
      "root": { ... }
    }
  ]
}
```

Frames are absolutely positioned on the canvas. **Everything inside `root` is flow layout.**
This is the rule that prevents overlapping text; see ADR-002.

### Layout containers

| Type | Purpose | Key props |
|------|---------|-----------|
| `stack` | Vertical flex | `gap`, `align`, `padding` |
| `row` | Horizontal flex | `gap`, `align`, `justify`, `wrap`, `padding` |
| `grid` | CSS grid | `columns` (number or template), `gap`, `minColumnWidth` |
| `split` | Two panes, fixed and fluid | `side: left|right`, `size`, `collapseBelow` |
| `app-shell` | Sidebar + topbar + content | `sidebar`, `topbar`, `content` slots |
| `card` | Surface with padding and radius | `padding`, `elevation`, `title` |
| `section` | Headed region | `title`, `description`, `actions` |
| `scroll` | Scrollable region | `maxHeight`, `direction` |
| `modal` | Overlay dialog on the frame | `title`, `size`, `actions` |
| `drawer` | Slide-in panel | `side`, `title` |
| `tabs` | Tab strip + panels | `tabs: [{label, children}]`, `active` |

Sizing props take theme tokens (`"sm"`, `"md"`, `"lg"`) or explicit CSS lengths. Models are
told to prefer tokens.

### Primitives

| Type | Key props |
|------|-----------|
| `text` | `role: display|h1|h2|h3|body|caption|label|code`, `content`, `muted`, `align` |
| `button` | `label`, `variant: primary|secondary|ghost|danger`, `size`, `icon`, `fullWidth`, `disabled` |
| `input` | `label`, `placeholder`, `value`, `hint`, `error`, `type` |
| `textarea` | as input, plus `rows` |
| `select` | `label`, `options`, `value`, `hint` |
| `checkbox`, `radio`, `toggle` | `label`, `checked`, `hint` |
| `avatar` | `name`, `size`, `src?` |
| `image` | `aspect`, `caption`, `src?` (placeholder when absent) |
| `icon` | `name` (Lucide set), `size` |
| `badge` | `label`, `tone: neutral|info|success|warning|danger` |
| `divider` | `label?` |
| `link` | `label`, `to?` (screen id for flows) |
| `table` | `columns: [{key, label, align, width}]`, `rows: [...]`, `dense`, `rowActions` |
| `list` | `items: [{title, subtitle, meta, leading, trailing}]`, `divided` |
| `nav` | `items: [{label, icon, active, to, children}]`, `groups` |
| `breadcrumb` | `items` |
| `stat` | `label`, `value`, `delta`, `tone` |
| `chart` | `kind: line|bar|area|donut|sparkline`, `series`, `placeholder: true` for a sketch |
| `empty-state` | `title`, `description`, `action` |
| `toast`, `alert` | `title`, `description`, `tone` |
| `pagination` | `page`, `pages` |
| `raw` | `html` escape hatch; rendered sanitised; not structurally editable (ADR-005) |

The catalogue will grow. Adding a component means: a Zod schema, a render function, default
styles keyed to theme tokens, and an entry in `list_components`.

### Placeholders

Wireframes need plausible content without inventing data. Props accept placeholder syntax
that the renderer styles distinctly (muted, bracketed), so `[n] of [N]` reads as a slot and
not a bug. `image` and `chart` without data render as sketches.

### Style escape hatch

`style` accepts a whitelist of CSS properties (`width`, `maxWidth`, `minHeight`, `padding`,
`margin`, `gap`, `background`, `color`, `borderRadius`, `textAlign`) with token values
preferred. It exists so a model can nudge one element without a new component. Anything
beyond the whitelist is rejected by the schema with a message pointing at the right component.

## Themes

A theme is the contract that makes screens consistent across sessions.

```jsonc
{
  "kind": "theme",
  "id": "fintech-dark",
  "name": "Fintech dark",
  "fidelity": "mid",                // lo (sketchy, mono, grey) | mid (clean, neutral) | hi (brand colours)
  "mode": "dark",
  "tokens": {
    "color": {
      "bg": "#0b0d14", "surface": "#141827", "surface2": "#1b2033",
      "border": "#262c42", "text": "#e8eaf2", "muted": "#8b91a7",
      "accent": "#5b7cff", "accentText": "#ffffff",
      "success": "#3dcc8e", "warning": "#f0b35a", "danger": "#ef5a6f", "info": "#5b7cff"
    },
    "font": { "sans": "Inter, system-ui, sans-serif", "mono": "JetBrains Mono, monospace" },
    "type": {                         // role → [size, lineHeight, weight, letterSpacing]
      "display": [40, 1.1, 700, -0.02], "h1": [28, 1.2, 700, -0.01],
      "h2": [20, 1.3, 600, 0], "h3": [16, 1.4, 600, 0],
      "body": [15, 1.55, 400, 0], "caption": [13, 1.4, 400, 0],
      "label": [13, 1.3, 600, 0.01], "code": [13, 1.5, 400, 0]
    },
    "space": { "unit": 4, "xs": 1, "sm": 2, "md": 4, "lg": 6, "xl": 10 },  // multiples of unit
    "radius": { "sm": 6, "md": 10, "lg": 16, "pill": 999 },
    "stroke": { "width": 1, "style": "solid" },
    "shadow": { "sm": "...", "md": "..." },
    "device": { "desktop": [1440, 900], "laptop": [1280, 800], "tablet": [834, 1194], "phone": [390, 844] }
  },
  "components": {                     // per-component variant overrides
    "button": { "radius": "md", "height": 44, "primary": { "bg": "accent" } },
    "card":   { "radius": "lg", "padding": "lg", "border": true },
    "input":  { "height": 44, "radius": "md" },
    "nav":    { "activeStyle": "pill" }
  },
  "notes": "Generous spacing. Headings tight. Accent only on primary actions and links.
            Status text uses success/warning/danger tones, never accent."
}
```

The server compiles a theme to `<theme-id>.css`: custom properties on `:root` plus the
component stylesheet. The `notes` field is prose for the model: `get_theme` returns it
prominently so a fresh session inherits the designer's intent, not just the numbers.

Themes support `extends: "<theme-id>"` for light/dark pairs and variations.

Built-in starter themes: `wire-lo` (sketch), `wire-mid-light`, `wire-mid-dark`.

## Diagrams

Architecture drawings share the theme but have a different model: nodes, edges, groups,
optional lanes. Layout is automatic (elkjs) unless a node has an explicit `position`, in
which case it is pinned and the rest flows around it. Human drags on the canvas pin nodes.

```jsonc
{
  "kind": "diagram",
  "id": "system-context",
  "name": "System context",
  "theme": "fintech-dark",
  "direction": "LR",                      // LR | TB
  "nodes": [
    { "id": "web",  "label": "Web app",   "kind": "service", "tech": "Next.js", "group": "edge" },
    { "id": "api",  "label": "API",       "kind": "service", "tech": "Go",      "group": "core" },
    { "id": "db",   "label": "Ledger DB", "kind": "database","tech": "Postgres","group": "core" },
    { "id": "user", "label": "Customer",  "kind": "actor" },
    { "id": "bank", "label": "Bank rails","kind": "external" }
  ],
  "groups": [
    { "id": "edge", "label": "Edge" },
    { "id": "core", "label": "Core", "lane": true }
  ],
  "edges": [
    { "from": "user", "to": "web",  "label": "HTTPS" },
    { "from": "web",  "to": "api",  "label": "gRPC", "style": "solid" },
    { "from": "api",  "to": "db" },
    { "from": "api",  "to": "bank", "label": "ISO 20022", "style": "dashed", "bidirectional": true }
  ]
}
```

Node kinds: `service`, `database`, `queue`, `cache`, `storage`, `external`, `actor`, `client`,
`function`, `note`. Each has an icon and shape convention from the theme. Nodes render as HTML
(editable like any other node); edges are an SVG overlay with orthogonal or spline routing.

*As built (M4):*
- Node ids are written by the author, because edges refer to them. Edge ids are assigned on save.
- Nodes also take `description`, `icon` (any lucide name) and `emphasis`, which marks the system in focus.
- Edge `style` is `solid`, `dashed` or `dotted`.
- Groups do not nest. A group with `lane: true` is drawn as a full-width band, and lanes are stacked
  top to bottom in order of where layout placed them.
- Node, group and edge ids share one id space, so patches can address any of them with `node`.
- Removing a node also removes its edges.

Sequence and deployment diagrams are out of scope for v1.

## Flows

A flow places existing screens on a canvas and draws edges between hotspots.

```jsonc
{
  "kind": "flow",
  "id": "onboarding",
  "name": "Onboarding",
  "theme": "fintech-dark",
  "steps": [
    { "screen": "welcome",  "frame": "f_phone", "position": { "x": 0,   "y": 0 } },
    { "screen": "verify",   "frame": "f_phone", "position": { "x": 600, "y": 0 } },
    { "screen": "funded",   "frame": "f_phone", "position": { "x": 1200,"y": 0 } }
  ],
  "edges": [
    { "from": { "screen": "welcome", "node": "n_cta" }, "to": "verify", "label": "Tap Continue" },
    { "from": { "screen": "verify",  "node": "n_done" }, "to": "funded" }
  ]
}
```

Any `button`, `link`, `nav` item, `tabbar` item or `list` item with a `to` prop is a hotspot.
In preview mode the runtime navigates between screens; in flow view the edges are drawn.

*As built (M3):* a flow has no `theme` of its own, because each screen keeps its own theme. It has
an optional `device` that picks each step's frame when `frame` is omitted. Steps take an optional
`label`, and `edges` is optional. Edges are derived from hotspots. An explicit edge adds a label, or
makes a node without a `to` prop navigate. Each screen appears at most once per flow.

## Identity and patching

Node IDs are the join key between document, DOM, and patches. Rules:

- The server assigns IDs to nodes that arrive without one (`n_` + 4 base32 chars).
- IDs are stable across rewrites when the model preserves them. Tool descriptions ask the
  model to read-modify-write rather than regenerate.
- Patches are RFC 6902 JSON Patch with paths expressed by node ID, not array index:
  `{ "op": "replace", "node": "n_7f3a", "path": "/props/label", "value": "Send" }`.
  The server resolves `node` to a JSON pointer. This keeps patches valid when siblings are
  reordered by a concurrent edit.
