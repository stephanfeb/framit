import { z } from "zod";
import { FramitError } from "../errors.js";

/*
 * Node-ID-addressed JSON Patch (ADR-004). Each op is RFC 6902, plus optional `node` and
 * `fromNode`: when present, `path`/`from` are relative to that node (or frame), so a patch
 * stays valid when siblings are reordered by another writer.
 *
 *   { op: "replace", node: "n_7f3a", path: "/props/label", value: "Send" }
 *   { op: "add",     node: "n_list", path: "/children/-",  value: { type: "text", props: {...} } }
 *   { op: "remove",  node: "n_old" }                                  // whole node
 *   { op: "move",    fromNode: "n_btn", node: "n_row", path: "/children/0" }
 */

export const PatchOp = z
  .object({
    op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
    node: z.string().optional().describe("Node or frame id that `path` is relative to."),
    path: z.string().default("").describe('JSON Pointer, e.g. "/props/label". Empty means the node itself.'),
    value: z.unknown().optional(),
    from: z.string().optional().describe("Source pointer for move/copy (relative to fromNode if given)."),
    fromNode: z.string().optional().describe("Node id that `from` is relative to; for move/copy of a whole node, omit `from`."),
  })
  .strict();
export type PatchOp = z.input<typeof PatchOp>;

type Json = unknown;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Find the JSON Pointer of the frame or node with this id. */
export function pointerOf(doc: Json, id: string): string | undefined {
  const walk = (v: Json, ptr: string): string | undefined => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${ptr}/${i}`);
        if (r !== undefined) return r;
      }
    } else if (isObj(v)) {
      if (v.id === id && (typeof v.type === "string" || "root" in v)) return ptr;
      for (const [k, child] of Object.entries(v)) {
        if (k === "props" && !isObj(child)) continue;
        const r = walk(child, `${ptr}/${escape(k)}`);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  return walk(doc, "");
}

const escape = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");
const unescape = (k: string) => k.replace(/~1/g, "/").replace(/~0/g, "~");

function parse(ptr: string): string[] {
  if (ptr === "") return [];
  if (!ptr.startsWith("/")) throw new FramitError("SCHEMA", `Invalid JSON Pointer "${ptr}".`, { hint: 'Pointers start with "/", e.g. "/props/label".' });
  return ptr.slice(1).split("/").map(unescape);
}

function resolve(doc: Json, node: string | undefined, path: string, i: number): string {
  if (node === undefined) return path;
  const base = pointerOf(doc, node);
  if (base === undefined) throw new FramitError("NOT_FOUND", `Patch op ${i}: no node or frame with id "${node}".`, { hint: "Call read_screen to get current node ids." });
  return base + path;
}

function get(doc: Json, tokens: string[], i: number): Json {
  let cur = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (isObj(cur)) cur = cur[t];
    else cur = undefined;
    if (cur === undefined) throw new FramitError("SCHEMA", `Patch op ${i}: path /${tokens.join("/")} does not exist.`);
  }
  return cur;
}

function parentOf(doc: Json, tokens: string[], i: number, autoCreate: boolean): { parent: Record<string, unknown> | unknown[]; key: string } {
  if (tokens.length === 0) throw new FramitError("SCHEMA", `Patch op ${i}: cannot target the document root.`);
  let cur = doc;
  for (const t of tokens.slice(0, -1)) {
    let next: Json = Array.isArray(cur) ? cur[Number(t)] : isObj(cur) ? cur[t] : undefined;
    if (next === undefined && autoCreate && isObj(cur)) next = cur[t] = {};
    if (next === undefined) throw new FramitError("SCHEMA", `Patch op ${i}: path /${tokens.join("/")} does not exist.`);
    cur = next;
  }
  if (!Array.isArray(cur) && !isObj(cur)) throw new FramitError("SCHEMA", `Patch op ${i}: parent of /${tokens.join("/")} is not a container.`);
  return { parent: cur, key: tokens[tokens.length - 1]! };
}

function add(doc: Json, tokens: string[], value: Json, i: number) {
  // Creating intermediate objects for "add" lets a caller set /props/x on a node without props.
  const { parent, key } = parentOf(doc, tokens, i, true);
  if (Array.isArray(parent)) {
    const idx = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new FramitError("SCHEMA", `Patch op ${i}: index ${key} out of range.`);
    parent.splice(idx, 0, value);
  } else parent[key] = value;
}

function remove(doc: Json, tokens: string[], i: number): Json {
  const { parent, key } = parentOf(doc, tokens, i, false);
  const value = get(doc, tokens, i);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
  return value;
}

/** Apply ops to a deep copy of `doc`. All-or-nothing: on error the input is untouched. */
export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  const out = structuredClone(doc) as Json;
  ops.forEach((raw, i) => {
    const op = PatchOp.parse(raw);
    const tokens = parse(resolve(out, op.node, op.path, i));
    switch (op.op) {
      case "add":
        add(out, tokens, structuredClone(op.value), i);
        break;
      case "remove":
        remove(out, tokens, i);
        break;
      case "replace": {
        if (op.value === undefined) throw new FramitError("SCHEMA", `Patch op ${i}: replace needs a value.`);
        const { parent, key } = parentOf(out, tokens, i, true);
        if (Array.isArray(parent)) {
          get(out, tokens, i);
          parent[Number(key)] = structuredClone(op.value);
        } else parent[key] = structuredClone(op.value);
        break;
      }
      case "move":
      case "copy": {
        const fromTokens = parse(resolve(out, op.fromNode, op.from ?? "", i));
        if (op.op === "move" && tokens.join("/").startsWith(fromTokens.join("/") + "/")) {
          throw new FramitError("SCHEMA", `Patch op ${i}: cannot move a node into itself.`);
        }
        // Resolve the target before removing, then adjust for index shifts in the same array.
        const value = op.op === "move" ? remove(out, fromTokens, i) : structuredClone(get(out, fromTokens, i));
        let target = tokens;
        if (op.op === "move" && op.node !== undefined) target = parse(resolve(out, op.node, op.path, i));
        add(out, target, value, i);
        break;
      }
      case "test":
        if (JSON.stringify(get(out, tokens, i)) !== JSON.stringify(op.value)) throw new FramitError("SCHEMA", `Patch op ${i}: test failed at /${tokens.join("/")}.`);
        break;
    }
  });
  return out as T;
}
