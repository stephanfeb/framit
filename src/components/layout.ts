import { z } from "zod";
import { Length, Space, lengthCss, spaceCss } from "../schema/tokens.js";
import { cls, css, esc } from "../renderer/html.js";
import { defineComponent, type AnyNode } from "./types.js";

const Align = z.enum(["start", "center", "end", "stretch"]);
const Justify = z.enum(["start", "center", "end", "between", "around"]);
const flexAlign = (a: string) => (a === "start" || a === "end" ? `flex-${a}` : a);
const flexJustify = (j: string) =>
  j === "between" ? "space-between" : j === "around" ? "space-around" : j === "start" || j === "end" ? `flex-${j}` : j;

export const stack = defineComponent({
  type: "stack",
  category: "layout",
  summary: "Vertical flow of children. The default building block.",
  container: true,
  props: z
    .object({
      gap: Space.default("md"),
      align: Align.default("stretch").describe("Cross-axis alignment of children."),
      justify: Justify.default("start"),
      padding: Space.optional(),
      fill: z.boolean().default(false).describe("Grow to fill the parent's remaining space."),
    })
    .strict(),
  example: {
    props: { gap: "sm" },
    children: [
      { type: "text", props: { role: "h3", content: "Stack" } },
      { type: "text", props: { content: "Children flow top to bottom.", muted: true } },
    ],
  },
  render: (n, ctx) =>
    `<div ${ctx.attrs(n, "fx-stack", {
      gap: spaceCss(n.props.gap),
      "align-items": flexAlign(n.props.align),
      "justify-content": flexJustify(n.props.justify),
      padding: spaceCss(n.props.padding),
      flex: n.props.fill ? "1 1 0%" : undefined,
    })}>${ctx.renderAll(n.children)}</div>`,
});

export const row = defineComponent({
  type: "row",
  category: "layout",
  summary: "Horizontal flow of children. Use spacer or justify=between to push items apart.",
  container: true,
  props: z
    .object({
      gap: Space.default("sm"),
      align: Align.default("center"),
      justify: Justify.default("start"),
      wrap: z.boolean().default(false),
      padding: Space.optional(),
      fill: z.boolean().default(false),
      stackOnPhone: z.boolean().default(false).describe("Become a vertical stack on phone-width frames."),
    })
    .strict(),
  example: {
    props: { gap: "sm" },
    children: [
      { type: "button", props: { label: "Primary", variant: "primary" } },
      { type: "button", props: { label: "Secondary" } },
    ],
  },
  render: (n, ctx) => {
    const vertical = n.props.stackOnPhone && ctx.compact;
    return `<div ${ctx.attrs(n, cls("fx-row", vertical && "fx-row--stacked"), {
      gap: spaceCss(n.props.gap),
      "align-items": vertical ? "stretch" : flexAlign(n.props.align),
      "justify-content": vertical ? undefined : flexJustify(n.props.justify),
      "flex-wrap": n.props.wrap ? "wrap" : undefined,
      padding: spaceCss(n.props.padding),
      flex: n.props.fill ? "1 1 0%" : undefined,
    })}>${ctx.renderAll(n.children)}</div>`;
  },
});

export const grid = defineComponent({
  type: "grid",
  category: "layout",
  summary: "CSS grid. Equal columns by default; minColumnWidth makes it responsive.",
  container: true,
  props: z
    .object({
      columns: z
        .union([z.number().int().min(1).max(12), z.string()])
        .default(2)
        .describe('Number of equal columns, or a template like "2fr 1fr".'),
      minColumnWidth: z.number().positive().optional().describe("Auto-fill columns at least this wide (px)."),
      compactColumns: z.number().int().min(1).max(4).default(1).describe("Columns on phone-width frames."),
      gap: Space.default("md"),
      padding: Space.optional(),
    })
    .strict(),
  example: {
    props: { columns: 3, gap: "sm" },
    children: [1, 2, 3].map((i) => ({ type: "card", props: { padding: "md" }, children: [{ type: "text", props: { content: `Cell ${i}` } }] })),
  },
  render: (n, ctx) => {
    const { columns, minColumnWidth, compactColumns } = n.props;
    const template = minColumnWidth
      ? `repeat(auto-fill,minmax(${minColumnWidth}px,1fr))`
      : ctx.compact && (typeof columns === "number" ? columns > compactColumns : true)
        ? `repeat(${compactColumns},minmax(0,1fr))`
        : typeof columns === "number"
          ? `repeat(${columns},minmax(0,1fr))`
          : columns;
    return `<div ${ctx.attrs(n, "fx-grid", {
      "grid-template-columns": template,
      gap: spaceCss(n.props.gap),
      padding: spaceCss(n.props.padding),
    })}>${ctx.renderAll(n.children)}</div>`;
  },
});

