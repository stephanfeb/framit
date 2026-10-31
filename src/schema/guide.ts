import { z } from "zod";
import { CATEGORIES, COMPONENTS, type ComponentDef } from "../components/index.js";
import { SPACE_TOKENS, COLOR_TOKENS } from "./tokens.js";

type JS = { type?: string | string[]; enum?: unknown[]; const?: unknown; anyOf?: JS[]; oneOf?: JS[]; items?: JS; properties?: Record<string, JS>; required?: string[]; default?: unknown; description?: string; $ref?: string; additionalProperties?: JS | boolean };

/** Compact TypeScript-ish rendering of a JSON Schema type, for humans and models. */
function typeOf(s: JS | undefined, depth = 0): string {
  if (!s) return "any";
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join("|");
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return [...new Set(alts.map((a) => typeOf(a, depth)))].join(" | ");
  if (s.type === "array") return `${wrap(typeOf(s.items, depth))}[]`;
  if (s.type === "object" && s.properties) {
    if (depth > 1) return "{…}";
    const req = new Set(s.required ?? []);
    return `{ ${Object.entries(s.properties)
      .map(([k, v]) => `${k}${req.has(k) ? "" : "?"}: ${typeOf(v, depth + 1)}`)
      .join(", ")} }`;
  }
  if (s.type === "object") return "object";
  if (Array.isArray(s.type)) return s.type.join("|");
  return s.type ?? "any";
}
const wrap = (t: string) => (t.includes("|") || t.includes(" ") ? `(${t})` : t);

const SPACE_SIG = `${SPACE_TOKENS.map((t) => JSON.stringify(t)).join("|")} | number`;
const TONE_SIG = ["neutral", "accent", "info", "success", "warning", "danger"].map((t) => JSON.stringify(t)).join("|");

/** One line per prop: `name?: type = default — description`. */
export function propLines(def: ComponentDef): string[] {
  const js = z.toJSONSchema(def.props, { io: "input", unrepresentable: "any" }) as JS;
  const req = new Set(js.required ?? []);
  return Object.entries(js.properties ?? {}).map(([k, v]) => {
    const dflt = v.default !== undefined ? ` = ${JSON.stringify(v.default)}` : "";
    let type = typeOf(v);
    let desc = v.description ? ` — ${v.description}` : "";
    if (type === SPACE_SIG) {
      type = "Space";
      if (desc.startsWith(" — Spacing token")) desc = "";
    } else if (type === TONE_SIG) type = "Tone";
    return `${k}${req.has(k) ? "" : "?"}: ${type}${dflt}${desc}`;
  });
}

export const TYPE_LEGEND = `Space = ${SPACE_SIG} (theme spacing token or px). Tone = ${TONE_SIG}.`;

export function componentReference(types?: string[]): string {
  const defs = Object.values(COMPONENTS).filter((d) => !types || types.includes(d.type));
  const order: readonly string[] = CATEGORIES;
  defs.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  return defs
    .map((d) => {
      const lines = propLines(d);
      return `### ${d.type}${d.container ? " (container)" : ""}\n${d.summary}\n${lines.length ? lines.map((l) => `- ${l}`).join("\n") : "- (no props)"}`;
    })
    .join("\n\n");
}

const EXAMPLE_DASHBOARD = {
  id: "dashboard",
  name: "Dashboard",
  frames: [
    {
      device: "desktop",
      root: {
        type: "app-shell",
        children: [
          { type: "sidebar", props: { brand: "Acme", brandIcon: "hexagon" }, children: [{ type: "nav", props: { items: [{ label: "Overview", icon: "layout-dashboard", active: true }, { label: "Customers", icon: "users" }, { label: "Settings", icon: "settings" }] } }] },
          { type: "topbar", props: { search: "Search…" }, children: [{ type: "button", props: { label: "New report", icon: "plus", variant: "primary" } }] },
          { type: "text", props: { role: "h1", content: "Overview" } },
          {
            type: "grid",
            props: { columns: 3, compactColumns: 1 },
            children: [
              { type: "card", children: [{ type: "stat", props: { label: "Revenue", value: "$[n]", delta: "+12%", trend: "up" } }] },
              { type: "card", children: [{ type: "stat", props: { label: "Customers", value: "[n]", delta: "+4%", trend: "up" } }] },
              { type: "card", children: [{ type: "stat", props: { label: "Churn", value: "[n]%", delta: "-0.4%", trend: "down", invert: true } }] },
            ],
          },
          {
            type: "card",
            props: { title: "Recent customers", action: "View all" },
            children: [{ type: "table", props: { framed: false, columns: ["Name", "Plan", { label: "MRR", align: "right" }], rows: [[{ text: "Ada Lovelace", avatar: "Ada Lovelace" }, { badge: "Pro", tone: "accent" }, "$[n]"]] } }],
          },
        ],
      },
    },
  ],
};

const EXAMPLE_FORM = {
  type: "card",
  props: { title: "Create account" },
  children: [
    { type: "row", props: { gap: "md", stackOnPhone: true }, children: [{ type: "input", props: { label: "First name" } }, { type: "input", props: { label: "Last name" } }] },
    { type: "input", props: { label: "Email", type: "email", placeholder: "you@company.com" } },
    { type: "checkbox", props: { label: "I agree to the terms" } },
    { type: "button", props: { label: "Create account", variant: "primary", fullWidth: true } },
  ],
};

