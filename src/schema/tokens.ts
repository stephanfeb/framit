import { z } from "zod";

/*
 * Token-aware value types shared by component props and the style whitelist.
 * Models are told to prefer tokens; raw numbers are pixels.
 */

export const SPACE_TOKENS = ["none", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export const RADIUS_TOKENS = ["none", "sm", "md", "lg", "pill"] as const;
export const COLOR_TOKENS = [
  "bg", "surface", "surface2", "border", "text", "muted",
  "accent", "accentText", "success", "warning", "danger", "info",
] as const;
export const TONES = ["neutral", "accent", "info", "success", "warning", "danger"] as const;

export const Space = z
  .union([z.enum(SPACE_TOKENS), z.number().nonnegative()])
  .describe(`Spacing token (${SPACE_TOKENS.join(", ")}) or pixels.`);
export type Space = z.infer<typeof Space>;

export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

export const Length = z
  .union([z.number().nonnegative(), z.string().regex(/^(\d+(\.\d+)?(px|%|rem|em|vw|vh|fr|ch)|auto|fill)$/)])
  .describe('Pixels, a CSS length like "50%" or "24rem", "auto", or "fill".');

const ColorValue = z
  .string()
  .regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z0-9]+|rgba?\([^)]*\)|hsla?\([^)]*\))$/)
  .describe(`Colour token (${COLOR_TOKENS.join(", ")}) or a CSS colour. Prefer tokens.`);

/**
 * The style escape hatch (docs/03-document-model.md). Positioning keys are deliberately
 * absent: everything inside a frame is flow layout (ADR-002).
 */
export const Style = z
  .object({
    width: Length.optional(),
    minWidth: Length.optional(),
    maxWidth: Length.optional(),
    height: Length.optional(),
    minHeight: Length.optional(),
    maxHeight: Length.optional(),
    padding: Space.optional(),
    margin: Space.optional(),
    gap: Space.optional(),
    flex: z.number().nonnegative().optional().describe("Flex grow factor within a row or stack."),
    alignSelf: z.enum(["start", "center", "end", "stretch"]).optional(),
    background: ColorValue.optional(),
    color: ColorValue.optional(),
    borderRadius: z.union([z.enum(RADIUS_TOKENS), z.number().nonnegative()]).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
  })
  .strict()
  .describe("Small constrained overrides. No positioning: use layout containers instead.");
export type Style = z.infer<typeof Style>;

export const FORBIDDEN_STYLE_HINT =
  "Inside a frame everything is flow layout, so position, top, left, right, bottom, transform and " +
  "z-index are not allowed (ADR-002). Use stack, row, grid, split or a component prop instead. " +
  `Allowed style keys: ${Object.keys(Style.shape).join(", ")}.`;

// ---------- CSS resolution ----------

export function spaceCss(v: Space | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return `${v}px`;
  return v === "none" ? "0" : `var(--fx-space-${v})`;
}

export function lengthCss(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return `${v}px`;
  return v === "fill" ? "100%" : v;
}

export function colorCss(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return (COLOR_TOKENS as readonly string[]).includes(v) ? `var(--fx-color-${v})` : v;
}

export function radiusCss(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return `${v}px`;
  return v === "none" ? "0" : `var(--fx-radius-${v})`;
}

/** Convert a validated Style to an inline CSS declaration list. */
export function styleCss(style: Style | undefined): string {
  if (!style) return "";
  const decl: Array<[string, string | undefined]> = [
    ["width", lengthCss(style.width)],
    ["min-width", lengthCss(style.minWidth)],
    ["max-width", lengthCss(style.maxWidth)],
    ["height", lengthCss(style.height)],
    ["min-height", lengthCss(style.minHeight)],
    ["max-height", lengthCss(style.maxHeight)],
    ["padding", spaceCss(style.padding)],
    ["margin", spaceCss(style.margin)],
    ["gap", spaceCss(style.gap)],
    ["flex", style.flex === undefined ? undefined : `${style.flex} 1 0%`],
    ["align-self", style.alignSelf && (style.alignSelf === "start" || style.alignSelf === "end" ? `flex-${style.alignSelf}` : style.alignSelf)],
    ["background", colorCss(style.background)],
    ["color", colorCss(style.color)],
    ["border-radius", radiusCss(style.borderRadius)],
    ["text-align", style.textAlign],
  ];
  return decl.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v}`).join(";");
}
