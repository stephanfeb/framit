import { COMPONENTS } from "../components/index.js";
import { screenHotspots } from "../schema/flow.js";
import { COLOR_TOKENS } from "../schema/tokens.js";
import { walkScreenNodes } from "../store/nodes.js";

/*
 * Static checks on screen documents (docs/05-mcp-interface.md, `lint`). They need no browser and
 * run on every write_screen/patch_screen as well as in the `lint` tool. Layout checks (overflow,
 * truncated text) need a browser and live in screenshot.ts.
 */

export interface LintIssue {
  rule: string;
  frame?: string;
  node?: string;
  screen?: string;
  message: string;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const TOKENS = new Set<string>(COLOR_TOKENS);
/** Fields whose label is how a person knows what to type; a placeholder alone disappears on input. */
const LABELLED_FIELDS = new Set(["input", "textarea", "select", "radio-group"]);

export interface ScreenLintContext {
  /** Ids of screens that exist, for hotspot targets. */
  screens: Set<string>;
  /** Flows this screen is a step of: whether it is their last step, and node ids their explicit edges start from. */
  flows?: Array<{ id: string; last: boolean; linked: Set<string> }>;
}

export function lintScreen(doc: Json, ctx: ScreenLintContext): LintIssue[] {
  const issues: LintIssue[] = [];
  const frames = Array.isArray(doc.frames) ? (doc.frames as Json[]) : [];
  for (const frame of frames) {
    const fid = typeof frame.id === "string" ? frame.id : undefined;
    walkScreenNodes({ frames: [frame] }, (node) => {
      const id = typeof node.id === "string" ? node.id : undefined;
      const type = String(node.type);
      const props = isObj(node.props) ? node.props : {};
      const at = { frame: fid, node: id };

      if (isObj(node.style)) {
        for (const key of ["color", "background"] as const) {
          const v = node.style[key];
          if (typeof v === "string" && !TOKENS.has(v)) {
            issues.push({ rule: "raw-colour", ...at, message: `${type} uses a raw ${key} "${v}". Use a colour token (${COLOR_TOKENS.slice(0, 6).join(", ")}, …) so the screen follows the theme, including dark themes.` });
          }
        }
      }

      if (LABELLED_FIELDS.has(type) && !props.label && !(type === "input" && props.type === "search")) {
        issues.push({ rule: "unlabelled-field", ...at, message: `${type} has no label${props.placeholder ? ` (only the placeholder "${props.placeholder}")` : ""}. Add a label; a placeholder disappears as soon as someone types.` });
      }

      // A modal's body is optional: title, description and actions can be the whole dialog.
      if (COMPONENTS[type]?.container && type !== "modal" && Array.isArray(node.children) && node.children.length === 0) {
        issues.push({ rule: "empty-container", ...at, message: `${type} has no children. Remove it or fill it.` });
      }

      // A primary button on a flow step that is not the last one is the obvious way forward.
      const midFlows = (ctx.flows ?? []).filter((f) => !f.last && !(id && f.linked.has(id)));
      if (midFlows.length && type === "button" && props.variant === "primary" && !props.to && !props.disabled) {
        issues.push({ rule: "dead-end", ...at, message: `Primary button "${props.label ?? props.icon ?? ""}" leads nowhere, and this screen is a step of flow ${midFlows.map((f) => f.id).join(", ")}. Give it \`to\` (the next screen) so the prototype can be clicked through.` });
      }
    });
  }
  for (const h of screenHotspots(doc)) {
    if (!ctx.screens.has(h.to)) issues.push({ rule: "missing-screen", node: h.node, message: `Hotspot leads to "${h.to}", which is not a screen (yet). It does nothing until that screen exists.` });
  }
  return issues;
}