const EXAMPLE_MOBILE = {
  device: "phone",
  root: {
    type: "app-shell",
    children: [
      { type: "topbar", props: { title: "Inbox", leading: "menu" }, children: [{ type: "button", props: { icon: "pencil", variant: "ghost" } }] },
      { type: "list", props: { items: [{ title: "Ada Lovelace", subtitle: "Can we move the review?", meta: "9:41", leading: { avatar: "Ada Lovelace" } }] } },
      { type: "tabbar", props: { items: [{ label: "Inbox", icon: "inbox", active: true }, { label: "Search", icon: "search" }, { label: "Me", icon: "user" }] } },
    ],
  },
};

export const SCREEN_GUIDE = `# Framit screen DSL

A **screen** is JSON: \`{ id, name, theme?, description?, frames: [...] }\`. Each **frame** is a device
viewport: \`{ name?, device: "desktop"|"laptop"|"tablet"|"phone"|{width,height}, position?: {x,y}, root: Node }\`.
Give one screen several frames for responsive variants (desktop + phone of the same page).

A **node** is \`{ type, props?, children?, style?, notes?, id? }\`. Settings always go in \`props\`.
Only containers take \`children\`.

## Rules that matter
1. **Flow layout only.** Frames are the only things with coordinates. Inside a frame, structure with
   stack (vertical), row (horizontal), grid, split, card, section. Never try to position by x/y.
2. **Use tokens.** Spacing props take ${SPACE_TOKENS.join(", ")} (or px). Colours in \`style\` take
   ${COLOR_TOKENS.join(", ")}. Tones (badges, text, stats) are neutral, accent, info, success, warning, danger.
3. **Let the theme style things.** Don't override colours or sizes per node; if something needs to look
   different everywhere, change the theme (update_theme).
4. **Placeholders.** Write \`[n]\`, \`[Name]\`, \`$[n]\` for data you don't know; they render as muted slots.
5. **Preserve ids.** Nodes get ids on first write. When changing an existing screen, prefer patch_screen;
   if you rewrite it, read_screen first and keep ids so human edits and references survive.
6. **Look at the screenshots** returned by write_screen and fix overflow, crowding, or weak hierarchy
   before reporting back. Warnings name the offending node ids.

## Composition patterns
- App pages: \`app-shell\` with children \`sidebar\` (contains \`nav\`), \`topbar\`, then page content.
  On phone frames the sidebar is hidden automatically; add a \`tabbar\` child for mobile navigation.
- Page header: a \`stack\` with gap "xs" holding breadcrumb, h1 text, muted body text; or a \`row\`
  with justify "between" holding the title stack and primary actions.
- Settings: \`card\` containing \`section\`s with layout "aside" (heading left, fields right), separated by
  \`divider\`, and a final \`row\` justify "end" with Cancel (ghost) and Save (primary).
- Metrics: \`grid\` of \`card\`s each containing a \`stat\`. Use \`compactColumns\` for phones.
- Mobile: \`topbar\` (title, leading "arrow-left" or "menu"), \`list\` with variant "inset" for grouped
  rows, \`text\` role "overline" as group labels, \`tabbar\` at the end.
- Overlays: \`modal\`, \`drawer\` (side "bottom" is a phone sheet) and \`toast\` place themselves over the
  frame; never position them. Put one as the last child of the root, and show the screen without it
  in another frame (e.g. "Projects" and "Projects · delete dialog").
- Charts: \`chart\` inside a \`card\` with a title. Give it a few plausible numbers, or omit series for a
  sketch. Empty lists and first-run pages: \`empty-state\` with one primary action.
- One primary button per region. Secondary actions use "secondary" or "ghost".
- Icons are Lucide names in kebab-case (house, settings, users, bell, search, plus, chevron-right…).

## Example: desktop dashboard
\`\`\`json
${JSON.stringify(EXAMPLE_DASHBOARD)}
\`\`\`

## Example: form card (node)
\`\`\`json
${JSON.stringify(EXAMPLE_FORM)}
\`\`\`

## Example: phone frame
\`\`\`json
${JSON.stringify(EXAMPLE_MOBILE)}
\`\`\`

## Style escape hatch
\`style\` accepts only: width, minWidth, maxWidth, height, minHeight, maxHeight, padding, margin, gap,
flex, alignSelf, background, color, borderRadius, textAlign. Use it sparingly.
`;

export const THEME_GUIDE = `# Framit themes

A theme is the contract that keeps screens consistent across sessions. Fields:
\`{ id, name, fidelity: "lo"|"mid"|"hi", mode: "light"|"dark", tokens, components?, notes, extends? }\`

- **tokens.color**: bg, surface, surface2, border, text, muted, accent, accentText, success, warning, danger, info (6-digit hex).
- **tokens.font**: sans, mono (CSS font stacks). "Inter Variable" and "JetBrains Mono Variable" are bundled.
- **tokens.type**: display, h1, h2, h3, body, label, caption, overline, code → [sizePx, lineHeight, weight, letterSpacingEm].
- **tokens.space**: unit (px) and multipliers xs, sm, md, lg, xl, 2xl.
- **tokens.radius**: sm, md, lg, pill (px). **tokens.stroke.width**. **tokens.shadow**: sm, md, lg (CSS).
- **tokens.device**: desktop, laptop, tablet, phone → [width, height].
- **components**: button {radius, height}, input {radius, height}, card {radius, padding, border, shadow},
  nav {activeStyle: pill|bar|text}, table {header: plain|filled, zebra}.
- **notes**: prose for future sessions describing intent (where the accent is used, density, tone).
  This is what makes later screens consistent; write it carefully.

Easiest path: create_theme with \`from\` set to a starter (wire-mid-light, wire-mid-dark, wire-lo) and
override only what differs, e.g. colours and notes. Use \`extends\` instead when the theme should keep
following its base as the base changes (e.g. a dark twin of a light theme).
`;
