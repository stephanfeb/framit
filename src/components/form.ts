import { z } from "zod";
import { cls, esc } from "../renderer/html.js";
import type { RenderCtx } from "./types.js";
import { defineComponent } from "./types.js";

export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "link"] as const;

export const button = defineComponent({
  type: "button",
  category: "form",
  summary: "Button. One primary per region. Icon-only buttons need an icon and no label.",
  container: false,
  props: z
    .object({
      label: z.string().optional(),
      variant: z.enum(BUTTON_VARIANTS).default("secondary"),
      size: z.enum(["sm", "md", "lg"]).default("md"),
      icon: z.string().optional().describe("Leading Lucide icon."),
      iconRight: z.string().optional(),
      fullWidth: z.boolean().default(false),
      disabled: z.boolean().default(false),
      to: z.string().optional().describe("Screen id to navigate to in preview mode."),
    })
    .strict(),
  example: { props: { label: "Save changes", variant: "primary" } },
  variants: [
    ...BUTTON_VARIANTS.map((variant) => ({ label: variant[0]!.toUpperCase() + variant.slice(1), variant })),
    { label: "With icon", icon: "plus", variant: "primary" },
    { icon: "ellipsis", variant: "ghost" },
  ],
  render: (n, ctx) => {
    const p = n.props;
    if (!p.label && !p.icon) ctx.warn(n.id, "button has neither label nor icon.");
    const iconOnly = !p.label && !!p.icon;
    const sz = p.size === "sm" ? 14 : p.size === "lg" ? 18 : 16;
    return `<button type="button" ${ctx.attrs(n, cls("fx-button", `fx-button--${p.variant}`, `fx-button--${p.size}`, p.fullWidth && "fx-button--full", iconOnly && "fx-button--icon"))}${p.disabled ? " disabled" : ""}${p.to ? ` data-to="${esc(p.to)}"` : ""}>${p.icon ? ctx.icon(p.icon, sz) : ""}${p.label ? `<span>${ctx.text(p.label)}</span>` : ""}${p.iconRight ? ctx.icon(p.iconRight, sz) : ""}</button>`;
  },
});

const fieldShell = (ctx: RenderCtx, p: { label?: string; hint?: string; error?: string; required?: boolean }, control: string) =>
  `${p.label ? `<span class="fx-field-label">${ctx.text(p.label)}${p.required ? '<span class="fx-required">*</span>' : ""}</span>` : ""}${control}${p.error ? `<span class="fx-field-error">${ctx.icon("circle-alert", 14)}${ctx.text(p.error)}</span>` : p.hint ? `<span class="fx-field-hint">${ctx.text(p.hint)}</span>` : ""}`;

const FieldBase = {
  label: z.string().optional(),
  hint: z.string().optional(),
  error: z.string().optional().describe("Error message; shows the field in its error state."),
  required: z.boolean().default(false),
  disabled: z.boolean().default(false),
};

export const input = defineComponent({
  type: "input",
  category: "form",
  summary: "Text field with label, placeholder or value, hint and error state.",
  container: false,
  props: z
    .object({
      ...FieldBase,
      placeholder: z.string().optional(),
      value: z.string().optional(),
      type: z.enum(["text", "email", "password", "search", "number", "date", "url", "tel"]).default("text"),
      icon: z.string().optional().describe("Leading Lucide icon."),
      suffix: z.string().optional().describe('Trailing text, e.g. "USD" or ".acme.com".'),
    })
    .strict(),
  example: { width: 260, props: { label: "Email", placeholder: "you@company.com", hint: "We never share it." } },
  variants: [{ label: "With value", value: "Ada Lovelace" }, { label: "Error", value: "ada@", error: "Enter a valid email." }, { placeholder: "Search", icon: "search", type: "search" }],
  render: (n, ctx) => {
    const p = n.props;
    const shown = p.type === "password" && p.value ? "•".repeat(Math.min(p.value.length, 12)) : p.value;
    const control = `<div class="${cls("fx-control", "fx-input", p.error && "is-error", p.disabled && "is-disabled")}">${p.icon ? ctx.icon(p.icon, 16, "fx-muted-icon") : ""}<input type="${p.type === "password" ? "text" : esc(p.type)}" value="${esc(shown ?? "")}" placeholder="${esc(p.placeholder ?? "")}"${p.disabled ? " disabled" : ""}>${p.suffix ? `<span class="fx-input-suffix">${ctx.text(p.suffix)}</span>` : ""}</div>`;
    return `<label ${ctx.attrs(n, "fx-field")}>${fieldShell(ctx, p, control)}</label>`;
  },
});

export const textarea = defineComponent({
  type: "textarea",
  category: "form",
  summary: "Multi-line text field.",
  container: false,
  props: z.object({ ...FieldBase, placeholder: z.string().optional(), value: z.string().optional(), rows: z.number().int().min(1).max(20).default(4) }).strict(),
  example: { width: 260, props: { label: "Bio", placeholder: "Tell us about yourself", rows: 3 } },
  render: (n, ctx) => {
    const p = n.props;
    const control = `<textarea class="${cls("fx-control", "fx-textarea", p.error && "is-error")}" rows="${p.rows}" placeholder="${esc(p.placeholder ?? "")}"${p.disabled ? " disabled" : ""}>${esc(p.value ?? "")}</textarea>`;
    return `<label ${ctx.attrs(n, "fx-field")}>${fieldShell(ctx, p, control)}</label>`;
  },
});

