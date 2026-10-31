import { z } from "zod";

/*
 * STUB schema for M0. It fixes the document envelope and the frame/node shape so the store
 * and tools have something real to validate against; component props are left open.
 * M1 (framit-1fa.1) replaces this with the full component catalogue from
 * docs/03-document-model.md, including the style whitelist from ADR-002.
 */

export const DocId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  .describe('Document id; also the filename. Lowercase slug, e.g. "account-overview".');

const Envelope = {
  id: DocId,
  name: z.string().min(1).describe("Human-readable name."),
  revision: z.number().int().nonnegative().optional().describe("Assigned by the server; ignored on write."),
  updatedAt: z.string().optional().describe("Assigned by the server; ignored on write."),
};

export interface NodeShape {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  children?: NodeShape[];
  style?: Record<string, unknown>;
  notes?: string;
}

export const Node: z.ZodType<NodeShape> = z.lazy(() =>
  z.object({
    id: z.string().optional().describe("Stable node id; assigned by the server if missing. Preserve it when rewriting."),
    type: z.string().describe("Component type, e.g. stack, row, grid, card, text, button."),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(Node).optional().describe("Child nodes, for container components."),
    style: z.record(z.string(), z.unknown()).optional().describe("Small constrained overrides. Never positions."),
    notes: z.string().optional().describe("Designer annotation; not rendered in the frame."),
  }),
);

export const Device = z.union([
  z.enum(["desktop", "laptop", "tablet", "phone"]),
  z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
]);

export const Frame = z.object({
  id: z.string().optional(),
  device: Device,
  position: z
    .object({ x: z.number(), y: z.number() })
    .describe("Canvas position of the frame. The ONLY absolute coordinates in a screen."),
  root: Node.describe("Root node. Everything inside is flow layout."),
});

export const Screen = z.object({
  kind: z.literal("screen").optional(),
  ...Envelope,
  theme: z.string().describe("Theme id."),
  frames: z.array(Frame).min(1),
});

export const Theme = z.object({
  kind: z.literal("theme").optional(),
  ...Envelope,
  fidelity: z.enum(["lo", "mid", "hi"]),
  mode: z.enum(["light", "dark"]),
  extends: z.string().optional(),
  tokens: z.record(z.string(), z.unknown()),
  components: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().describe("Prose for future sessions: the intent behind the numbers."),
});

export const DSL_KINDS = ["screen", "theme", "diagram", "flow"] as const;
export type DslKind = (typeof DSL_KINDS)[number];

const SCHEMAS: Partial<Record<DslKind, z.ZodType>> = { screen: Screen, theme: Theme };

export function jsonSchemaFor(kind: DslKind): unknown {
  const schema = SCHEMAS[kind];
  if (!schema) return null;
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

export const GUIDE_STUB = `Framit DSL (stub, M0)

Framit documents are JSON. A screen holds one or more frames; a frame is a device viewport
placed on the canvas. Frames are the only things with coordinates. Inside a frame, describe
structure with layout containers (stack, row, grid) and components (text, button, input,
table, ...). Never position elements by x/y inside a frame.

Themes hold tokens (colour, type scale, spacing, radius) plus prose notes. Screens reference
a theme by id and should use theme tokens ("sm", "md", "lg") instead of raw CSS values.

The full component catalogue, theme tokens, and worked examples arrive in M1. Until then
only the envelope and the frame/node shape are validated.`;
