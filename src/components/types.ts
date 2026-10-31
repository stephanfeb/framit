import type { z } from "zod";
import type { ResolvedTheme } from "../schema/theme.js";
import type { Style } from "../schema/tokens.js";

/** Display order for the swatch sheet, the component reference and list_components. */
export const CATEGORIES = ["layout", "navigation", "content", "form", "data", "feedback"] as const;
export type Category = (typeof CATEGORIES)[number];

/** A node as the renderer sees it: props already parsed (defaults applied). */
export interface RenderNode<P> {
  id: string;
  type: string;
  props: P;
  children: AnyNode[];
  style?: Style;
}

/** A node as authored and stored. */
export interface AnyNode {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  children?: AnyNode[];
  style?: Style;
  notes?: string;
}

export interface RenderCtx {
  theme: ResolvedTheme;
  /** Width of the frame being rendered, for responsive decisions (e.g. hiding a sidebar on phones). */
  frameWidth: number;
  readonly compact: boolean;
  render(node: AnyNode): string;
  renderAll(nodes: AnyNode[]): string;
  /** Escape text and style [placeholder] slots. */
  text(s: string | number | undefined): string;
  /**
   * Like text(), wrapped in a span marking which prop it shows (JSON Pointer relative to the
   * node's props, e.g. "/label" or "/items/2/label"), so the editor can edit it in place.
   */
  edit(pointer: string, s: string | number | undefined): string;
  icon(name: string, size?: number, extraClass?: string): string;
  /** `data-node`, `data-type`, class and merged inline style for a node's outer element. */
  attrs(node: RenderNode<unknown>, className: string, style?: Record<string, string | undefined>): string;
  warn(nodeId: string | undefined, message: string): void;
}

export interface ComponentDef<S extends z.ZodType = z.ZodType> {
  type: string;
  category: Category;
  summary: string;
  container: boolean;
  props: S;
  /** Minimal example used by docs, list_components and the theme swatch sheet. */
  example: Omit<AnyNode, "type"> & { width?: number };
  /** Extra variants shown on the swatch sheet: complete props objects (not merged with the example). Containers reuse the example's children. */
  variants?: Array<Record<string, unknown>>;
  render(node: RenderNode<z.output<S>>, ctx: RenderCtx): string;
}

export function defineComponent<S extends z.ZodType>(def: ComponentDef<S>): ComponentDef<S> {
  return def;
}