export const split = defineComponent({
  type: "split",
  category: "layout",
  summary: "Two panes: the first child is fixed-width, the second fills. Stacks below collapseBelow.",
  container: true,
  props: z
    .object({
      side: z.enum(["left", "right"]).default("left").describe("Which side the fixed pane sits on."),
      size: z.number().positive().default(320).describe("Fixed pane width in px."),
      gap: Space.default("lg"),
      collapseBelow: z.number().default(768).describe("Frame width (px) below which the panes stack."),
      divider: z.boolean().default(false),
    })
    .strict(),
  example: {
    props: { size: 160, gap: "md" },
    children: [
      { type: "card", props: { padding: "md" }, children: [{ type: "text", props: { content: "Fixed" } }] },
      { type: "card", props: { padding: "md" }, children: [{ type: "text", props: { content: "Fluid" } }] },
    ],
  },
  render: (n, ctx) => {
    const [fixed, fluid, ...rest] = n.children;
    if (rest.length) ctx.warn(n.id, "split uses only its first two children; wrap extras in a stack.");
    const collapsed = ctx.frameWidth < n.props.collapseBelow;
    const pane = (c: AnyNode | undefined, kind: "fixed" | "fluid") =>
      c
        ? `<div class="fx-split-${kind}" style="${css(kind === "fixed" && !collapsed ? { width: `${n.props.size}px`, flex: "none" } : { flex: "1 1 0%", "min-width": "0" })}">${ctx.render(c)}</div>`
        : "";
    const panes = [pane(fixed, "fixed"), pane(fluid, "fluid")];
    if (n.props.side === "right" && !collapsed) panes.reverse();
    return `<div ${ctx.attrs(n, cls("fx-split", collapsed && "fx-split--collapsed", n.props.divider && "fx-split--divider"), {
      gap: spaceCss(n.props.gap),
    })}>${panes.join("")}</div>`;
  },
});

export const appShell = defineComponent({
  type: "app-shell",
  category: "layout",
  summary:
    "Application chrome. Children of type sidebar, topbar and tabbar are placed in their slots; everything else flows in the main content area.",
  container: true,
  props: z
    .object({
      padding: Space.optional().describe('Content padding. Defaults to "xl" on wide frames, "md" on phones.'),
      gap: Space.default("lg"),
      maxWidth: Length.optional().describe("Centre the content column at this width."),
    })
    .strict(),
  example: {
    width: 520,
    children: [
      { type: "sidebar", props: { brand: "Acme", width: 150 }, children: [{ type: "nav", props: { items: [{ label: "Home", icon: "house", active: true }, { label: "Settings", icon: "settings" }] } }] },
      { type: "text", props: { role: "h2", content: "Page" } },
      { type: "text", props: { content: "Main content", muted: true } },
    ],
  },
  render: (n, ctx) => {
    const pick = (t: string) => n.children.filter((c) => c.type === t);
    const content = n.children.filter((c) => !["sidebar", "topbar", "tabbar"].includes(c.type));
    const padding = spaceCss(n.props.padding ?? (ctx.compact ? "md" : "xl"));
    const inner = `<div class="fx-app-content-inner" style="${css({ gap: spaceCss(n.props.gap), "max-width": lengthCss(n.props.maxWidth) })}">${ctx.renderAll(content)}</div>`;
    return `<div ${ctx.attrs(n, "fx-app-shell")}>${ctx.renderAll(pick("sidebar"))}<div class="fx-app-main">${ctx.renderAll(pick("topbar"))}<main class="fx-app-content" style="padding:${padding}">${inner}</main>${ctx.renderAll(pick("tabbar"))}</div></div>`;
  },
});

export const sidebar = defineComponent({
  type: "sidebar",
  category: "layout",
  summary: "Left app sidebar with optional brand. Put a nav inside. Hidden on phones unless showOnPhone.",
  container: true,
  props: z
    .object({
      brand: z.string().optional(),
      brandIcon: z.string().optional().describe("Lucide icon name shown before the brand."),
      width: z.number().positive().default(248),
      gap: Space.default("lg"),
      footer: z.string().optional().describe("Small text pinned to the bottom, e.g. the signed-in user."),
      showOnPhone: z.boolean().default(false),
    })
    .strict(),
  example: { props: { brand: "Acme", width: 200 }, children: [{ type: "nav", props: { items: [{ label: "Home", icon: "house", active: true }, { label: "Reports", icon: "chart-column" }] } }] },
  render: (n, ctx) => {
    if (ctx.compact && !n.props.showOnPhone) return `<!-- sidebar ${esc(n.id)} hidden on phone -->`;
    const brand = n.props.brand
      ? `<div class="fx-sidebar-brand">${n.props.brandIcon ? ctx.icon(n.props.brandIcon, 22) : ""}${ctx.edit("/brand", n.props.brand)}</div>`
      : "";
    const footer = n.props.footer ? `<div class="fx-sidebar-footer">${ctx.edit("/footer", n.props.footer)}</div>` : "";
    return `<aside ${ctx.attrs(n, "fx-sidebar", { width: `${n.props.width}px`, gap: spaceCss(n.props.gap) })}>${brand}${ctx.renderAll(n.children)}${footer}</aside>`;
  },
});

