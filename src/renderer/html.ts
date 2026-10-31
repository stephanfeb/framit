const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Placeholder slots like `[n]`, `[Name]`, `[N] items` render muted so they read as slots, not bugs. */
const PLACEHOLDER = /\[[^\[\]\n]{1,32}\]/g;

export function richText(s: string | number | undefined): string {
  if (s === undefined) return "";
  return esc(s)
    .replace(PLACEHOLDER, (m) => `<span class="fx-ph">${m}</span>`)
    .replace(/\n/g, "<br>");
}

/** Build an inline style attribute value from a map, skipping undefined values. */
export function css(decl: Record<string, string | number | undefined | false>): string {
  return Object.entries(decl)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export function cls(...names: Array<string | false | undefined | null>): string {
  return names.filter(Boolean).join(" ");
}

export function initials(name: string): string {
  const parts = name.replace(/\[[^\]]*\]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "")).toUpperCase();
}
