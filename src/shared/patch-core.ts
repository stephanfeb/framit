/*
 * Dependency-free node-ID-addressed JSON Patch, shared by the server (src/store/patch.ts)
 * and the browser editor runtime. See ADR-004.
 *
 * Each op is RFC 6902 plus optional `node` / `fromNode`: when present, `path` / `from` are
 * relative to that node or frame, so a patch stays valid when siblings are reordered.
 */

export interface Op {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  node?: string;
  path?: string;
  value?: unknown;
  from?: string;
  fromNode?: string;
}

export class PatchError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID",
    message: string,
  ) {
    super(message);
  }
}

type Json = unknown;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const escapeToken = (k: string) => k.replace(/~/g, "~0").replace(/\//g, "~1");
const unescapeToken = (k: string) => k.replace(/~1/g, "/").replace(/~0/g, "~");

/** Is this object a frame or a component node (i.e. addressable by id)? */
const isAddressable = (v: Record<string, unknown>) => typeof v.id === "string" && (typeof v.type === "string" || "root" in v);

/** JSON Pointer of the frame or node with this id. */
export function pointerOf(doc: Json, id: string): string | undefined {
  const walk = (v: Json, ptr: string): string | undefined => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = walk(v[i], `${ptr}/${i}`);
        if (r !== undefined) return r;
      }
    } else if (isObj(v)) {
      if (v.id === id && isAddressable(v)) return ptr;
      for (const [k, child] of Object.entries(v)) {
        const r = walk(child, `${ptr}/${escapeToken(k)}`);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  return walk(doc, "");
}

export function parsePointer(ptr: string): string[] {
  if (ptr === "") return [];
  if (!ptr.startsWith("/")) throw new PatchError("INVALID", `Invalid JSON Pointer "${ptr}"; pointers start with "/".`);
  return ptr.slice(1).split("/").map(unescapeToken);
}

export const formatPointer = (tokens: string[]) => tokens.map((t) => `/${escapeToken(t)}`).join("");

function absolute(doc: Json, node: string | undefined, path: string | undefined, i: number): string {
  if (node === undefined) return path ?? "";
  const base = pointerOf(doc, node);
  if (base === undefined) throw new PatchError("NOT_FOUND", `Patch op ${i}: no node or frame with id "${node}".`);
  return base + (path ?? "");
}

export function getAt(doc: Json, tokens: string[]): Json | undefined {
  let cur = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) cur = cur[Number(t)];
    else if (isObj(cur)) cur = cur[t];
    else return undefined;
    if (cur === undefined) return undefined;
  }
  return cur;
}

function mustGet(doc: Json, tokens: string[], i: number): Json {
  const v = getAt(doc, tokens);
  if (v === undefined) throw new PatchError("INVALID", `Patch op ${i}: path ${formatPointer(tokens)} does not exist.`);
  return v;
}

function parentOf(doc: Json, tokens: string[], i: number, autoCreate: boolean) {
  if (tokens.length === 0) throw new PatchError("INVALID", `Patch op ${i}: cannot target the document root.`);
  let cur = doc;
  for (const t of tokens.slice(0, -1)) {
    let next: Json = Array.isArray(cur) ? cur[Number(t)] : isObj(cur) ? cur[t] : undefined;
    if (next === undefined && autoCreate && isObj(cur)) next = cur[t] = {};
    if (next === undefined) throw new PatchError("INVALID", `Patch op ${i}: path ${formatPointer(tokens)} does not exist.`);
    cur = next;
  }
  if (!Array.isArray(cur) && !isObj(cur)) throw new PatchError("INVALID", `Patch op ${i}: parent of ${formatPointer(tokens)} is not a container.`);
  return { parent: cur as Record<string, unknown> | unknown[], key: tokens[tokens.length - 1]! };
}

function addAt(doc: Json, tokens: string[], value: Json, i: number) {
  const { parent, key } = parentOf(doc, tokens, i, true);
  if (Array.isArray(parent)) {
    const idx = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new PatchError("INVALID", `Patch op ${i}: index ${key} out of range.`);
    parent.splice(idx, 0, value);
  } else parent[key] = value;
}