export const topbar = defineComponent({
  type: "topbar",
  category: "layout",
  summary: "Top app bar: optional leading icon, title, search, and children as right-aligned actions. Works for desktop headers and mobile app bars.",
  container: true,
  props: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      leading: z.string().optional().describe('Lucide icon, e.g. "menu" or "arrow-left".'),
      search: z.string().optional().describe("Placeholder text for a search field in the bar."),
      border: z.boolean().default(true),
      center: z.boolean().default(false).describe("Centre the title (mobile style)."),
    })
    .strict(),
  example: { props: { title: "Inbox", leading: "menu" }, children: [{ type: "avatar", props: { name: "Ada Lovelace", size: "sm" } }] },
  render: (n, ctx) => {
    const p = n.props;
    const lead = p.leading ? `<span class="fx-topbar-leading">${ctx.icon(p.leading, 22)}</span>` : "";
    const title = p.title
      ? `<div class="fx-topbar-title">${ctx.edit("/title", p.title)}${p.subtitle ? `<span class="fx-topbar-subtitle">${ctx.edit("/subtitle", p.subtitle)}</span>` : ""}</div>`
      : "";
    const search = p.search
      ? `<div class="fx-topbar-search fx-control">${ctx.icon("search", 16, "fx-muted-icon")}<span class="fx-placeholder">${ctx.edit("/search", p.search)}</span></div>`
      : "";
    return `<header ${ctx.attrs(n, cls("fx-topbar", p.border && "fx-topbar--border", p.center && "fx-topbar--center"))}>${lead}${title}${search}<div class="fx-topbar-actions">${ctx.renderAll(n.children)}</div></header>`;
  },
});

const TabbarItem = z
  .object({ label: z.string(), icon: z.string(), active: z.boolean().optional(), badge: z.union([z.string(), z.number()]).optional(), to: z.string().optional() })
  .strict();

export const tabbar = defineComponent({
  type: "tabbar",
  category: "navigation",
  summary: "Mobile bottom tab bar. Place inside app-shell; it docks at the bottom.",
  container: false,
  props: z.object({ items: z.array(TabbarItem).min(2).max(6) }).strict(),
  example: {
    width: 360,
    props: { items: [{ label: "Home", icon: "house", active: true }, { label: "Search", icon: "search" }, { label: "Profile", icon: "user" }] },
  },
  render: (n, ctx) =>
    `<nav ${ctx.attrs(n, "fx-tabbar")}>${n.props.items
      .map(
        (it, i) =>
          `<a class="${cls("fx-tabbar-item", it.active && "is-active")}"${it.to ? ` data-to="${esc(it.to)}"` : ""}>${ctx.icon(it.icon, 22)}${ctx.edit(`/items/${i}/label`, it.label)}${it.badge !== undefined ? `<span class="fx-tabbar-badge">${ctx.text(it.badge)}</span>` : ""}</a>`,
      )
      .join("")}</nav>`,
});

export const card = defineComponent({
  type: "card",
  category: "layout",
  summary: "Surface with padding and radius. Optional title, subtitle and a header action link.",
  container: true,
  props: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      action: z.string().optional().describe('Header link on the right, e.g. "View all".'),
      padding: Space.optional().describe("Defaults to the theme's card padding."),
      gap: Space.default("md"),
      variant: z.enum(["outlined", "elevated", "filled", "plain"]).optional().describe("Defaults from the theme."),
    })
    .strict(),
  example: { width: 280, props: { title: "Card title", subtitle: "Supporting text", action: "View all" }, children: [{ type: "text", props: { content: "Card body content." } }] },
  variants: [{ title: "Elevated", variant: "elevated" }, { title: "Filled", variant: "filled" }],
  render: (n, ctx) => {
    const p = n.props;
    const s = ctx.theme.components.card ?? {};
    const variant = p.variant ?? (s.shadow && s.shadow !== "none" ? "elevated" : s.border === false ? "filled" : "outlined");
    const head =
      p.title || p.action
        ? `<div class="fx-card-head"><div class="fx-card-titles">${p.title ? `<h3 class="fx-card-title">${ctx.edit("/title", p.title)}</h3>` : ""}${p.subtitle ? `<p class="fx-card-subtitle">${ctx.edit("/subtitle", p.subtitle)}</p>` : ""}</div>${p.action ? `<a class="fx-link">${ctx.edit("/action", p.action)}</a>` : ""}</div>`
        : "";
    return `<div ${ctx.attrs(n, cls("fx-card", `fx-card--${variant}`), {
      padding: p.padding !== undefined ? spaceCss(p.padding) : undefined,
      gap: spaceCss(p.gap),
    })}>${head}${ctx.renderAll(n.children)}</div>`;
  },
});

