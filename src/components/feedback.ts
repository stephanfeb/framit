import { z } from "zod";
import { Tone } from "../schema/tokens.js";
import { cls, esc } from "../renderer/html.js";
import { BUTTON_VARIANTS } from "./form.js";
import { defineComponent, type RenderCtx } from "./types.js";

/*
 * Feedback and overlays. Modal, drawer and toast place themselves on the frame (fixed to the
 * frame's first viewport, base-css `.fx-overlay`); authors never position them (ADR-002). Put
 * them anywhere in the tree, typically as the last child of the frame's root.
 */

const Action = z
  .object({
    label: z.string(),
    variant: z.enum(BUTTON_VARIANTS).default("secondary"),
    icon: z.string().optional(),
    to: z.string().optional().describe("Screen id: a prototype hotspot."),
  })
  .strict();
type ActionT = z.output<typeof Action>;

/** Buttons for an `actions` prop, editable in place (`/actions/<i>/label`) and clickable in prototypes. */
function actionButtons(ctx: RenderCtx, actions: ActionT[], size: "sm" | "md" = "md"): string {
  return actions
    .map(
      (a, i) =>
        `<button type="button" class="${cls("fx-button", `fx-button--${a.variant}`, size === "sm" && "fx-button--sm")}"${a.to ? ` data-to="${esc(a.to)}"` : ""}>${a.icon ? ctx.icon(a.icon, size === "sm" ? 14 : 16) : ""}${ctx.edit(`/actions/${i}/label`, a.label)}</button>`,
    )
    .join("");
}

const TONE_ICON: Record<string, string> = { neutral: "info", accent: "sparkles", info: "info", success: "circle-check", warning: "triangle-alert", danger: "circle-alert" };

export const alert = defineComponent({
  type: "alert",
  category: "feedback",
  summary: "Inline message banner with tone, icon, title, description and optional actions. For page- or form-level status.",
  container: false,
  props: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      tone: Tone.default("info"),
      icon: z.string().optional().describe("Lucide icon; defaults to one matching the tone. \"none\" hides it."),
      actions: z.array(Action).default([]),
      dismissible: z.boolean().default(false),
    })
    .strict(),
  example: { width: 420, props: { tone: "warning", title: "Your trial ends in 3 days", description: "Add a payment method to keep your projects.", actions: [{ label: "Add card", variant: "link" }] } },
  variants: [
    { tone: "success", title: "Changes saved" },
    { tone: "danger", title: "Payment failed", description: "Your card was declined.", dismissible: true },
  ],
  render: (n, ctx) => {
    const p = n.props;
    const icon = p.icon === "none" ? "" : ctx.icon(p.icon ?? TONE_ICON[p.tone]!, 18, "fx-alert-icon");
    return `<div role="alert" ${ctx.attrs(n, cls("fx-alert", `fx-alert--${p.tone}`))}>${icon}<div class="fx-alert-body">${p.title ? `<div class="fx-alert-title">${ctx.edit("/title", p.title)}</div>` : ""}${p.description ? `<div class="fx-alert-desc">${ctx.edit("/description", p.description)}</div>` : ""}${p.actions.length ? `<div class="fx-alert-actions">${actionButtons(ctx, p.actions, "sm")}</div>` : ""}</div>${p.dismissible ? ctx.icon("x", 16, "fx-alert-close") : ""}</div>`;
  },
});

export const emptyState = defineComponent({
  type: "empty-state",
  category: "feedback",
  summary: "Centered placeholder for a list or page with nothing in it yet: icon, title, description and a call to action.",
  container: false,
  props: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      icon: z.string().default("inbox"),
      actions: z.array(Action).default([]),
      bordered: z.boolean().default(false).describe("Dashed outline, for an empty region inside a page."),
    })
    .strict(),
  example: { width: 420, props: { icon: "folder-open", title: "No projects yet", description: "Projects you create or join show up here.", actions: [{ label: "New project", variant: "primary", icon: "plus" }] } },
  render: (n, ctx) => {
    const p = n.props;
    return `<div ${ctx.attrs(n, cls("fx-empty", p.bordered && "fx-empty--bordered"))}><span class="fx-empty-icon">${ctx.icon(p.icon, 24)}</span><div class="fx-empty-title">${ctx.edit("/title", p.title)}</div>${p.description ? `<div class="fx-empty-desc">${ctx.edit("/description", p.description)}</div>` : ""}${p.actions.length ? `<div class="fx-empty-actions">${actionButtons(ctx, p.actions)}</div>` : ""}</div>`;
  },
});

