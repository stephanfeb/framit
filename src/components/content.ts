import { z } from "zod";
import { TYPE_ROLES } from "../schema/theme.js";
import { Space, Tone, radiusCss, spaceCss } from "../schema/tokens.js";
import { cls, esc, initials } from "../renderer/html.js";
import { defineComponent } from "./types.js";

const HEADING_TAG: Partial<Record<(typeof TYPE_ROLES)[number], string>> = { display: "h1", h1: "h1", h2: "h2", h3: "h3", code: "code" };

export const text = defineComponent({
  type: "text",
  category: "content",
  summary: "Text with a semantic role from the theme's type scale. [Bracketed] slots render as placeholders.",
  container: false,
  props: z
    .object({
      content: z.string(),
      role: z.enum(TYPE_ROLES).default("body"),
      muted: z.boolean().default(false),
      tone: Tone.optional(),
      align: z.enum(["left", "center", "right"]).optional(),
      weight: z.enum(["regular", "medium", "semibold", "bold"]).optional(),
      italic: z.boolean().default(false),
      underline: z.boolean().default(false),
      maxLines: z.number().int().positive().optional().describe("Clamp with an ellipsis after this many lines."),
    })
    .strict(),
  example: { props: { role: "h2", content: "Heading" } },
  variants: TYPE_ROLES.map((role) => ({ role, content: role === "overline" ? "Overline" : `${role[0]!.toUpperCase()}${role.slice(1)} text` })),
  render: (n, ctx) => {
    const p = n.props;
    const tag = HEADING_TAG[p.role] ?? "p";
    const weights = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;
    return `<${tag} ${ctx.attrs(n, cls("fx-text", `fx-t-${p.role}`, p.muted && "fx-muted", p.tone && `fx-tone-${p.tone}`, p.maxLines !== undefined && "fx-clamp"), {
      "text-align": p.align,
      "font-weight": p.weight ? String(weights[p.weight]) : undefined,
      "font-style": p.italic ? "italic" : undefined,
      "text-decoration": p.underline ? "underline" : undefined,
      "-webkit-line-clamp": p.maxLines ? String(p.maxLines) : undefined,
    })}>${ctx.text(p.content)}</${tag}>`;
  },
});

export const icon = defineComponent({
  type: "icon",
  category: "content",
  summary: 'A Lucide icon by kebab-case name, e.g. "house", "settings", "chevron-right".',
  container: false,
  props: z.object({ name: z.string(), size: z.number().positive().default(20), tone: Tone.optional(), muted: z.boolean().default(false) }).strict(),
  example: { props: { name: "sparkles", size: 24, tone: "accent" } },
  render: (n, ctx) =>
    `<span ${ctx.attrs(n, cls("fx-icon-wrap", n.props.tone && `fx-tone-${n.props.tone}`, n.props.muted && "fx-muted"))}>${ctx.icon(n.props.name, n.props.size)}</span>`,
});

export const image = defineComponent({
  type: "image",
  category: "content",
  summary: "Image placeholder at a given aspect ratio, with optional label and caption.",
  container: false,
  props: z
    .object({
      aspect: z.string().regex(/^\d+(\.\d+)?:\d+(\.\d+)?$/).default("16:9").describe('Width:height, e.g. "16:9", "1:1", "4:3".'),
      label: z.string().optional().describe("Text inside the placeholder, e.g. \"Product photo\"."),
      caption: z.string().optional(),
      icon: z.string().default("image"),
      radius: z.enum(["none", "sm", "md", "lg"]).default("md"),
    })
    .strict(),
  example: { width: 240, props: { aspect: "16:9", label: "Hero image" } },
  render: (n, ctx) => {
    const [w, h] = n.props.aspect.split(":");
    const box = `<div class="fx-image-box" style="aspect-ratio:${w}/${h};border-radius:${radiusCss(n.props.radius)}">${ctx.icon(n.props.icon, 28)}${n.props.label ? `<span>${ctx.text(n.props.label)}</span>` : ""}</div>`;
    return `<figure ${ctx.attrs(n, "fx-image")}>${box}${n.props.caption ? `<figcaption>${ctx.text(n.props.caption)}</figcaption>` : ""}</figure>`;
  },
});