function removeAt(doc: Json, tokens: string[], i: number): Json {
  const value = mustGet(doc, tokens, i);
  const { parent, key } = parentOf(doc, tokens, i, false);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
  return value;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/** Apply ops to a deep copy of `doc`. All-or-nothing: on error the input is untouched. */
export function applyOps<T>(doc: T, ops: Op[]): T {
  const out = clone(doc) as Json;
  ops.forEach((op, i) => {
    const tokens = parsePointer(absolute(out, op.node, op.path, i));
    switch (op.op) {
      case "add":
        addAt(out, tokens, clone(op.value), i);
        break;
      case "remove":
        removeAt(out, tokens, i);
        break;
      case "replace": {
        if (op.value === undefined) throw new PatchError("INVALID", `Patch op ${i}: replace needs a value.`);
        const { parent, key } = parentOf(out, tokens, i, true);
        if (Array.isArray(parent)) {
          mustGet(out, tokens, i);
          parent[Number(key)] = clone(op.value);
        } else parent[key] = clone(op.value);
        break;
      }
      case "move":
      case "copy": {
        const fromTokens = parsePointer(absolute(out, op.fromNode, op.from, i));
        if (op.op === "move" && formatPointer(tokens).startsWith(formatPointer(fromTokens) + "/")) {
          throw new PatchError("INVALID", `Patch op ${i}: cannot move a node into itself.`);
        }
        const value = op.op === "move" ? removeAt(out, fromTokens, i) : clone(mustGet(out, fromTokens, i));
        // Re-resolve the target after removal so node-relative paths survive index shifts.
        const target = op.op === "move" && op.node !== undefined ? parsePointer(absolute(out, op.node, op.path, i)) : tokens;
        addAt(out, target, value, i);
        break;
      }
      case "test":
        if (JSON.stringify(mustGet(out, tokens, i)) !== JSON.stringify(op.value)) throw new PatchError("INVALID", `Patch op ${i}: test failed at ${formatPointer(tokens)}.`);
        break;
    }
  });
  return out as T;
}

/**
 * Express an absolute pointer relative to the nearest addressable ancestor (excluding the
 * target itself), so the op survives sibling reordering.
 */
export function relativize(doc: Json, tokens: string[]): Pick<Op, "node" | "path"> {
  for (let n = tokens.length - 1; n >= 0; n--) {
    const v = getAt(doc, tokens.slice(0, n));
    if (isObj(v) && isAddressable(v)) return { node: v.id as string, path: formatPointer(tokens.slice(n)) };
  }
  return { path: formatPointer(tokens) };
}

/**
 * Compute ops that undo `ops` when applied to the result of applying them to `doc`.
 * Used by the editor's undo stack.
 */
export function invertOps(doc: Json, ops: Op[]): Op[] {
  const inverse: Op[] = [];
  let cur = clone(doc);
  ops.forEach((op, i) => {
    const tokens = parsePointer(absolute(cur, op.node, op.path, i));
    const before = getAt(cur, tokens);
    const next = applyOps(cur, [op]);
    switch (op.op) {
      case "replace":
      case "add": {
        const parent = getAt(cur, tokens.slice(0, -1));
        if (op.op === "add" && Array.isArray(parent)) {
          // Inserted into an array: remove it again, by id if it is a node.
          const v = op.value;
          if (isObj(v) && typeof v.id === "string") inverse.unshift({ op: "remove", node: v.id });
          else {
            const idx = tokens[tokens.length - 1] === "-" ? parent.length : Number(tokens[tokens.length - 1]);
            inverse.unshift({ op: "remove", ...relativize(next, [...tokens.slice(0, -1), String(idx)]) });
          }
        } else if (before === undefined) inverse.unshift({ op: "remove", ...relativize(next, tokens) });
        else inverse.unshift({ op: "replace", ...relativize(next, tokens), value: clone(before) });
        break;
      }
      case "remove":
        inverse.unshift({ op: "add", ...relativize(cur, tokens), value: clone(before) });
        break;
      case "move": {
        const fromTokens = parsePointer(absolute(cur, op.fromNode, op.from, i));
        const moved = getAt(cur, fromTokens);
        const back = relativize(cur, fromTokens);
        if (isObj(moved) && typeof moved.id === "string") inverse.unshift({ op: "move", fromNode: moved.id, ...back });
        else {
          const at = parsePointer(absolute(next, op.node, op.path, i));
          inverse.unshift({ op: "move", from: formatPointer(at), ...back });
        }
        break;
      }
      case "copy": {
        const at = parsePointer(absolute(next, op.node, op.path, i));
        inverse.unshift({ op: "remove", ...relativize(next, at) });
        break;
      }
      case "test":
        break;
    }
    cur = next;
  });
  return inverse;
}

/** Remove all `id`s from a node tree (for duplicate/insert: the server assigns fresh ones). */
export function stripIds<T>(node: T): T {
  const out = clone(node);
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      if (typeof v.type === "string") delete v.id;
      Object.values(v).forEach(walk);
    }
  };
  walk(out);
  return out;
}
