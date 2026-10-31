import * as lucide from "lucide";

type IconNode = Array<[string, Record<string, string | number>]>;
const cache = new Map<string, string | null>();

const pascal = (name: string) =>
  name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");

/** Inner SVG markup for a Lucide icon by kebab-case name, or null if unknown. */
export function iconBody(name: string): string | null {
  if (cache.has(name)) return cache.get(name)!;
  const node = (lucide as unknown as Record<string, IconNode | undefined>)[pascal(name)];
  const body = Array.isArray(node)
    ? node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${String(v)}"`).join(" ")}/>`).join("")
    : null;
  cache.set(name, body);
  return body;
}

export function iconSvg(name: string, size = 20, extraClass = ""): { svg: string; known: boolean } {
  const body = iconBody(name);
  const inner = body ?? `<rect x="4" y="4" width="16" height="16" rx="4" stroke-dasharray="3 3"/>`;
  return {
    known: body !== null,
    svg: `<svg class="fx-icon${extraClass ? ` ${extraClass}` : ""}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`,
  };
}

/** A handful of known names, for hints when an unknown icon is used. */
export function suggestIcons(name: string): string[] {
  const all = Object.keys(lucide).filter((k) => /^[A-Z]/.test(k) && Array.isArray((lucide as Record<string, unknown>)[k]));
  const target = pascal(name).toLowerCase();
  const kebab = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z][a-z])/g, "$1-$2").toLowerCase();
  return all.filter((k) => k.toLowerCase().includes(target) || target.includes(k.toLowerCase())).slice(0, 5).map(kebab);
}
