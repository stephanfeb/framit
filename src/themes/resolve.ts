import { FramitError } from "../errors.js";
import { validate } from "../schema/screen.js";
import { ResolvedTheme, ThemeInput, deepMerge } from "../schema/theme.js";

export type ThemeLoader = (id: string) => Promise<Record<string, unknown> | undefined>;

/**
 * Resolve a theme document into a complete theme by following `extends` and deep-merging.
 * The result is validated against the full schema, so a partial theme without a base fails
 * with a precise path.
 */
export async function resolveTheme(input: Record<string, unknown>, load: ThemeLoader): Promise<ResolvedTheme> {
  const chain: Record<string, unknown>[] = [validate(ThemeInput, input, `theme "${String(input.id)}"`)];
  const seen = new Set([String(input.id)]);
  while (typeof chain[chain.length - 1]!.extends === "string") {
    const baseId = chain[chain.length - 1]!.extends as string;
    if (seen.has(baseId)) throw new FramitError("SCHEMA", `Theme extends cycle through "${baseId}".`);
    seen.add(baseId);
    const base = await load(baseId);
    if (!base) throw new FramitError("THEME_MISSING", `Theme "${String(input.id)}" extends "${baseId}", which does not exist.`, { hint: "Create the base theme first or remove `extends`." });
    chain.push(validate(ThemeInput, base, `theme "${baseId}"`));
  }
  let merged: Record<string, unknown> = {};
  for (const layer of chain.reverse()) merged = deepMerge(merged, layer);
  const { extends: _e, revision: _r, updatedAt: _u, kind: _k, ...rest } = merged;
  return validate(ResolvedTheme, { ...rest, id: input.id, name: input.name }, `theme "${String(input.id)}"`);
}
