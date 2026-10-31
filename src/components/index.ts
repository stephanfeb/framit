import type { ComponentDef } from "./types.js";
import * as layout from "./layout.js";
import * as content from "./content.js";
import * as form from "./form.js";
import * as data from "./data.js";
import * as navigation from "./navigation.js";
import * as feedback from "./feedback.js";
import * as chart from "./chart.js";

/** Every component, keyed by `type`. The single registry the schema, renderer and docs derive from. */
export const COMPONENTS: Record<string, ComponentDef> = Object.fromEntries(
  [layout, content, form, data, navigation, feedback, chart]
    .flatMap((m) => Object.values(m) as unknown[])
    .filter((d): d is ComponentDef => typeof d === "object" && d !== null && "type" in d && "render" in d && "props" in d)
    .map((d) => [d.type, d]),
);

export const COMPONENT_TYPES = Object.keys(COMPONENTS);

export { CATEGORIES } from "./types.js";
export type { AnyNode, ComponentDef, RenderCtx, RenderNode } from "./types.js";
