// Helpers over the screen document as the browser sees it (plain JSON).

export interface Node {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  children?: Node[];
  style?: Record<string, unknown>;
  notes?: string;
}
export interface Frame {
  id?: string;
  name?: string;
  device: string | { width: number; height: number };
  position?: { x: number; y: number };
  background?: string;
  root: Node;
}
export interface ScreenDoc {
  kind: "screen";
  id: string;
  name: string;
  theme?: string;
  revision: number;
  frames: Frame[];
  [k: string]: unknown;
}

export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  description?: string;
  const?: unknown;
}
export interface ComponentMeta {
  type: string;
  category: string;
  container: boolean;
  summary: string;
  props: JsonSchema;
  example: Node;
}
export interface Meta {
  components: Record<string, ComponentMeta>;
  tokens: { space: string[]; color: string[]; tone: string[] };
}

export interface Located {
  node: Node;
  frame: Frame;
  frameIndex: number;
  parent?: Node;
  index: number;
  /** Ids from the frame root down to (and including) this node. */
  path: string[];
}

export function locate(doc: ScreenDoc, id: string): Located | undefined {
  for (let fi = 0; fi < doc.frames.length; fi++) {
    const frame = doc.frames[fi]!;
    const walk = (node: Node, parent: Node | undefined, index: number, path: string[]): Located | undefined => {
      const p = node.id ? [...path, node.id] : path;
      if (node.id === id) return { node, frame, frameIndex: fi, parent, index, path: p };
      const kids = node.children ?? [];
      for (let i = 0; i < kids.length; i++) {
        const r = walk(kids[i]!, node, i, p);
        if (r) return r;
      }
      return undefined;
    };
    const r = walk(frame.root, undefined, 0, []);
    if (r) return r;
  }
  return undefined;
}

export const frameOf = (doc: ScreenDoc, id: string) => doc.frames.find((f) => f.id === id);

/** Read a value at a JSON Pointer relative to an object. */
export function getPointer(obj: unknown, ptr: string): unknown {
  if (!ptr) return obj;
  let cur = obj;
  for (const raw of ptr.slice(1).split("/")) {
    const t = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
export function newId(prefix = "n"): string {
  let s = "";
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  for (const v of buf) s += ALPHABET[v % 32];
  return `${prefix}_${s}`;
}

/** Deep copy with fresh ids on every node (for duplicate and insert). */
export function withFreshIds<T extends Node | Frame>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const walk = (n: Node) => {
    n.id = newId();
    n.children?.forEach(walk);
  };
  if ("root" in copy) {
    copy.id = newId("f");
    walk(copy.root);
  } else walk(copy as Node);
  return copy;
}

export function isContainer(meta: Meta, type: string): boolean {
  return meta.components[type]?.container ?? false;
}

export function isDescendant(doc: ScreenDoc, ancestorId: string, id: string): boolean {
  return locate(doc, id)?.path.includes(ancestorId) ?? false;
}
