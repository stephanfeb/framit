import { FramitError } from "../errors.js";
import { shortId } from "./ids.js";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Visit every component node in a screen document: each frame's `root` and, recursively,
 * every entry in `children`. Tab panels (`props.tabs[].children`) count as children too.
 */
export function walkScreenNodes(doc: Json, visit: (node: Json) => void): void {
  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  const walk = (node: unknown) => {
    if (!isObject(node)) return;
    visit(node);
    if (Array.isArray(node.children)) node.children.forEach(walk);
    const tabs = isObject(node.props) && Array.isArray(node.props.tabs) ? node.props.tabs : [];
    for (const tab of tabs) if (isObject(tab) && Array.isArray(tab.children)) tab.children.forEach(walk);
  };
  for (const frame of frames) if (isObject(frame)) walk(frame.root);
}

/**
 * Ensure every frame and node in a screen has a unique id. Existing ids are preserved
 * (they are the join key for patches, ADR-004); missing ids are generated. Duplicate ids
 * are an error rather than silently renamed, because a patch could otherwise hit the
 * wrong node.
 */
export function assignScreenIds(doc: Json): void {
  const seen = new Set<string>();
  const missing: Array<{ obj: Json; prefix: string }> = [];

  const claim = (obj: Json, prefix: string, where: string) => {
    if (typeof obj.id === "string" && obj.id.length > 0) {
      if (seen.has(obj.id)) {
        throw new FramitError("SCHEMA", `Duplicate id "${obj.id}" in ${where}.`, {
          hint: "Every frame and node id must be unique within a screen. Remove the id from the copy and one will be assigned.",
        });
      }
      seen.add(obj.id);
    } else {
      missing.push({ obj, prefix });
    }
  };

  const frames = Array.isArray(doc.frames) ? doc.frames : [];
  for (const frame of frames) if (isObject(frame)) claim(frame, "f", "frames");
  walkScreenNodes(doc, (node) => claim(node, "n", "nodes"));

  for (const { obj, prefix } of missing) {
    let id = shortId(prefix);
    while (seen.has(id)) id = shortId(prefix);
    seen.add(id);
    obj.id = id;
  }
}
