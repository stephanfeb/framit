import { TYPE_ROLES, type ResolvedTheme } from "../schema/theme.js";

/** Attribute selector that scopes a theme's variables to the frames that use it. */
export const themeScope = (id: string) => `[data-fx-theme="${id}"]`;

const radiusVar = (v: string | number | undefined, fallback: string) =>
  v === undefined ? fallback : typeof v === "number" ? `${v}px` : v === "none" ? "0" : `var(--fx-radius-${v})`;

/**
 * Compile a resolved theme to CSS custom properties. The component stylesheet
 * (renderer/base-css.ts) is static and reads only these variables, so a theme really
 * is just a stylesheet.
 */
export function compileThemeCss(theme: ResolvedTheme): string {
  const t = theme.tokens;
  const c = theme.components;
  const vars: Array<[string, string | number]> = [];

  for (const [k, v] of Object.entries(t.color)) vars.push([`--fx-color-${k}`, v]);
  vars.push(["--fx-font-sans", t.font.sans], ["--fx-font-mono", t.font.mono]);
  for (const role of TYPE_ROLES) {
    const [size, lh, weight, ls] = t.type[role];
    vars.push([`--fx-t-${role}-size`, `${size}px`], [`--fx-t-${role}-lh`, lh], [`--fx-t-${role}-weight`, weight], [`--fx-t-${role}-ls`, `${ls}em`]);
  }
  for (const k of ["xs", "sm", "md", "lg", "xl", "2xl"] as const) vars.push([`--fx-space-${k}`, `${t.space[k] * t.space.unit}px`]);
  for (const [k, v] of Object.entries(t.radius)) vars.push([`--fx-radius-${k}`, `${v}px`]);
  vars.push(["--fx-stroke", `${t.stroke.width}px`]);
  for (const [k, v] of Object.entries(t.shadow)) vars.push([`--fx-shadow-${k}`, v]);

  vars.push(
    ["--fx-button-radius", radiusVar(c.button?.radius, "var(--fx-radius-md)")],
    ["--fx-button-height", `${c.button?.height ?? 36}px`],
    ["--fx-input-radius", radiusVar(c.input?.radius, "var(--fx-radius-md)")],
    ["--fx-input-height", `${c.input?.height ?? 38}px`],
    ["--fx-card-radius", radiusVar(c.card?.radius, "var(--fx-radius-lg)")],
    ["--fx-card-padding", `var(--fx-space-${c.card?.padding ?? "lg"})`],
    ["--fx-card-shadow", c.card?.shadow && c.card.shadow !== "none" ? `var(--fx-shadow-${c.card.shadow})` : "none"],
  );

  const body = vars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  return `/* Framit theme: ${theme.id} (generated; edit the theme JSON, not this file) */\n${themeScope(theme.id)} {\n  color-scheme: ${theme.mode};\n${body}\n}\n`;
}