const AVATAR_SIZES = { xs: 20, sm: 28, md: 36, lg: 48, xl: 72 } as const;

export const avatar = defineComponent({
  type: "avatar",
  category: "content",
  summary: "Initials avatar. Optional status dot and an inline name/caption beside it.",
  container: false,
  props: z
    .object({
      name: z.string().default("User"),
      size: z.enum(["xs", "sm", "md", "lg", "xl"]).default("md"),
      status: z.enum(["online", "away", "offline"]).optional(),
      shape: z.enum(["circle", "square"]).default("circle"),
      showName: z.boolean().default(false).describe("Render the name beside the avatar."),
      caption: z.string().optional().describe("Secondary line under the name; implies showName."),
    })
    .strict(),
  example: { props: { name: "Ada Lovelace", showName: true, caption: "Admin" } },
  variants: [{ size: "sm", name: "Grace Hopper" }, { size: "lg", name: "Alan Turing", status: "online" }],
  render: (n, ctx) => {
    const p = n.props;
    const px = AVATAR_SIZES[p.size];
    const hue = [...p.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const disc = `<span class="${cls("fx-avatar-disc", p.shape === "square" && "fx-avatar--square")}" style="width:${px}px;height:${px}px;font-size:${Math.round(px * 0.38)}px;--fx-avatar-hue:${hue}">${esc(initials(p.name))}${p.status ? `<i class="fx-avatar-status fx-status-${p.status}"></i>` : ""}</span>`;
    const label =
      p.showName || p.caption
        ? `<span class="fx-avatar-label"><span class="fx-avatar-name">${ctx.text(p.name)}</span>${p.caption ? `<span class="fx-avatar-caption">${ctx.text(p.caption)}</span>` : ""}</span>`
        : "";
    return `<span ${ctx.attrs(n, "fx-avatar")}>${disc}${label}</span>`;
  },
});

export const badge = defineComponent({
  type: "badge",
  category: "content",
  summary: "Small status label. Use tones for state, never the accent for status.",
  container: false,
  props: z
    .object({
      label: z.string(),
      tone: Tone.default("neutral"),
      variant: z.enum(["soft", "solid", "outline"]).default("soft"),
      dot: z.boolean().default(false),
      icon: z.string().optional(),
    })
    .strict(),
  example: { props: { label: "Active", tone: "success", dot: true } },
  variants: (["neutral", "accent", "info", "success", "warning", "danger"] as const).map((tone) => ({ label: tone, tone })),
  render: (n, ctx) =>
    `<span ${ctx.attrs(n, cls("fx-badge", `fx-badge--${n.props.variant}`, `fx-tone-${n.props.tone}`))}>${n.props.dot ? '<i class="fx-dot"></i>' : ""}${n.props.icon ? ctx.icon(n.props.icon, 12) : ""}${ctx.text(n.props.label)}</span>`,
});

export const divider = defineComponent({
  type: "divider",
  category: "content",
  summary: "Horizontal rule, optionally labelled. vertical=true inside rows.",
  container: false,
  props: z.object({ label: z.string().optional(), vertical: z.boolean().default(false), spacing: Space.default("none") }).strict(),
  example: { width: 240, props: { label: "or" } },
  render: (n, ctx) =>
    `<div ${ctx.attrs(n, cls("fx-divider", n.props.vertical && "fx-divider--vertical", n.props.label && "fx-divider--label"), {
      margin: n.props.spacing === "none" ? undefined : n.props.vertical ? `0 ${spaceCss(n.props.spacing)}` : `${spaceCss(n.props.spacing)} 0`,
    })} role="separator">${n.props.label ? `<span>${ctx.text(n.props.label)}</span>` : ""}</div>`,
});

export const link = defineComponent({
  type: "link",
  category: "content",
  summary: "Inline text link. `to` names a screen id for prototype navigation.",
  container: false,
  props: z
    .object({
      label: z.string(),
      to: z.string().optional(),
      icon: z.string().optional(),
      iconRight: z.string().optional(),
      tone: z.enum(["accent", "neutral", "danger"]).default("accent"),
      underline: z.boolean().default(false),
    })
    .strict(),
  example: { props: { label: "Learn more", iconRight: "arrow-right" } },
  render: (n, ctx) =>
    `<a ${ctx.attrs(n, cls("fx-link", `fx-link--${n.props.tone}`, n.props.underline && "fx-link--underline"))}${n.props.to ? ` data-to="${esc(n.props.to)}"` : ""}>${n.props.icon ? ctx.icon(n.props.icon, 16) : ""}<span>${ctx.text(n.props.label)}</span>${n.props.iconRight ? ctx.icon(n.props.iconRight, 16) : ""}</a>`,
});

export const stat = defineComponent({
  type: "stat",
  category: "data",
  summary: "Key metric: label, big value, optional delta with trend.",
  container: false,
  props: z
    .object({
      label: z.string(),
      value: z.union([z.string(), z.number()]),
      delta: z.string().optional().describe('e.g. "+12%".'),
      trend: z.enum(["up", "down", "flat"]).optional(),
      invert: z.boolean().default(false).describe("Down is good (e.g. churn, cost)."),
      caption: z.string().optional(),
      icon: z.string().optional(),
    })
    .strict(),
  example: { width: 200, props: { label: "Revenue", value: "$48.2k", delta: "+12.4%", trend: "up", caption: "vs last month" } },
  render: (n, ctx) => {
    const p = n.props;
    const good = p.trend === "flat" || p.trend === undefined ? undefined : (p.trend === "up") !== p.invert;
    const tone = good === undefined ? "neutral" : good ? "success" : "danger";
    const arrow = p.trend === "up" ? "trending-up" : p.trend === "down" ? "trending-down" : "minus";
    const delta = p.delta ? `<span class="fx-stat-delta fx-tone-${tone}">${p.trend ? ctx.icon(arrow, 14) : ""}${ctx.text(p.delta)}</span>` : "";
    return `<div ${ctx.attrs(n, "fx-stat")}><div class="fx-stat-label">${p.icon ? ctx.icon(p.icon, 16) : ""}${ctx.text(p.label)}</div><div class="fx-stat-value">${ctx.text(p.value)}</div>${delta || p.caption ? `<div class="fx-stat-foot">${delta}${p.caption ? `<span class="fx-muted">${ctx.text(p.caption)}</span>` : ""}</div>` : ""}</div>`;
  },
});

export const progress = defineComponent({
  type: "progress",
  category: "data",
  summary: "Progress bar with optional label and value.",
  container: false,
  props: z
    .object({
      value: z.number().min(0).max(100),
      label: z.string().optional(),
      showValue: z.boolean().default(true),
      tone: Tone.default("accent"),
      caption: z.string().optional(),
    })
    .strict(),
  example: { width: 240, props: { label: "Storage", value: 64, caption: "6.4 GB of 10 GB" } },
  render: (n, ctx) => {
    const p = n.props;
    const head = p.label || p.showValue ? `<div class="fx-progress-head"><span>${ctx.text(p.label ?? "")}</span>${p.showValue ? `<span class="fx-muted">${Math.round(p.value)}%</span>` : ""}</div>` : "";
    return `<div ${ctx.attrs(n, "fx-progress")}>${head}<div class="fx-progress-track"><div class="fx-progress-bar fx-bg-${p.tone}" style="width:${p.value}%"></div></div>${p.caption ? `<div class="fx-caption fx-muted">${ctx.text(p.caption)}</div>` : ""}</div>`;
  },
});
