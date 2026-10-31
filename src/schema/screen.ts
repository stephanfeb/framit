import { z } from "zod";
import { COMPONENTS, COMPONENT_TYPES, type AnyNode } from "../components/index.js";
import { FramitError } from "../errors.js";
import { DocId } from "./common.js";
import { DEVICE_NAMES } from "./theme.js";
import { FORBIDDEN_STYLE_HINT, Style } from "./tokens.js";

/*
 * Screen documents (docs/03-document-model.md "Screens"). Node schemas are generated from
 * the component registry, so the schema, renderer and docs never disagree.
 */

export const Node = z.lazy(() =>
  z.discriminatedUnion(
    "type",
    Object.values(COMPONENTS).map((def) =>
      z
        .object({
          id: z.string().optional().describe("Stable node id; assigned if missing. Preserve it when rewriting."),
          type: z.literal(def.type),
          props: def.props.optional(),
          ...(def.container ? { children: z.array(Node).optional() } : {}),
          style: Style.optional(),
          notes: z.string().optional().describe("Designer annotation; not rendered."),
        })
        .strict()
        .describe(def.summary),
    ) as unknown as [z.ZodObject, ...z.ZodObject[]],
  ),
).meta({ id: "Node" }) as unknown as z.ZodType<AnyNode>;

export const Device = z.union([
  z.enum(DEVICE_NAMES),
  z.object({ width: z.number().int().min(240).max(4096), height: z.number().int().min(240).max(8192) }).strict(),
]);

export const Frame = z
  .object({
    id: z.string().optional(),
    name: z.string().optional().describe('Label shown above the frame, e.g. "Desktop".'),
    device: Device.default("desktop"),
    position: z
      .object({ x: z.number(), y: z.number() })
      .strict()
      .optional()
      .describe("Canvas position. The ONLY absolute coordinates in a screen. Omit to auto-place frames left to right."),
    background: z.string().optional().describe("Colour token or CSS colour for the frame background."),
    root: Node.describe("Root node. Everything inside is flow layout."),
  })
  .strict();

export const Screen = z
  .object({
    kind: z.literal("screen").optional(),
    id: DocId,
    name: z.string().min(1),
    theme: DocId.optional().describe("Theme id. Defaults to the project's default theme."),
    description: z.string().optional().describe("What this screen is for; helps later sessions."),
    frames: z.array(Frame).min(1),
    revision: z.number().int().optional(),
    updatedAt: z.string().optional(),
    comments: z.array(z.unknown()).optional(),
  })
  .strict();
export type Screen = z.infer<typeof Screen>;
export type ScreenInput = z.input<typeof Screen>;
export type FrameT = z.infer<typeof Frame>;

// ---------- friendly validation ----------

export interface SchemaIssue {
  path: string;
  message: string;
  hint?: string;
}

/** Validate and return issues with hints a model can act on, instead of raw Zod output. */
export function validate<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const issues = res.error.issues.slice(0, 12).map((i) => explain(i, input));
  const first = issues[0]!;
  throw new FramitError("SCHEMA", `${label} is invalid: ${first.path}: ${first.message}`, {
    hint: first.hint ?? "Call describe_dsl for the schema.",
    data: { issues },
  });
}

function explain(issue: z.core.$ZodIssue, root: unknown): SchemaIssue {
  const path = formatPath(issue.path, root);
  const at = valueAt(root, issue.path);
  const parentType = typeOfNodeAt(root, issue.path);

  if (issue.code === "unrecognized_keys") {
    const last = issue.path[issue.path.length - 1];
    if (last === "style") return { path, message: `style keys not allowed: ${issue.keys.join(", ")}`, hint: FORBIDDEN_STYLE_HINT };
    if (last === "props" && parentType && COMPONENTS[parentType]) {
      const allowed = Object.keys((COMPONENTS[parentType].props as z.ZodObject).shape ?? {});
      return { path, message: `unknown ${parentType} props: ${issue.keys.join(", ")}`, hint: `${parentType} accepts: ${allowed.join(", ")}.` };
    }
    if (issue.keys.includes("children") && typeof (at as AnyNode)?.type === "string") {
      return { path, message: `${(at as AnyNode).type} cannot have children`, hint: `Only containers take children: ${containerTypes().join(", ")}.` };
    }
    if (issue.keys.some((k) => ["content", "label", "title", "value", "items"].includes(k)) && typeof (at as AnyNode)?.type === "string") {
      return { path, message: `unknown keys ${issue.keys.join(", ")}`, hint: `Component settings go inside "props", e.g. {"type":"${(at as AnyNode).type}","props":{"${issue.keys[0]}":…}}.` };
    }
    return { path, message: `unknown keys: ${issue.keys.join(", ")}` };
  }

  if (issue.code === "invalid_union" && (issue as { discriminator?: string }).discriminator === "type") {
    const nodePath = issue.path[issue.path.length - 1] === "type" ? issue.path.slice(0, -1) : issue.path;
    const t = (valueAt(root, nodePath) as AnyNode | undefined)?.type;
    return {
      path: formatPath(nodePath, root),
      message: t === undefined ? "node is missing `type`" : `unknown component type "${String(t)}"`,
      hint: `Closest: ${closest(String(t ?? ""), COMPONENT_TYPES).join(", ")}. All types: ${COMPONENT_TYPES.join(", ")}.`,
    };
  }

  return { path, message: issue.message };
}

function containerTypes() {
  return Object.values(COMPONENTS).filter((c) => c.container).map((c) => c.type);
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = root;
  for (const k of path) cur = cur && typeof cur === "object" ? (cur as Record<PropertyKey, unknown>)[k] : undefined;
  return cur;
}

/** Type of the nearest enclosing node, for "unknown prop" hints. */
function typeOfNodeAt(root: unknown, path: PropertyKey[]): string | undefined {
  for (let i = path.length; i >= 0; i--) {
    const v = valueAt(root, path.slice(0, i)) as AnyNode | undefined;
    if (v && typeof v === "object" && typeof v.type === "string" && COMPONENTS[v.type]) return v.type;
  }
  return undefined;
}

/** Path with node ids/types where available: frames[0].root.children[2](button).props */
function formatPath(path: PropertyKey[], root: unknown): string {
  let out = "";
  path.forEach((k, i) => {
    out += typeof k === "number" ? `[${k}]` : `${out ? "." : ""}${String(k)}`;
    const v = valueAt(root, path.slice(0, i + 1)) as AnyNode | undefined;
    if (typeof k === "number" && v && typeof v === "object" && typeof v.type === "string") out += `(${v.type}${v.id ? ` ${v.id}` : ""})`;
  });
  return out || "(document)";
}

function closest(word: string, options: string[]): string[] {
  const d = (a: string, b: string) => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
    for (let j = 1; j <= b.length; j++) m[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length]![b.length]!;
  };
  return [...options].sort((a, b) => d(word, a) - d(word, b)).slice(0, 3);
}