export const toast = defineComponent({
  type: "toast",
  category: "feedback",
  summary: "Transient notification floating over the frame (top or bottom of the first viewport). One per frame.",
  container: false,
  props: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      tone: Tone.default("neutral"),
      icon: z.string().optional().describe("Defaults to one matching the tone; \"none\" hides it."),
      action: z.string().optional().describe("Short action label, e.g. \"Undo\"."),
      placement: z.enum(["bottom", "top"]).default("bottom"),
    })
    .strict(),
  example: { width: 380, props: { tone: "success", title: "Invoice sent", description: "ada@acme.com will get it in a minute.", action: "Undo" } },
  render: (n, ctx) => {
    const p = n.props;
    const icon = p.icon === "none" ? "" : ctx.icon(p.icon ?? TONE_ICON[p.tone]!, 18, `fx-toast-icon fx-tone-${p.tone}`);
    return `<div class="fx-overlay fx-overlay--toast fx-overlay--${p.placement}"><div role="status" ${ctx.attrs(n, "fx-toast")}>${icon}<div class="fx-toast-body"><div class="fx-toast-title">${ctx.edit("/title", p.title)}</div>${p.description ? `<div class="fx-toast-desc">${ctx.edit("/description", p.description)}</div>` : ""}</div>${p.action ? `<span class="fx-toast-action">${ctx.edit("/action", p.action)}</span>` : ""}</div></div>`;
  },
});

const MODAL_W = { sm: 400, md: 520, lg: 720 } as const;

export const modal = defineComponent({
  type: "modal",
  category: "feedback",
  summary: "Dialog over a dimmed frame. Children are the body; title, description and footer actions are props. Use one per frame, as the last child of the root.",
  container: true,
  props: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      size: z.enum(["sm", "md", "lg"]).default("md"),
      actions: z.array(Action).default([]).describe("Footer buttons, right-aligned; put the primary last."),
      dismissible: z.boolean().default(true).describe("Show a close button."),
    })
    .strict(),
  example: {
    width: 460,
    props: { title: "Delete project?", description: "This removes Apollo and its 24 screens for everyone.", size: "sm", actions: [{ label: "Cancel" }, { label: "Delete", variant: "danger" }] },
  },
  render: (n, ctx) => {
    const p = n.props;
    const w = Math.min(MODAL_W[p.size], ctx.frameWidth - 32);
    const body = n.children.length ? `<div class="fx-modal-body">${ctx.renderAll(n.children)}</div>` : "";
    return `<div class="fx-overlay fx-overlay--modal"><div class="fx-scrim"></div><div role="dialog" ${ctx.attrs(n, "fx-modal", { width: `${w}px` })}><div class="fx-modal-head"><div class="fx-modal-titles"><div class="fx-modal-title">${ctx.edit("/title", p.title)}</div>${p.description ? `<div class="fx-modal-desc">${ctx.edit("/description", p.description)}</div>` : ""}</div>${p.dismissible ? ctx.icon("x", 18, "fx-modal-close") : ""}</div>${body}${p.actions.length ? `<div class="fx-modal-foot">${actionButtons(ctx, p.actions)}</div>` : ""}</div></div>`;
  },
});

export const drawer = defineComponent({
  type: "drawer",
  category: "feedback",
  summary: "Panel sliding over the frame from the right or left, or a bottom sheet on phones. Children are the body.",
  container: true,
  props: z
    .object({
      title: z.string().optional(),
      side: z.enum(["right", "left", "bottom"]).default("right"),
      size: z.number().positive().optional().describe("Width (left/right) or height (bottom) in px. Defaults: 400 wide, or fit content for bottom."),
      actions: z.array(Action).default([]).describe("Footer buttons."),
      dismissible: z.boolean().default(true),
      scrim: z.boolean().default(true).describe("Dim the frame behind it."),
    })
    .strict(),
  example: {
    width: 460,
    props: { title: "Filters", side: "right", size: 260, actions: [{ label: "Reset", variant: "ghost" }, { label: "Apply", variant: "primary" }] },
    children: [{ type: "checkbox", props: { label: "Only mine", checked: true } }, { type: "checkbox", props: { label: "Archived" } }],
  },
  render: (n, ctx) => {
    const p = n.props;
    const sideways = p.side !== "bottom";
    const size = sideways ? `${Math.min(p.size ?? 400, ctx.frameWidth - 48)}px` : p.size ? `${p.size}px` : undefined;
    const grip = p.side === "bottom" ? '<span class="fx-drawer-grip"></span>' : "";
    const head = p.title || p.dismissible ? `<div class="fx-drawer-head">${p.title ? `<div class="fx-drawer-title">${ctx.edit("/title", p.title)}</div>` : "<span></span>"}${p.dismissible ? ctx.icon("x", 18, "fx-modal-close") : ""}</div>` : "";
    return `<div class="fx-overlay fx-overlay--drawer fx-overlay--${p.side}">${p.scrim ? '<div class="fx-scrim"></div>' : ""}<aside ${ctx.attrs(n, cls("fx-drawer", `fx-drawer--${p.side}`), sideways ? { width: size } : { height: size })}>${grip}${head}<div class="fx-drawer-body">${ctx.renderAll(n.children)}</div>${p.actions.length ? `<div class="fx-modal-foot">${actionButtons(ctx, p.actions)}</div>` : ""}</aside></div>`;
  },
});
