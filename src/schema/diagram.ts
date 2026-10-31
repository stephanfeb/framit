import { z } from "zod";
import { FramitError } from "../errors.js";
import { DocId } from "./common.js";

/*
 * Diagram documents (docs/03-document-model.md "Diagrams"): nodes, groups (optionally drawn as
 * lanes) and edges. Layout is automatic (elkjs) unless a node has a `position`, which pins it.
 */

export const NODE_KINDS = ["service", "database", "queue", "cache", "storage", "external", "actor", "client", "function", "note"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Default icon (lucide name) per kind. */
export const KIND_ICONS: Record<NodeKind, string> = {
  service: "server",
  database: "database",
  queue: "list-ordered",
  cache: "zap",
  storage: "hard-drive",
  external: "globe",
  actor: "user",
  client: "monitor-smartphone",
  function: "square-function",
  note: "sticky-note",
};

const NodeIdRe = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const ElementId = z.string().regex(NodeIdRe, 'Use letters, digits, "_", "-" or ".", e.g. "api" or "ledger-db".');

export const DiagramNode = z
  .object({
    id: ElementId.describe("Stable id; edges refer to it. Keep it when rewriting."),
    label: z.string().min(1),
    kind: z.enum(NODE_KINDS).default("service").describe("Shape and default icon."),
    tech: z.string().optional().describe('Technology, shown small: "Postgres 16", "Go", "Kafka".'),
    description: z.string().optional().describe("One short line of what it does."),
    group: ElementId.optional().describe("Id of the group (boundary or lane) containing this node."),
    icon: z.string().optional().describe("Lucide icon name overriding the kind's icon."),
    emphasis: z.boolean().optional().describe("Highlight with the accent colour: the system in focus."),
    position: z.object({ x: z.number(), y: z.number() }).strict().optional().describe("Pins the node at these coordinates. Omit for automatic layout."),
    notes: z.string().optional(),
  })
  .strict();

export const DiagramGroup = z
  .object({
    id: ElementId,
    label: z.string().min(1),
    lane: z.boolean().optional().describe("Draw as a full-width band (swimlane) instead of a box around its nodes."),
    description: z.string().optional(),
  })
  .strict();

export const DiagramEdge = z
  .object({
    id: z.string().optional().describe("Assigned if missing."),
    from: ElementId,
    to: ElementId,
    label: z.string().optional().describe('What flows or the protocol: "HTTPS", "publishes OrderPlaced".'),
    style: z.enum(["solid", "dashed", "dotted"]).default("solid").describe("dashed: async or optional; dotted: weak/monitoring."),
    bidirectional: z.boolean().optional(),
  })
  .strict();

export const Diagram = z
  .object({
    kind: z.literal("diagram").optional(),
    id: DocId,
    name: z.string().min(1),
    theme: DocId.optional().describe("Theme id. Defaults to the project's default theme."),
    description: z.string().optional(),
    direction: z.enum(["LR", "TB"]).default("LR").describe("Main flow: left to right or top to bottom."),
    nodes: z.array(DiagramNode).min(1),
    groups: z.array(DiagramGroup).default([]),
    edges: z.array(DiagramEdge).default([]),
    revision: z.number().int().optional(),
    updatedAt: z.string().optional(),
  })
  .strict();

export type DiagramT = z.infer<typeof Diagram>;
export type DiagramNodeT = z.infer<typeof DiagramNode>;
export type DiagramEdgeT = z.infer<typeof DiagramEdge>;
export type DiagramGroupT = z.infer<typeof DiagramGroup>;

function nearest(id: string, known: string[]): string {
  const close = known.filter((k) => k.includes(id) || id.includes(k) || k[0] === id[0]).slice(0, 6);
  return (close.length ? close : known.slice(0, 8)).join(", ");
}

/** Cross-reference checks the schema cannot express. Throws with a hint on the first problem. */
export function checkDiagramRefs(d: DiagramT): void {
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) throw new FramitError("SCHEMA", `Duplicate node id "${n.id}".`, { hint: "Node ids must be unique; edges refer to them." });
    ids.add(n.id);
  }
  const groups = new Set<string>();
  for (const g of d.groups) {
    if (groups.has(g.id) || ids.has(g.id)) throw new FramitError("SCHEMA", `Duplicate id "${g.id}" (groups and nodes share one id space).`);
    groups.add(g.id);
  }
  for (const n of d.nodes) {
    if (n.group && !groups.has(n.group)) throw new FramitError("SCHEMA", `Node "${n.id}" is in group "${n.group}", which is not defined.`, { hint: groups.size ? `Groups: ${[...groups].join(", ")}. Or add { id: "${n.group}", label: "…" } to groups.` : `Add { id: "${n.group}", label: "…" } to groups.` });
  }
  const edgeIds = new Set<string>();
  d.edges.forEach((e, i) => {
    for (const end of [e.from, e.to]) {
      if (!ids.has(end)) throw new FramitError("SCHEMA", `Edge ${i} (${e.from} → ${e.to}) refers to node "${end}", which does not exist.`, { hint: `Nodes: ${nearest(end, [...ids])}.` });
    }
    if (e.id) {
      if (edgeIds.has(e.id) || ids.has(e.id) || groups.has(e.id)) throw new FramitError("SCHEMA", `Duplicate id "${e.id}" on edge ${i}.`);
      edgeIds.add(e.id);
    }
  });
}