export const select = defineComponent({
  type: "select",
  category: "form",
  summary: "Dropdown. Shows value, else placeholder, else the first option.",
  container: false,
  props: z
    .object({ ...FieldBase, options: z.array(z.string()).default([]), value: z.string().optional(), placeholder: z.string().optional(), icon: z.string().optional() })
    .strict(),
  example: { width: 260, props: { label: "Timezone", value: "Europe/Amsterdam", options: ["Europe/Amsterdam", "UTC", "America/New_York"] } },
  render: (n, ctx) => {
    const p = n.props;
    const opts = p.value && !p.options.includes(p.value) ? [p.value, ...p.options] : p.options;
    const shown = p.value ?? (p.placeholder ? undefined : opts[0]);
    const options = [
      ...(shown === undefined ? [`<option value="" selected disabled>${esc(p.placeholder ?? "")}</option>`] : []),
      ...opts.map((o) => `<option${o === shown ? " selected" : ""}>${esc(o)}</option>`),
    ].join("");
    const control = `<div class="${cls("fx-control", "fx-select", p.error && "is-error", shown === undefined && "is-placeholder")}">${p.icon ? ctx.icon(p.icon, 16, "fx-muted-icon") : ""}<select${p.disabled ? " disabled" : ""}>${options}</select>${ctx.icon("chevron-down", 16, "fx-select-chevron")}</div>`;
    return `<label ${ctx.attrs(n, "fx-field")}>${fieldShell(ctx, p, control)}</label>`;
  },
});

export const checkbox = defineComponent({
  type: "checkbox",
  category: "form",
  summary: "Checkbox with label and optional hint.",
  container: false,
  props: z.object({ label: z.string(), checked: z.boolean().default(false), hint: z.string().optional(), disabled: z.boolean().default(false) }).strict(),
  example: { props: { label: "Email me about product updates", checked: true } },
  render: (n, ctx) =>
    `<label ${ctx.attrs(n, cls("fx-check", n.props.disabled && "is-disabled"))}><input type="checkbox"${n.props.checked ? " checked" : ""}${n.props.disabled ? " disabled" : ""}><span class="fx-check-box">${ctx.icon("check", 12)}</span><span class="fx-check-text"><span>${ctx.text(n.props.label)}</span>${n.props.hint ? `<span class="fx-field-hint">${ctx.text(n.props.hint)}</span>` : ""}</span></label>`,
});

export const toggle = defineComponent({
  type: "toggle",
  category: "form",
  summary: "On/off switch. With a label it spans the row: label and hint left, switch right (settings style).",
  container: false,
  props: z.object({ label: z.string().optional(), checked: z.boolean().default(false), hint: z.string().optional(), disabled: z.boolean().default(false) }).strict(),
  example: { width: 300, props: { label: "Two-factor authentication", hint: "Require a code at sign-in.", checked: true } },
  render: (n, ctx) => {
    const p = n.props;
    const sw = `<span class="fx-switch"><input type="checkbox"${p.checked ? " checked" : ""}${p.disabled ? " disabled" : ""}><span class="fx-switch-track"></span></span>`;
    if (!p.label) return `<label ${ctx.attrs(n, "fx-toggle fx-toggle--bare")}>${sw}</label>`;
    return `<label ${ctx.attrs(n, cls("fx-toggle", p.disabled && "is-disabled"))}><span class="fx-check-text"><span class="fx-toggle-label">${ctx.text(p.label)}</span>${p.hint ? `<span class="fx-field-hint">${ctx.text(p.hint)}</span>` : ""}</span>${sw}</label>`;
  },
});

const RadioOption = z.union([z.string(), z.object({ label: z.string(), hint: z.string().optional() }).strict()]);

export const radioGroup = defineComponent({
  type: "radio-group",
  category: "form",
  summary: "Single choice from a few options. direction=row for short labels; variant=cards for rich options.",
  container: false,
  props: z
    .object({
      label: z.string().optional(),
      options: z.array(RadioOption).min(2),
      value: z.string().optional().describe("Label of the selected option; defaults to the first."),
      direction: z.enum(["column", "row"]).default("column"),
      variant: z.enum(["plain", "cards"]).default("plain"),
    })
    .strict(),
  example: { width: 300, props: { label: "Appearance", options: ["Light", "Dark", "System"], value: "System", direction: "row" } },
  render: (n, ctx) => {
    const p = n.props;
    const opts = p.options.map((o) => (typeof o === "string" ? { label: o, hint: undefined } : o));
    const selected = p.value ?? opts[0]?.label;
    const items = opts
      .map(
        (o) =>
          `<label class="${cls("fx-radio", o.label === selected && "is-checked")}"><input type="radio" name="${esc(n.id)}"${o.label === selected ? " checked" : ""}><span class="fx-radio-dot"></span><span class="fx-check-text"><span>${ctx.text(o.label)}</span>${o.hint ? `<span class="fx-field-hint">${ctx.text(o.hint)}</span>` : ""}</span></label>`,
      )
      .join("");
    return `<div ${ctx.attrs(n, cls("fx-field", "fx-radio-group", `fx-radio-group--${p.direction}`, `fx-radio-group--${p.variant}`))} role="radiogroup">${p.label ? `<span class="fx-field-label">${ctx.text(p.label)}</span>` : ""}<div class="fx-radio-options">${items}</div></div>`;
  },
});
