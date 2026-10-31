import { z } from "zod";
import { cls, esc } from "../renderer/html.js";
import type { RenderCtx } from "./types.js";
import { defineComponent } from "./types.js";

interface NavItemShape {
  label?: string;
  heading?: string;
  icon?: string;
  active?: boolean;
  badge?: string | number;
  to?: string;
  children?: NavItemShape[];
}

const NavItem: z.ZodType<NavItemShape> = z.lazy(() =>
  z
    .object({
      label: z.string().optional(),
      heading: z.string().optional().describe("Makes this entry a group heading instead of a link."),
      icon: z.string().optional(),
      active: z.boolean().optional(),
      badge: z.union([z.string(), z.number()]).optional(),
      to: z.string().optional(),
      children: z.array(NavItem).optional().describe("One level of nested items, shown indented."),
    })
    .strict(),
);

function navItems(items: NavItemShape[], ctx: RenderCtx, depth: number): string {
  return items
    .map((it) => {
      if (it.heading !== undefined) return `<li class="fx-nav-heading">${ctx.text(it.heading)}</li>`;
      const self = `<a class="${cls("fx-nav-item", it.active && "is-active", depth > 0 && "fx-nav-item--nested")}"${it.to ? ` data-to="${esc(it.to)}"` : ""}>${it.icon ? ctx.icon(it.icon, 18) : ""}<span class="fx-nav-label">${ctx.text(it.label ?? "")}</span>${it.badge !== undefined ? `<span class="fx-nav-badge">${ctx.text(it.badge)}</span>` : ""}</a>`;
      const kids = it.children?.length ? `<ul class="fx-nav-sub">${navItems(it.children, ctx, depth + 1)}</ul>` : "";
      return `<li>${self}${kids}</li>`;
    })
    .join("");
}

export const nav = defineComponent({
  type: "nav",
  category: "navigation",
  summary: 'Navigation list. Items have label, icon, active, badge, to, children; {heading:"…"} entries start a group. Vertical in sidebars, horizontal in topbars.',
  container: false,
  props: z.object({ items: z.array(NavItem).min(1), orientation: z.enum(["vertical", "horizontal"]).default("vertical") }).strict(),
  example: {
    width: 220,
    props: {
      items: [
        { label: "Home", icon: "house", active: true },
        { label: "Messages", icon: "message-square", badge: 3 },
        { heading: "Workspace" },
        { label: "Settings", icon: "settings" },
      ],
    },
  },
  render: (n, ctx) => {
    const style = ctx.theme.components.nav?.activeStyle ?? "pill";
    return `<nav ${ctx.attrs(n, cls("fx-nav", `fx-nav--${n.props.orientation}`, `fx-nav--active-${style}`))}><ul>${navItems(n.props.items, ctx, 0)}</ul></nav>`;
  },
});

export const breadcrumb = defineComponent({
  type: "breadcrumb",
  category: "navigation",
  summary: "Breadcrumb trail. The last item is the current page.",
  container: false,
  props: z.object({ items: z.array(z.string()).min(1) }).strict(),
  example: { props: { items: ["Projects", "Apollo", "Settings"] } },
  render: (n, ctx) =>
    `<nav ${ctx.attrs(n, "fx-breadcrumb")}>${n.props.items
      .map((it, i, all) => (i === all.length - 1 ? `<span class="fx-crumb is-current">${ctx.text(it)}</span>` : `<a class="fx-crumb">${ctx.text(it)}</a>${ctx.icon("chevron-right", 14, "fx-muted-icon")}`))
      .join("")}</nav>`,
});

export const pagination = defineComponent({
  type: "pagination",
  category: "navigation",
  summary: "Page controls with an optional summary on the left.",
  container: false,
  props: z.object({ page: z.number().int().min(1).default(1), pages: z.number().int().min(1).default(10), summary: z.string().optional() }).strict(),
  example: { width: 420, props: { page: 2, pages: 12, summary: "Showing 11–20 of [N]" } },
  render: (n, ctx) => {
    const { page, pages } = n.props;
    const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((x) => x >= 1 && x <= pages))].sort((a, b) => a - b);
    const parts: string[] = [];
    nums.forEach((x, i) => {
      if (i > 0 && x - nums[i - 1]! > 1) parts.push(`<span class="fx-page-gap">…</span>`);
      parts.push(`<span class="${cls("fx-page", x === page && "is-active")}">${x}</span>`);
    });
    return `<div ${ctx.attrs(n, "fx-pagination")}>${n.props.summary ? `<span class="fx-muted">${ctx.text(n.props.summary)}</span>` : "<span></span>"}<div class="fx-pages"><span class="fx-page">${ctx.icon("chevron-left", 16)}</span>${parts.join("")}<span class="fx-page">${ctx.icon("chevron-right", 16)}</span></div></div>`;
  },
});