export const DIAGRAM_GUIDE = `# Diagrams

Architecture drawings: boxes for systems and services, arrows for what flows between them. You
describe structure; Framit lays it out (elkjs, layered, orthogonal arrows) and renders it in the
same theme as the screens. A person can then drag nodes to tidy it; dragged nodes are pinned.

\`\`\`json
{
  "id": "system-context",
  "name": "System context",
  "direction": "LR",
  "nodes": [
    { "id": "user", "label": "Customer", "kind": "actor" },
    { "id": "web", "label": "Web app", "kind": "client", "tech": "Next.js", "group": "product" },
    { "id": "api", "label": "Ledger API", "kind": "service", "tech": "Go", "group": "product", "emphasis": true,
      "description": "Accounts, transfers, statements" },
    { "id": "db", "label": "Ledger DB", "kind": "database", "tech": "Postgres", "group": "product" },
    { "id": "bank", "label": "Bank rails", "kind": "external" }
  ],
  "groups": [{ "id": "product", "label": "Ledger platform" }],
  "edges": [
    { "from": "user", "to": "web", "label": "Uses" },
    { "from": "web", "to": "api", "label": "JSON/HTTPS" },
    { "from": "api", "to": "db", "label": "SQL" },
    { "from": "api", "to": "bank", "label": "ISO 20022", "style": "dashed", "bidirectional": true }
  ]
}
\`\`\`

- **kinds**: ${NODE_KINDS.join(", ")}. Each has a shape and icon; \`icon\` overrides with any lucide name.
- **Keep labels short** (1–3 words); put the technology in \`tech\` and one line in \`description\`.
- **groups** draw a labelled boundary around their nodes (a system, a VPC, a team). With \`lane: true\`
  they become full-width bands; good for tiers (Clients / Services / Data). Groups do not nest.
- **edges** read as "from → to": label them with what flows or the protocol. \`style: "dashed"\` for
  async/events, \`bidirectional\` for request/response both ways only when it matters. Draw one
  edge per relationship: not a → b plus b → a (e.g. requests and SSE events: one bidirectional edge
  labelled "HTTP · SSE").
- **List nodes in reading order** (left to right for LR, actors and clients first): layout uses
  that order to settle ties and to choose which edge of a cycle points backwards.
- **direction** LR suits request paths; TB suits layered tiers.
- \`emphasis: true\` on the system the diagram is about.
- 5–15 nodes reads well. For more, split into several diagrams (context, then containers).
- Don't set \`position\` yourself; it is how a person's manual tidying is kept. When rewriting a
  diagram someone has tidied, keep the positions and ids you read.
`;