const SectionAction = z.object({ label: z.string(), variant: z.enum(["primary", "secondary", "ghost", "danger", "link"]).optional(), icon: z.string().optional() }).strict();

export const section = defineComponent({
  type: "section",
  category: "layout",
  summary:
    'Headed region with optional description and header actions. layout="aside" puts the heading in a left column (classic settings page) and stacks on phones.',
  container: true,
  props: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      actions: z.array(SectionAction).optional(),
      layout: z.enum(["stacked", "aside"]).default("stacked"),
      gap: Space.default("md"),
      divider: z.boolean().default(false).describe("Rule above the section."),
    })
    .strict(),
  example: {
    width: 520,
    props: { title: "Profile", description: "How others see you.", layout: "aside" },
    children: [{ type: "input", props: { label: "Display name", value: "Ada" } }],
  },
  render: (n, ctx) => {
    const p = n.props;
    const aside = p.layout === "aside" && !ctx.compact;
    const actions = p.actions?.length
      ? `<div class="fx-section-actions">${p.actions
          .map((a) => ctx.render({ id: undefined, type: "button", props: { label: a.label, variant: a.variant ?? "secondary", icon: a.icon, size: "sm" } }))
          .join("")}</div>`
      : "";
    const head =
      p.title || p.description || actions
        ? `<div class="fx-section-head"><div class="fx-section-titles">${p.title ? `<h2 class="fx-section-title">${ctx.edit("/title", p.title)}</h2>` : ""}${p.description ? `<p class="fx-section-desc">${ctx.edit("/description", p.description)}</p>` : ""}</div>${aside ? "" : actions}</div>`
        : "";
    const body = `<div class="fx-section-body" style="gap:${spaceCss(p.gap)}">${ctx.renderAll(n.children)}${aside ? actions : ""}</div>`;
    return `<section ${ctx.attrs(n, cls("fx-section", aside && "fx-section--aside", p.divider && "fx-section--divider"))}>${head}${body}</section>`;
  },
});

const TabItem = z.union([z.string(), z.object({ label: z.string(), count: z.union([z.string(), z.number()]).optional() }).strict()]);

export const tabs = defineComponent({
  type: "tabs",
  category: "navigation",
  summary: "Tab strip. Children are the content of the active tab only.",
  container: true,
  props: z
    .object({
      items: z.array(TabItem).min(1),
      active: z.number().int().nonnegative().default(0),
      variant: z.enum(["underline", "pill"]).default("underline"),
      gap: Space.default("lg"),
    })
    .strict(),
  example: { width: 360, props: { items: ["Overview", { label: "Activity", count: 3 }, "Settings"] } },
  variants: [{ items: ["Overview", { label: "Activity", count: 3 }, "Settings"], variant: "pill" }],
  render: (n, ctx) => {
    const strip = n.props.items
      .map((it, i) => {
        const t = typeof it === "string" ? { label: it } : it;
        return `<button type="button" class="${cls("fx-tab", i === n.props.active && "is-active")}">${ctx.edit(typeof it === "string" ? `/items/${i}` : `/items/${i}/label`, t.label)}${"count" in t && t.count !== undefined ? `<span class="fx-tab-count">${ctx.text(t.count)}</span>` : ""}</button>`;
      })
      .join("");
    const body = n.children.length ? `<div class="fx-tabs-panel" style="gap:${spaceCss(n.props.gap)}">${ctx.renderAll(n.children)}</div>` : "";
    return `<div ${ctx.attrs(n, cls("fx-tabs", `fx-tabs--${n.props.variant}`), { gap: spaceCss(n.props.gap) })}><div class="fx-tab-strip" role="tablist">${strip}</div>${body}</div>`;
  },
});

export const spacer = defineComponent({
  type: "spacer",
  category: "layout",
  summary: "Empty space. Without size it grows to push siblings apart in a row or stack.",
  container: false,
  props: z.object({ size: Space.optional() }).strict(),
  example: { props: { size: "lg" } },
  render: (n, ctx) => {
    const size = spaceCss(n.props.size);
    return `<div ${ctx.attrs(n, "fx-spacer", size ? { width: size, height: size, flex: "none" } : { flex: "1 1 0%" })}></div>`;
  },
});
