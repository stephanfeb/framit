import { z } from "zod";
import { DocId } from "./common.js";
import { RADIUS_TOKENS } from "./tokens.js";

/*
 * Theme documents (docs/03-document-model.md "Themes"). A theme is the contract that keeps
 * screens consistent across sessions: tokens + component settings + prose notes.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Use a 6- or 8-digit hex colour like #5b7cff.");

export const ColorTokens = z
  .object({
    bg: Hex.describe("Canvas/page background inside a frame."),
    surface: Hex.describe("Cards, sidebars, inputs."),
    surface2: Hex.describe("Raised or hovered surfaces, table headers."),
    border: Hex,
    text: Hex,
    muted: Hex.describe("Secondary text."),
    accent: Hex.describe("Primary actions, links, active nav."),
    accentText: Hex.describe("Text on accent backgrounds."),
    success: Hex,
    warning: Hex,
    danger: Hex,
    info: Hex,
  })
  .strict();

const TypeRole = z
  .tuple([z.number().positive(), z.number().positive(), z.number().int().min(100).max(900), z.number()])
  .describe("[fontSize px, lineHeight, fontWeight, letterSpacing em]");

export const TYPE_ROLES = ["display", "h1", "h2", "h3", "body", "label", "caption", "overline", "code"] as const;

export const TypeScale = z.object(Object.fromEntries(TYPE_ROLES.map((r) => [r, TypeRole])) as Record<(typeof TYPE_ROLES)[number], typeof TypeRole>).strict();

export const SpaceScale = z
  .object({
    unit: z.number().positive().describe("Base unit in px. Every other value is a multiple of it."),
    xs: z.number().nonnegative(),
    sm: z.number().nonnegative(),
    md: z.number().nonnegative(),
    lg: z.number().nonnegative(),
    xl: z.number().nonnegative(),
    "2xl": z.number().nonnegative(),
  })
  .strict();

export const RadiusScale = z.object({ sm: z.number(), md: z.number(), lg: z.number(), pill: z.number() }).strict();

export const DEVICE_NAMES = ["desktop", "laptop", "tablet", "phone"] as const;
const Size = z.tuple([z.number().int().positive(), z.number().int().positive()]);

export const Tokens = z
  .object({
    color: ColorTokens,
    font: z.object({ sans: z.string(), mono: z.string() }).strict(),
    type: TypeScale,
    space: SpaceScale,
    radius: RadiusScale,
    stroke: z.object({ width: z.number().nonnegative() }).strict(),
    shadow: z.object({ sm: z.string(), md: z.string(), lg: z.string() }).strict(),
    device: z.object(Object.fromEntries(DEVICE_NAMES.map((d) => [d, Size])) as Record<(typeof DEVICE_NAMES)[number], typeof Size>).strict(),
  })
  .strict();

const RadiusRef = z.union([z.enum(RADIUS_TOKENS), z.number().nonnegative()]);

export const ComponentSettings = z
  .object({
    button: z.object({ radius: RadiusRef, height: z.number().positive() }).partial().strict(),
    input: z.object({ radius: RadiusRef, height: z.number().positive() }).partial().strict(),
    card: z
      .object({
        radius: RadiusRef,
        padding: z.enum(["sm", "md", "lg", "xl"]),
        border: z.boolean(),
        shadow: z.enum(["none", "sm", "md", "lg"]),
      })
      .partial()
      .strict(),
    nav: z.object({ activeStyle: z.enum(["pill", "bar", "text"]) }).partial().strict(),
    table: z.object({ header: z.enum(["plain", "filled"]), zebra: z.boolean() }).partial().strict(),
  })
  .partial()
  .strict();

const Meta = {
  id: DocId,
  name: z.string().min(1),
  revision: z.number().int().optional(),
  updatedAt: z.string().optional(),
  kind: z.literal("theme").optional(),
};

/** A fully specified theme, after `extends` has been resolved. */
export const ResolvedTheme = z
  .object({
    ...Meta,
    fidelity: z.enum(["lo", "mid", "hi"]).describe("lo: greyscale sketch; mid: clean neutral; hi: brand colour."),
    mode: z.enum(["light", "dark"]),
    tokens: Tokens,
    components: ComponentSettings.default({}),
    notes: z.string().describe("Prose for future sessions: the intent behind the numbers. Write it for a designer who has never seen the product."),
  })
  .strict();
export type ResolvedTheme = z.infer<typeof ResolvedTheme>;

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** What a caller may write: either complete, or `extends` another theme and override parts. */
export const ThemeInput = z
  .object({
    ...Meta,
    extends: DocId.optional().describe("Base theme id. Tokens and components are deep-merged over it."),
    fidelity: z.enum(["lo", "mid", "hi"]).optional(),
    mode: z.enum(["light", "dark"]).optional(),
    tokens: z.record(z.string(), z.unknown()).optional().describe("Theme tokens; may be partial when `extends` is set."),
    components: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
  })
  .strict();
export type ThemeInput = z.infer<typeof ThemeInput> & { tokens?: DeepPartial<ResolvedTheme["tokens"]> };

/** Deep merge for plain objects; arrays and scalars from `over` replace those in `base`. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (!isPlain(base) || !isPlain(over)) return over as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
